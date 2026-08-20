import { waitUntil } from "@vercel/functions";
import { eq, selectRows, updateRows, upsertRows } from "../../../../db/supabase";
import { approvePoolCandidates, COMMENT_POOL_TARGET, normalizedPoolSentence, type CommentPoolSpec } from "../../../comment-pool-library";
import { signCommentJob, verifyCommentJob } from "../../../comment-generation";
import { primaryAiModel } from "../../../ai-model-policy";
import { recordAiUsage } from "../../../ai-usage";

export const maxDuration = 300;
type PoolBatch = { spec: CommentPoolSpec; poolVersionId: number };
type JobRow = {
  id: string; owner_id: string; owner_email: string; class_id: number; status: string; batches: PoolBatch[];
  current_batch: number; total_batches: number; total_items: number; completed_items: number; failed_items: number;
  error_message: string; updated_at: string; started_at?: string | null;
};

function outputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const value = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof value.output_text === "string") return value.output_text;
  return (value.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("");
}

function queueNext(request: Request, jobId: string) {
  const url = new URL("/api/comment-pools/run", request.url);
  waitUntil(fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, signature: signCommentJob(jobId) }),
  }).catch(() => undefined));
}

async function generateCandidates(spec: CommentPoolSpec, existing: string[], count: number) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI 생성 설정이 아직 완료되지 않았습니다.");
  const model = primaryAiModel();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, reasoning: { effort: "none" }, store: false, max_output_tokens: 10000,
      input: [{ role: "system", content: [{ type: "input_text", text: "초등학교 학교생활기록부에 사용할 자연스러운 교과 평어 후보를 작성한다. 입력된 평가기준의 수행 대상, 핵심 행동, 평가수준, 도움 여부, 일부·전체 범위, 완료·노력 상태를 그대로 보존한다. 새로운 사실·태도·방법을 추가하지 않는다. 다양성을 위해 어색한 표현을 만들지 않으며 비슷한 문장이 있어도 자연스러움을 우선한다. 모든 문장은 직접적인 명사형 종결과 마침표로 끝낸다. 제목·번호·설명은 출력하지 않는다." }] }, {
        role: "user", content: [{ type: "input_text", text: `과목: ${spec.subject}\n단원: ${spec.unit}\n평가목표: ${spec.goal}\n영역: ${spec.domain}\n평가관점: ${spec.perspective}\n수준: ${spec.level}\n평가기준: ${spec.criterion}\n상·중·하 기준: ${JSON.stringify(spec.levelCriteria)}\n기준 문장: ${spec.canonicalSentence}\n이미 승인된 문장: ${JSON.stringify(existing)}\n자연스러운 후보 ${count}개를 작성하라.` }],
      }],
      text: { verbosity: "low", format: { type: "json_schema", name: "comment_pool_candidates", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["candidates"], properties: {
          candidates: { type: "array", minItems: count, maxItems: count, items: { type: "string" } },
        },
      } } },
    }),
  });
  const payload = await response.json() as { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { cached_tokens?: number } } };
  if (!response.ok) throw new Error(`AI 평어 후보 제작 실패 (HTTP ${response.status})`);
  const decoded = JSON.parse(outputText(payload).replace(/^```json\s*/i, "").replace(/\s*```$/, "")) as { candidates?: unknown };
  return {
    candidates: Array.isArray(decoded.candidates) ? decoded.candidates.filter((item): item is string => typeof item === "string") : [],
    usage: { model, inputTokens: Number(payload.usage?.input_tokens) || 0, cachedInputTokens: Number(payload.usage?.input_tokens_details?.cached_tokens) || 0, outputTokens: Number(payload.usage?.output_tokens) || 0, totalTokens: Number(payload.usage?.total_tokens) || 0 },
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { jobId?: unknown; signature?: unknown };
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!jobId || !verifyCommentJob(jobId, signature)) return Response.json({ error: "허용되지 않은 작업 요청입니다." }, { status: 403 });
  const job = (await selectRows<JobRow>("generation_jobs", { id: eq(jobId), limit: 1 }))[0];
  if (!job || !["queued", "running"].includes(job.status)) return Response.json({ ok: true, terminal: true });
  const batchIndex = Number(job.current_batch);
  const batch = job.batches[batchIndex];
  if (!batch) return Response.json({ ok: true, terminal: true });
  const claimed = await updateRows<JobRow>("generation_jobs", { id: eq(jobId), status: eq(job.status), updated_at: eq(job.updated_at) }, {
    status: "running", started_at: job.started_at ?? new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  if (!claimed[0]) return Response.json({ ok: true, terminal: false, busy: true });
  let failed = false;
  let errorMessage = "";
  let approved: string[] = [];
  try {
    await updateRows("comment_pool_versions", { id: eq(batch.poolVersionId) }, { status: "generating", updated_at: new Date().toISOString() });
    const rows = await selectRows<{ sentence: string }>("comment_pool_sentences", {
      pool_version_id: eq(batch.poolVersionId), status: eq("approved"), order: "id.asc",
    });
    const existing = rows.map((row) => row.sentence);
    approved = [...existing];
    const canonical = approvePoolCandidates([batch.spec.canonicalSentence], batch.spec, approved).approved;
    if (canonical.length) {
      await upsertRows("comment_pool_sentences", canonical.map((sentence) => ({
        pool_version_id: batch.poolVersionId, sentence, normalized_sentence: normalizedPoolSentence(sentence),
        status: "approved", source: "canonical", updated_at: new Date().toISOString(),
      })), "pool_version_id,normalized_sentence");
      approved.push(...canonical);
    }
    for (let attempt = 0; attempt < 2 && approved.length < COMMENT_POOL_TARGET; attempt += 1) {
      const requestCount = Math.min(40, Math.max(20, (COMMENT_POOL_TARGET - approved.length) * 2));
      const generated = await generateCandidates(batch.spec, approved, requestCount);
      const selected = approvePoolCandidates(generated.candidates, batch.spec, approved).approved;
      if (selected.length) {
        await upsertRows("comment_pool_sentences", selected.map((sentence) => ({
          pool_version_id: batch.poolVersionId, sentence, normalized_sentence: normalizedPoolSentence(sentence),
          status: "approved", source: "generated", updated_at: new Date().toISOString(),
        })), "pool_version_id,normalized_sentence");
        approved = [...approved, ...selected].slice(0, COMMENT_POOL_TARGET);
      }
      await recordAiUsage({ ownerId: job.owner_id, ownerEmail: job.owner_email, classId: Number(job.class_id), feature: `comment-pool-attempt-${attempt + 1}`, ...generated.usage });
    }
    const status = approved.length >= COMMENT_POOL_TARGET ? "ready" : approved.length ? "usable" : "failed";
    await updateRows("comment_pool_versions", { id: eq(batch.poolVersionId) }, {
      status, approved_count: approved.length, updated_at: new Date().toISOString(),
    });
    failed = approved.length === 0;
    if (failed) errorMessage = `${batch.spec.subject} ${batch.spec.domain} ${batch.spec.level} 수준의 승인 문장을 확보하지 못했습니다.`;
  } catch (error) {
    failed = approved.length === 0;
    errorMessage = error instanceof Error ? error.message : "AI 평어 제작 오류";
    await updateRows("comment_pool_versions", { id: eq(batch.poolVersionId) }, {
      status: approved.length ? "usable" : "failed", approved_count: approved.length, updated_at: new Date().toISOString(),
    });
  }
  const next = batchIndex + 1;
  const terminal = next >= Number(job.total_batches);
  const completed = Number(job.completed_items) + (failed ? 0 : 1);
  const failedItems = Number(job.failed_items) + (failed ? 1 : 0);
  await updateRows("generation_jobs", { id: eq(jobId) }, {
    status: terminal ? (failedItems ? "completed_with_errors" : "completed") : "queued",
    current_batch: next, completed_items: completed, failed_items: failedItems,
    error_message: errorMessage || job.error_message, completed_at: terminal ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  if (!terminal) queueNext(request, jobId);
  return Response.json({ ok: true, terminal, completed, failed: failedItems });
}
