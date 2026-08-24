import { waitUntil } from "@vercel/functions";
import { eq, selectRows, updateRows, upsertRows } from "../../../../db/supabase";
import { approvePoolCandidates, COMMENT_POOL_TARGET, normalizedPoolSentence, type CommentPoolSpec } from "../../../comment-pool-library";
import { signCommentJob, verifyCommentJob } from "../../../comment-generation";
import { primaryAiModel } from "../../../ai-model-policy";
import { recordAiUsage } from "../../../ai-usage";

export const maxDuration = 300;
type PoolBatch = { spec: CommentPoolSpec; poolVersionId: number; maxAttempts?: number };
type JobRow = {
  id: string; owner_id: string; owner_email: string; class_id: number; status: string; batches: PoolBatch[];
  current_batch: number; total_batches: number; total_items: number; completed_items: number; failed_items: number;
  error_message: string; updated_at: string; started_at?: string | null;
};

const commentPoolSystemPrompt = `# 역할
당신은 초등학교 담임교사의 학생평가 작성 전문가이다.
학교생활기록부의 교과학습발달상황에 사용할 검증용 교과 평어 문장 풀을 작성한다.
학생 개인정보나 학생별 결과는 작성하지 않는다.

# 목표
입력된 하나의 과목·영역·수준·평가기준을 바탕으로, 같은 수행 사실을 정확하게 유지하면서도 실제 표현 구조가 서로 다른 자연스러운 후보를 작성한다.

# 입력 자료
과목, 단원, 평가목표, 영역, 평가관점, 선택 수준, 선택 수준의 평가기준, 상·중·하 전체 기준, 기준 문장, 이미 승인된 문장이 제공된다.

# 핵심 지시
- 요청한 candidateCount만큼 완성 문장을 작성한다.
- 선택된 영역명·수준·평가기준만 학생이 실제 수행한 근거로 사용한다.
- 입력에 없는 영역·수준·활동·태도·성과·방법을 만들지 않는다.
- 상·중·하 전체 기준은 수준 간 의미가 섞이지 않았는지 비교하는 용도로만 사용한다.
- 수행 대상, 핵심 행동, 도움 여부, 일부·전체 범위, 완료·노력 상태와 수행 강도를 그대로 보존한다.

# 문장 작성 규칙
- 평가기준을 그대로 복사하지 말고 학교생활기록부 문장으로 자연스럽게 바꾸어 쓴다.
- 실제 관찰 가능한 행동과 수행 결과를 중심으로 작성한다.
- 학습 태도는 선택된 평가기준에 같은 의미가 명시된 경우에만 포함한다.
- 일반적인 칭찬보다 입력된 구체적 행동을 제시한다.
- 모든 문장은 긍정적이고 발전적인 관점으로 작성한다.
- 사실을 늘려 길이를 맞추지 않는다. 길이는 목표일 뿐이며 사실성과 자연스러움을 우선한다.
- 모든 문장은 줄바꿈 없이 자연스러운 직접 명사형 종결과 마침표로 끝낸다. 함·음·임 계열을 문맥에 맞게 사용한다.

# 다양성 설계
- 먼저 후보를 수행 대상 중심, 수행 과정 중심, 수행 결과 중심, 활용·표현 방식 중심으로 나누되 평가기준에 실제 근거가 있는 방식만 사용한다.
- 같은 시작 15자와 같은 핵심 서술어 골격이 전체 후보의 3분의 1을 넘지 않게 한다.
- 핵심 단어를 그대로 둔 채 조사·연결어·절 순서만 바꾼 문장은 서로 다른 후보로 세지 않는다.
- 이미 승인된 문장과 첫 구절, 핵심 동사 배열, 절의 전개 순서가 겹치지 않는 후보를 우선한다.
- 다양성을 만들 근거가 부족하면 새로운 사실이나 어색한 표현을 만들지 않는다. 정확성과 자연스러움이 다양성보다 우선한다.

# 수준 반영
- 상·중·하라는 이름만 보고 적극성·자기주도성·꾸준함·교사의 도움을 추정하지 않는다.
- 정확하게·비교적·대체로·일부·도움을 받아·노력함 같은 수행 정도는 선택된 평가기준과 같은 강도로 유지한다.
- 다른 수준에만 있는 도움, 일부 수행, 구체적 방법, 태도나 활동을 가져오지 않는다.

# 금지 표현과 형식
- 부족함, 미흡함, 못함, 어려워함, 이해하지 못함, 소극적임, 불성실함을 쓰지 않는다.
- 입력에 근거가 없는 뛰어남, 돋보임, 인상적임, 자신감, 주도성, 자발성을 쓰지 않는다.
- 하였다, 합니다, 입니다, 할 수 있다, 모습이다 같은 서술형 종결을 쓰지 않는다.
- 글 쓰기함, 글 씀, 만드는 모습임, 표현하는 과정임, 표현해 감처럼 어색하거나 간접적인 명사형을 쓰지 않는다.

# 출력
지정된 JSON 스키마만 출력한다. 제목·번호·설명·따옴표 밖의 부가 문장은 출력하지 않는다.`;

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
        role: "user", content: [{ type: "input_text", text: `# 이번 문장 풀\n과목: ${spec.subject}\n단원: ${spec.unit}\n평가목표: ${spec.goal}\n영역: ${spec.domain}\n평가관점: ${spec.perspective}\n선택 수준: ${spec.level}\n선택 수준 평가기준: ${spec.criterion}\n상·중·하 전체 기준: ${JSON.stringify(spec.levelCriteria)}\n의미 보존용 기준 문장: ${spec.canonicalSentence}\n이미 승인된 문장: ${JSON.stringify(existing)}\n\n# 요청\n이미 승인된 문장을 반복하지 말고 자연스러운 후보 ${count}개를 작성한다. 후보를 작성하기 전에 시작 방식과 문장 골격이 한쪽에 몰리지 않았는지 내부적으로 점검하되, 최종 출력에는 JSON 후보만 포함한다.` }],
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
    for (let attempt = 0; attempt < maxAttempts && approved.length < COMMENT_POOL_TARGET; attempt += 1) {
      const requestCount = Math.min(40, Math.max(20, (COMMENT_POOL_TARGET - approved.length) * 2));
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
