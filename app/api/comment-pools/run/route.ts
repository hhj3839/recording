import { waitUntil } from "@vercel/functions";
import { eq, selectRows, supabaseRequest, updateRows, upsertRows } from "../../../../db/supabase";
import { approvePoolCandidates, commentPoolQuality, COMMENT_POOL_TARGET, normalizedPoolSentence, type CommentPoolSpec } from "../../../comment-pool-library";
import { signCommentJob, verifyCommentJob } from "../../../comment-generation";
import { primaryAiModel } from "../../../ai-model-policy";
import { recordAiUsage } from "../../../ai-usage";
import { buildCommentPoolCandidatePrompt, commentPoolSystemPrompt } from "../../../comment-pool-prompt";
import { compileCommentPoolEvidence, validCommentPoolEvidenceIds } from "../../../comment-pool-evidence";
import { openAiOutputText, parseFirstJsonObject } from "../../../openai-response";

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

const inValues = (values: Array<string | number>) => `in.(${values.join(",")})`;

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
  const compiledEvidence = compileCommentPoolEvidence(spec);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, reasoning: { effort: "none" }, store: false, max_output_tokens: 10000,
      input: [{ role: "system", content: [{ type: "input_text", text: commentPoolSystemPrompt }] }, {
        role: "user", content: [{ type: "input_text", text: buildCommentPoolCandidatePrompt(spec, existing, count) }],
      }],
      text: { verbosity: "medium", format: { type: "json_schema", name: "comment_pool_candidates", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["candidates"], properties: {
          candidates: { type: "array", minItems: count, maxItems: count, items: {
            type: "object", additionalProperties: false, required: ["text", "evidenceIds"], properties: {
              text: { type: "string" },
              evidenceIds: { type: "array", minItems: compiledEvidence.combinationTarget, items: { type: "string" } },
            },
          } },
        },
      } } },
    }),
  });
  const payload = await response.json() as { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { cached_tokens?: number } } };
  if (!response.ok) throw new Error(`AI 평어 후보 제작 실패 (HTTP ${response.status})`);
  const decoded = parseFirstJsonObject<{ candidates?: unknown }>(openAiOutputText(payload)) ?? {};
  const candidates = Array.isArray(decoded.candidates) ? decoded.candidates.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as { text?: unknown; evidenceIds?: unknown };
    if (typeof value.text !== "string" || !Array.isArray(value.evidenceIds)) return [];
    const evidenceIds = value.evidenceIds.filter((id): id is string => typeof id === "string");
    if (!validCommentPoolEvidenceIds(value.text, evidenceIds, compiledEvidence)) return [];
    return [value.text];
  }) : [];
  return {
    candidates,
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
    for (let attempt = 0; attempt < maxAttempts && !commentPoolQuality(approved, batch.spec.canonicalSentence).reusable; attempt += 1) {
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
    const quality = commentPoolQuality(approved, batch.spec.canonicalSentence);
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
