import { eq, insertRows, selectRows } from "../../../../db/supabase";
import { getAuthUser } from "../../../supabase-auth";
import { POOL_TRIAL, trialAccess, claimAndRunTrial } from "../../../comment-pool-trial";
import { buildCommentPoolSpecs, approvePoolCandidates, commentPoolQuality, type PoolPlanItem } from "../../../comment-pool-library";
import { buildCommentPoolCandidatePrompt, commentPoolSystemPrompt } from "../../../comment-pool-prompt";
import { primaryAiModel } from "../../../ai-model-policy";
import { openAiOutputText, parseFirstJsonObject } from "../../../openai-response";
import { checkAiUsage, recordAiUsage } from "../../../ai-usage";
import { estimateAiCostUsd } from "../../../ai-pricing";
import { trialResponse } from "../../../comment-pool-trial-response";

export const maxDuration = 300;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

// Read-only launch page. Visiting this URL never claims the budget or calls AI.
export async function GET() {
  try {
    const user = await getAuthUser();
    const access = trialAccess(user?.email, "https://giroksam-recording.vercel.app");
    if (access !== 200 || !user) return json({ error: "지정 계정으로 로그인해 주세요. 만료된 시험은 실행할 수 없습니다." }, access);
    const used = await selectRows<{ id: string }>("generation_jobs", { id: eq(POOL_TRIAL.id), limit: 1 });
    return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>기록샘 영어 문장 시험</title>
      <body><main><h1>영어 이해·중 문장 시험</h1><p>2026학년도 2학기 · 3학년 7반 · 후보 20문장</p>
      <p>기존 운영 키로 최대 1회 생성합니다. 기존 문장 풀과 학생 자료는 변경하지 않습니다.</p>
      <p>실행 기록과 사용량만 저장하며 생성 결과는 이 화면에만 표시됩니다. 결과가 나오면 화면을 닫지 마세요.</p>
      ${used.length ? '<p>이미 시험 예산을 사용했습니다. 다시 호출하지 않습니다.</p>' : '<form method="post" action="/api/comment-pools/trial"><button type="submit">영어 20문장 시험 생성 · 1회</button></form>'}
      <p><a href="/">기록샘으로 돌아가기</a></p></main></body></html>`, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "X-Content-Type-Options": "nosniff" },
    });
  } catch { return json({ error: "시험 준비 상태를 확인하지 못했습니다." }, 500); }
}

export async function POST(request: Request) {
  const json = (value: unknown, status = 200) => trialResponse(value, status, request.headers.get("accept") ?? "");
  try {
    const user = await getAuthUser();
    const access = trialAccess(user?.email, request.headers.get("origin"));
    if (access !== 200 || !user) return json({ error: "허용되지 않거나 만료된 시험입니다." }, access);
    // No caller-supplied scope, prompt, model, count or retry budget.
    const classroom = await selectRows<{ id: number }>("classrooms", {
      id: eq(POOL_TRIAL.classId), owner_id: eq(user.id), school_year: eq(2026), semester: eq(2), grade: eq(3), limit: 1,
    });
    if (classroom.length !== 1) return json({ error: "승인한 학급을 확인하지 못했습니다." }, 409);
    const plans = await selectRows<PoolPlanItem>("assessment_plans", {
      id: eq(POOL_TRIAL.planId), owner_id: eq(user.id), class_id: eq(POOL_TRIAL.classId), limit: 1,
    });
    const spec = buildCommentPoolSpecs(plans).find((s) => s.subject === POOL_TRIAL.subject && s.domain === POOL_TRIAL.domain && s.level === POOL_TRIAL.level);
    if (!spec || !/2\s*[~～∼-]\s*3|두세|두\s*세/.test(spec.criterion)) return json({ error: "승인한 영어 이해 중 평가기준을 확인하지 못했습니다." }, 409);
    const links = await selectRows<{ pool_version_id: number }>("assessment_plan_pool_links", {
      owner_id: eq(user.id), class_id: eq(POOL_TRIAL.classId), assessment_plan_id: eq(POOL_TRIAL.planId), order: "id.desc",
    });
    const versions = links.length ? await selectRows<{ id: number; criterion: string }>("comment_pool_versions", {
      id: `in.(${links.map((l) => Number(l.pool_version_id)).join(",")})`, subject: eq(spec.subject), level: eq(spec.level), domain: eq(spec.domain),
    }) : [];
    const version = links.map((l) => versions.find((v) => Number(v.id) === Number(l.pool_version_id) && v.criterion === spec.criterion)).find(Boolean);
    if (!version) return json({ error: "비교할 기존 문장 풀을 찾지 못했습니다." }, 409);
    const before = (await selectRows<{ sentence: string }>("comment_pool_sentences", {
      pool_version_id: eq(version.id), status: eq("approved"), order: "id.asc",
    })).map((r) => r.sentence);
    if (!(await checkAiUsage(user.id)).allowed) return json({ error: "잠시 후 다시 시도해 주세요." }, 429);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json({ error: "운영 AI 설정을 확인해 주세요." }, 503);
    const model = primaryAiModel();
    let claimed = false;
    try {
      return await claimAndRunTrial(async () => {
        await insertRows("generation_jobs", [{
          id: POOL_TRIAL.id, owner_id: user.id, owner_email: user.email, class_id: POOL_TRIAL.classId,
          job_type: "comment-pools", status: "cancelled", batches: [],
          total_batches: 0, total_items: 0, error_message: "One-shot non-persistent trial budget consumed; never resume.",
        }]);
        claimed = true;
      }, async () => {
        const started = Date.now();
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST", signal: AbortSignal.timeout(240_000),
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, reasoning: { effort: "none" }, store: false, max_output_tokens: 10000,
            input: [{ role: "system", content: [{ type: "input_text", text: commentPoolSystemPrompt }] },
              { role: "user", content: [{ type: "input_text", text: buildCommentPoolCandidatePrompt(spec, [], POOL_TRIAL.count) }] }],
            text: { verbosity: "medium", format: { type: "json_schema", name: "comment_pool_candidates", strict: true, schema: {
              type: "object", additionalProperties: false, required: ["candidates"], properties: {
                candidates: { type: "array", minItems: 20, maxItems: 20, items: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } } },
              },
            } } },
          }),
        });
        const payload = await response.json();
        if (!response.ok) return json({ error: `시험 생성 실패 (HTTP ${response.status}). 자동 재호출하지 않습니다.`, calls: 1 }, 502);
        const usage = { model, inputTokens: Number(payload.usage?.input_tokens) || 0, outputTokens: Number(payload.usage?.output_tokens) || 0,
          cachedInputTokens: Number(payload.usage?.input_tokens_details?.cached_tokens) || 0,
          cacheWriteTokens: Number(payload.usage?.input_tokens_details?.cache_write_tokens) || 0, totalTokens: Number(payload.usage?.total_tokens) || 0 };
        let usageRecorded = true;
        await recordAiUsage({ ownerId: user.id, ownerEmail: user.email, classId: POOL_TRIAL.classId, feature: "one-shot-pool-trial", ...usage }).catch(() => { usageRecorded = false; });
        const decoded = parseFirstJsonObject<{ candidates?: Array<{ text?: unknown }> }>(openAiOutputText(payload));
        const candidates = Array.isArray(decoded?.candidates) ? decoded.candidates.flatMap((c) => typeof c?.text === "string" ? [c.text] : []) : [];
        return json({ calls: 1, saved: false, elapsedMs: Date.now() - started, usage, usageRecorded,
          estimatedCostUsd: estimateAiCostUsd(usage), spec, before, candidates,
          validation: approvePoolCandidates(candidates, spec, []), quality: commentPoolQuality(candidates, spec.canonicalSentence),
        });
      });
    } catch {
      return json({ error: claimed ? "시험 호출이 중단됐습니다. 비용 보호를 위해 재호출하지 않습니다." : "시험 예산을 확보하지 못했습니다. 이미 실행했거나 연결을 확인해야 합니다.", calls: claimed ? 1 : 0 }, claimed ? 502 : 409);
    }
  } catch {
    return json({ error: "시험 사전 확인에 실패했습니다." }, 500);
  }
}
