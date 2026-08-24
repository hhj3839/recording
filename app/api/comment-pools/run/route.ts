import { waitUntil } from "@vercel/functions";
import { eq, selectRows, supabaseRequest, updateRows, upsertRows } from "../../../../db/supabase";
import { approvePoolCandidates, commentPoolQuality, COMMENT_POOL_TARGET, normalizedPoolSentence, type CommentPoolSpec } from "../../../comment-pool-library";
import { signCommentJob, verifyCommentJob } from "../../../comment-generation";
import { primaryAiModel } from "../../../ai-model-policy";
import { recordAiUsage } from "../../../ai-usage";

export const maxDuration = 300;
type PoolBatch = {
  spec: CommentPoolSpec; poolVersionId: number; maxAttempts?: number; activateWhenReady?: boolean;
  previousPoolVersionIds?: number[];
};
type JobRow = {
  id: string; owner_id: string; owner_email: string; class_id: number; status: string; batches: PoolBatch[];
  current_batch: number; total_batches: number; total_items: number; completed_items: number; failed_items: number;
  error_message: string; updated_at: string; started_at?: string | null;
};

const commentPoolSystemPrompt = `# 역할
당신은 초등학교 담임교사의 학생평가 작성 전문가이다.
학교생활기록부 교과학습발달상황에 사용할 자연스러운 교과 평어 후보를 작성한다.

# 작성
- 선택된 평가기준의 의미와 수행 수준을 정확하게 유지한다.
- 입력되지 않은 행동, 태도, 방법이나 성과를 추가하지 않는다.
- 평가목표·평가관점·평가유형·유의점을 함께 분석하되, 실제 활동이 명시된 경우에만 관찰 장면으로 활용한다.
- 평가기준을 그대로 복사하거나 단어 몇 개만 치환하지 말고 관찰 가능한 학생의 수행으로 자연스럽게 표현한다.
- 긍정적인 학교생활기록부 문체로 작성한다.
- 모든 문장은 자연스러운 명사형 종결과 마침표로 끝낸다.
- 후보 전체를 하나의 문장 집합으로 보고 수행 대상·활동 장면·과정·결과 중 근거가 있는 요소의 제시 순서를 분산한다.
- 같은 첫 15글자와 같은 주어·목적어·서술어 배열을 반복하지 않는다.
- 문장마다 시작 표현과 문장 골격을 달리하되 핵심 성취와 수준은 동일하게 유지한다.
- 이미 승인된 문장과 사실상 같은 문장은 작성하지 않는다.
- 다양성을 위해 어색한 문장이나 새로운 사실을 만들지 않는다.

# 출력
지정된 JSON 스키마만 출력한다. 제목·번호·설명은 출력하지 않는다.`;

const inValues = (values: Array<string | number>) => `in.(${values.join(",")})`;

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
      input: [{ role: "system", content: [{ type: "input_text", text: commentPoolSystemPrompt }] }, {
        role: "user", content: [{ type: "input_text", text: `# 이번 문장 풀\n과목: ${spec.subject}\n단원: ${spec.unit}\n평가목표: ${spec.goal}\n영역: ${spec.domain}\n평가유형: ${spec.assessmentType || "미입력"}\n평가관점: ${spec.perspective}\n선택 수준: ${spec.level}\n선택 수준 평가기준: ${spec.criterion}\n상·중·하 전체 기준: ${JSON.stringify(spec.levelCriteria)}\n평가상의 유의점: ${spec.caution || "미입력"}\n의미 보존용 기준 문장: ${spec.canonicalSentence}\n이미 승인된 문장: ${JSON.stringify(existing)}\n\n# 요청\n이미 승인된 문장을 반복하지 말고 자연스러운 후보 ${count}개를 작성한다. 의미 보존용 기준 문장은 사실성과 수준을 확인하는 기준이지 문장 틀이 아니다. 조사·연결어만 바꾸는 변형을 만들지 않는다. 후보 전체의 첫 15글자, 관찰 장면, 절의 순서와 서술어 배열을 서로 비교하여 유사한 후보는 출력 전에 다시 작성한다. 최종 출력에는 JSON 후보만 포함한다.` }],
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
  if (!job) return Response.json({ ok: true, terminal: true });
  if (job.status !== "queued") return Response.json({ ok: true, terminal: false, busy: job.status === "running" });
  const batchIndex = Number(job.current_batch);
  const batch = job.batches[batchIndex];
  if (!batch) return Response.json({ ok: true, terminal: true });
  const claimed = await updateRows<JobRow>("generation_jobs", { id: eq(jobId), status: eq("queued"), updated_at: eq(job.updated_at) }, {
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
    const maxAttempts = Number.isInteger(batch.maxAttempts) ? Math.max(0, Math.min(2, Number(batch.maxAttempts))) : 2;
    for (let attempt = 0; attempt < maxAttempts && !commentPoolQuality(approved).reusable; attempt += 1) {
      const requestCount = attempt === 0 ? 15 : 10;
      const generated = await generateCandidates(batch.spec, approved, requestCount);
      const selected = approvePoolCandidates(generated.candidates, batch.spec, approved).approved
        .slice(0, COMMENT_POOL_TARGET - approved.length);
      if (selected.length) {
        await upsertRows("comment_pool_sentences", selected.map((sentence) => ({
          pool_version_id: batch.poolVersionId, sentence, normalized_sentence: normalizedPoolSentence(sentence),
          status: "approved", source: "generated", updated_at: new Date().toISOString(),
        })), "pool_version_id,normalized_sentence");
        approved = [...approved, ...selected].slice(0, COMMENT_POOL_TARGET);
      }
      await recordAiUsage({ ownerId: job.owner_id, ownerEmail: job.owner_email, classId: Number(job.class_id), feature: `comment-pool-attempt-${attempt + 1}`, ...generated.usage });
    }
    const quality = commentPoolQuality(approved);
    const status = quality.reusable ? "ready" : approved.length ? "usable" : "failed";
    await updateRows("comment_pool_versions", { id: eq(batch.poolVersionId) }, {
      status, approved_count: approved.length, updated_at: new Date().toISOString(),
    });
    if (batch.activateWhenReady && quality.reusable) {
      await upsertRows("assessment_plan_pool_links", [{
        owner_id: job.owner_id, owner_email: job.owner_email, class_id: Number(job.class_id),
        assessment_plan_id: batch.spec.assessmentPlanId, pool_version_id: batch.poolVersionId,
      }], "owner_id,class_id,assessment_plan_id,pool_version_id");
      const previousPoolVersionIds = (batch.previousPoolVersionIds ?? []).filter((id) => id !== batch.poolVersionId);
      if (previousPoolVersionIds.length) {
        await supabaseRequest("assessment_plan_pool_links", {
          method: "DELETE",
          query: {
            owner_id: eq(job.owner_id), class_id: eq(Number(job.class_id)),
            assessment_plan_id: eq(batch.spec.assessmentPlanId), pool_version_id: inValues(previousPoolVersionIds),
          },
        }).catch(() => undefined);
      }
    }
    failed = batch.activateWhenReady ? !quality.reusable : approved.length === 0;
    if (failed) errorMessage = batch.activateWhenReady
      ? `${batch.spec.subject} ${batch.spec.domain} ${batch.spec.level} 수준의 새 문장 풀이 품질 검수를 통과하지 못해 기존 문장 풀을 유지했습니다. (${quality.issues.join(" · ")})`
      : `${batch.spec.subject} ${batch.spec.domain} ${batch.spec.level} 수준의 승인 문장을 확보하지 못했습니다.`;
  } catch (error) {
    failed = batch.activateWhenReady ? true : approved.length === 0;
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
