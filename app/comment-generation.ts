import { createHmac, timingSafeEqual } from "node:crypto";
import { upsertRows } from "../db/supabase";
import { commentEvidenceInstructions, commentLengthTarget, ensureGeneratedCommentPeriod, evidenceBlockingIssues, evidenceGroundingWarnings, generatedCommentFailureMessage, hasCompleteEvidenceCoverage, resolveGeneratedEvidenceItemId, validateGeneratedCommentPart } from "./comment-generation-policy";
import { CommentVariation } from "./comment-variation";
import { archiveComment } from "./record-revisions";
import { primaryAiModel } from "./ai-model-policy";
import { AiTokenUsage } from "./ai-usage";

export type CommentEvidenceItem = { assessmentIndex: number; text: string; level?: "상" | "중" | "하"; criterion?: string };
export type CommentEvidence = {
  studentId: number;
  subject: string;
  items: CommentEvidenceItem[];
  subjectItems?: CommentEvidenceItem[];
  forceRegenerateItems?: boolean;
  variation?: CommentVariation;
  itemVariations?: Record<number, CommentVariation>;
};
export type GeneratedComment = { studentId: number; subject: string; comment: string; candidates: string[]; generationLevels?: Array<{ assessmentIndex: number; level: string }> };
export type GeneratedCommentPart = { studentId: number; subject: string; assessmentIndex: number; evidence: string; text: string; warnings: string[] };
export type GeneratedCommentRejection = { studentId: number; subject: string; assessmentIndex: number; issues: string[] };
export type CommentBatchResult = { comments: GeneratedComment[]; parts: GeneratedCommentPart[]; rejections: GeneratedCommentRejection[]; usage: AiTokenUsage };
function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("").trim();
}

export async function generateCommentBatch(evidence: CommentEvidence[], avoidComments: string[] = [], repair = false, model = primaryAiModel()) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI 생성 설정이 아직 완료되지 않았습니다.");
  const evidenceItems = evidence.flatMap((item) => item.items.map((entry) => ({
    ...entry, key: `${item.studentId}|${item.subject}|${entry.assessmentIndex}`,
  })));
  const evidenceDictionary = Object.fromEntries(evidenceItems.map((item, index) => [`e${index + 1}`, {
    evidence: item.text,
    level: item.level,
    criterion: item.criterion,
    levelRules: commentEvidenceInstructions(item.criterion ?? item.text).instruction,
    lengthTarget: commentLengthTarget(item.criterion ?? item.text).label,
  }]));
  const evidenceIds = new Map(evidenceItems.map((item, index) => [item.key, `e${index + 1}`]));
  const requestEvidence = evidence.map((item) => ({
    studentId: item.studentId,
    subject: item.subject,
    itemIds: [...new Set(item.items
      .map((evidenceItem) => evidenceIds.get(`${item.studentId}|${item.subject}|${evidenceItem.assessmentIndex}`))
      .filter((id): id is string => Boolean(id)))],
    variation: item.variation,
    itemVariations: Object.fromEntries(item.items.map((entry) => [
      evidenceIds.get(`${item.studentId}|${item.subject}|${entry.assessmentIndex}`) ?? "",
      item.itemVariations?.[entry.assessmentIndex] ?? item.variation,
    ]).filter(([id]) => Boolean(id))),
  }));
  const resultSlotNames = evidence.map((_, index) => `result${index + 1}`);
  const resultSlotSchemas = Object.fromEntries(evidence.map((item, index) => {
    const itemIds = requestEvidence[index].itemIds;
    return [resultSlotNames[index], {
      type: "object",
      additionalProperties: false,
      required: ["studentId", "subject", "sentences"],
      properties: {
        studentId: { type: "integer", enum: [item.studentId] },
        subject: { type: "string", enum: [item.subject] },
        sentences: {
          type: "array",
          minItems: itemIds.length,
          maxItems: itemIds.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["itemId", "candidates"],
            properties: {
              itemId: { type: "string", enum: itemIds },
              candidates: {
                type: "array",
                minItems: 1,
                maxItems: 1,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["text"],
                  properties: {
                    text: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    }];
  }));
  const avoidanceHints = [...new Set(avoidComments.map((item) => item.split(/[.!?]/)[0]?.trim().slice(0, 90)).filter(Boolean))].slice(0, 20);
  const repairInstruction = repair
    ? "이전 응답에서 저장되지 않은 영역만 보완한다. 표현 다양화보다 평가기준의 수행 수준과 필수 조건을 빠짐없이 보존하는 것을 우선한다. 평가기준을 독립된 수행 요소로 나누어 하나도 생략하지 않는다. 특히 평가기준에 교사의 도움, 노력, 일부 수행, 나누기, 표현하기, 파악하기, 간추리기가 있으면 그 의미를 반드시 문장에 포함한다. 평가기준을 한 문장의 자연스러운 학교생활기록부 문체로 가깝게 바꾸어 쓰고, 입력에 없는 태도·활동·수행 방법은 덧붙이지 않는다. 길이를 늘리려고 차분하게·안정적으로·알차게·고르게·꾸준히 같은 수식어나 말하기·발표·간추리기 같은 새 활동을 추가하지 않는다. 근거 사전의 lengthTarget은 목표일 뿐이며 근거만으로 자연스럽게 완성되면 더 짧거나 길어도 된다. itemId마다 정확히 한 문장을 반환한다."
    : "각 문장은 근거 사전의 lengthTarget을 목표로 하되 자연스러운 완성 문장과 사실 보존을 우선한다. 각 영역의 itemVariations는 시작·어순·동사 배치·종결 방식만 결정하며 입력에 없는 사실을 추가하는 지시가 아니다. 같은 요청 안에서 첫 10~15자와 문장 뼈대를 반복하지 않는다.";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "none" },
      store: false,
      max_output_tokens: 10000,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "당신은 초등학교 담임교사의 학생평가 작성 전문가이며 학교생활기록부 교과학습발달상황에 사용할 교과 평어를 작성한다. 학생 입력의 itemIds에 연결된 각 평가 영역마다 해당 수준에 맞는 평가 문장을 정확히 1개씩 작성한다. 입력된 영역 개수와 문장 수는 반드시 같아야 하며 영역명·수준·평가기준을 그대로 근거로 삼고 입력에 없는 영역·수준·사실을 만들지 않는다. 평가기준 문장을 그대로 복사하지 말고 실제 관찰 가능한 행동 중심으로 자연스럽게 바꾸어 쓴다. 성취기준과 평가요소, 수업·평가 활동에서 수행한 내용과 결과가 구체적으로 드러나게 하고 일반적인 칭찬보다 구체적인 행동을 제시한다. 학습 태도는 연결된 평가 근거에서 확인되는 경우에만 수행 결과와 함께 기술한다. 모든 문장은 서로 다른 내용과 문형으로 긍정적이고 발전적인 관점에서 작성한다. 상은 잘함, 중은 보통, 하는 노력 요함에 대응하되 각 수준에 연결된 실제 기준만 반영한다. 상 수준은 입력된 상 기준에 나타난 수행 정도, 중 수준은 입력된 중 기준의 수행 범위, 하 수준은 입력된 하 기준의 도움·노력·과정을 그대로 반영한다. 다른 수준 기준에만 있는 정확하게·실감 나게·다양한 방법·이해하기 쉽게 같은 표현을 가져오지 않는다. 수준 이름만 보고 적극성·자기주도성·꾸준함·협력·교사의 도움을 추측하지 않으며, 이런 태도와 과정은 평가 근거에 같은 의미가 명시된 경우에만 쓴다. 근거에 없는 태도나 과정을 문장 길이 확보 또는 표현 다양화 목적으로 추가하지 않는다. 부족함, 미흡함, 못함, 어려워함, 이해하지 못함, 소극적임, 불성실함을 쓰지 않는다. 각 itemId마다 candidates를 정확히 1개 작성하고 후보는 {text} 형식의 완성 문장으로 작성한다. text는 근거 사전의 lengthTarget을 목표로 하되 평가기준의 정보량보다 길이를 우선하지 않는다. 짧은 기준을 억지로 늘리지 않고 모든 핵심 수행 요소를 담은 자연스러운 문장을 작성한다. 모든 문장은 반드시 학교생활기록부에 적합한 관찰 기반 명사형 종결 표현과 마침표로 끝낸다. 허용 예시는 ‘정확하게 설명함.’, ‘적극적으로 참여함.’, ‘자신의 생각을 구체적으로 표현함.’, ‘문제를 해결하는 능력이 뛰어남.’, ‘학습 내용을 적용하는 태도가 돋보임.’, ‘꾸준히 성장하는 모습이 인상적임.’이다. 여기서 명사형 종결은 문자 그대로 ‘함.’만 뜻하지 않으며 함·음·임 계열의 자연스러운 표현을 뜻한다. ‘하였다.’, ‘합니다.’, ‘입니다.’, ‘할 수 있다.’, ‘모습이다.’ 같은 서술형 종결은 절대 사용하지 않는다. 서술어를 기계적으로 이어 붙이지 말고 문장 전체를 소리 내어 읽었을 때 자연스러운지 확인한다. 각 영역은 itemVariations의 시작 방식·문장 구조·전개 순서·동사 배치·종결 방식을 표현상의 차이로만 반영하되 ‘평가 활동’, ‘평가 요소’, ‘평가 근거’, ‘성취기준’, ‘수준 기준’ 같은 메타 표현을 결과 문장에 직접 쓰지 않는다. 같은 묶음에서는 학생마다 첫 10~15자, 첫 핵심 동사, 문장 구조가 서로 달라야 하며 두 학생의 text 전체를 완전히 동일하게 작성해서는 안 된다. 평가기준 원문의 첫 구절을 모든 학생에게 그대로 반복하지 않고 avoidComments에 포함된 기존 문장의 첫 구절도 다시 사용하지 않는다. 다양성을 위해 입력에 없는 활동이나 태도를 만들지는 않는다. 사실성과 수준 의미가 다양성보다 항상 우선한다. 최종 본문은 입력 영역 순서대로 문장을 이어 붙인 한 문단이며 각 문장은 마침표 뒤 한 칸으로 구분한다. 제목·번호·설명·따옴표·상중하 표시는 쓰지 않는다. results 객체의 result1, result2 등 각 고정 슬롯을 빠짐없이 작성한다. 각 슬롯의 studentId와 subject는 스키마가 지정한 값을 그대로 사용하고 sentences는 지정된 itemIds와 같은 순서로 작성한다. candidates는 정확히 1개이다." }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: `${repairInstruction}\n근거 사전과 학생별 근거 ID를 연결하여 각각 교과 평어를 작성해 줘. 각 text의 모든 행동·태도·과정·수행 방법은 연결된 itemId의 evidence와 criterion에서 직접 확인할 수 있어야 한다. 문장 다양화나 길이 확보를 위해 다른 itemId의 내용 또는 일반적인 칭찬·태도 수식어를 가져오지 않는다. 모든 text는 반드시 자연스러운 명사형 종결로 끝내고, 작성 후 연결된 근거에서 확인할 수 없는 표현은 삭제해. itemVariations의 지시문 자체는 결과에 쓰지 마.\n근거 사전: ${JSON.stringify(evidenceDictionary)}\n학생 입력: ${JSON.stringify(requestEvidence)}\n피해야 할 기존 시작 표현: ${JSON.stringify(avoidanceHints)}` }],
        },
      ],
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "student_comment_batch",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["results"],
            properties: {
              results: {
                type: "object",
                additionalProperties: false,
                required: resultSlotNames,
                properties: resultSlotSchemas,
              },
            },
          },
        },
      },
    }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const upstream = payload && typeof payload === "object"
      ? (payload as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
    const code = typeof upstream?.code === "string" ? upstream.code : `HTTP ${response.status}`;
    const message = typeof upstream?.message === "string" ? upstream.message.slice(0, 600) : "";
    throw new Error(`AI 생성 요청을 처리하지 못했습니다. (${code})${message ? ` ${message}` : ""}`);
  }
  const raw = extractOutputText(payload).replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const decoded = JSON.parse(raw) as { results?: unknown };
  const parsed = decoded.results && typeof decoded.results === "object" && !Array.isArray(decoded.results)
    ? Object.values(decoded.results) as Array<{ studentId?: unknown; subject?: unknown; sentences?: unknown }>
    : [];
  const allowed = new Set(evidence.map((item) => `${item.studentId}|${item.subject}`));
  const failureMessages: string[] = [];
  const parts: GeneratedCommentPart[] = [];
  const rejections: GeneratedCommentRejection[] = [];
  const comments = Array.isArray(parsed) ? parsed.flatMap((item) => {
    const studentId = Number(item.studentId);
    const subject = typeof item.subject === "string" ? item.subject : "";
    const source = evidence.find((entry) => entry.studentId === studentId && entry.subject === subject);
    const expectedIds = [...new Set(source?.items
      .map((evidenceItem) => evidenceIds.get(`${studentId}|${subject}|${evidenceItem.assessmentIndex}`))
      .filter((id): id is string => Boolean(id)) ?? [])];
    const rawSentences = Array.isArray(item.sentences) ? item.sentences : [];
    const sentenceRows = rawSentences.length
      ? rawSentences.flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const value = row as { itemId?: unknown; candidates?: unknown };
          if (!Array.isArray(value.candidates)) return [];
          const candidates = value.candidates.flatMap((candidate) => {
            if (!candidate || typeof candidate !== "object") return [];
            const generated = candidate as { text?: unknown };
            return typeof generated.text === "string" ? [generated.text] : [];
          });
          const text = candidates.map(ensureGeneratedCommentPeriod).find(Boolean);
          const itemId = resolveGeneratedEvidenceItemId(expectedIds, value.itemId, rawSentences.length);
          return text && itemId ? [{ itemId, text, candidateLengths: candidates.map((candidate) => Array.from(candidate).length) }] : [];
        })
      : [];
    const acceptedSentenceRows: typeof sentenceRows = [];
    for (const row of sentenceRows) {
      const evidenceEntry = source?.items.find((entry) =>
        evidenceIds.get(`${studentId}|${subject}|${entry.assessmentIndex}`) === row.itemId);
      if (evidenceEntry) {
        const format = validateGeneratedCommentPart(row.text, evidenceEntry.criterion ?? evidenceEntry.text);
        if (!format.valid) {
          rejections.push({
            studentId,
            subject,
            assessmentIndex: evidenceEntry.assessmentIndex,
            issues: [
              ...(!format.acceptedLength ? [`허용 길이 35~90자를 벗어난 ${format.lengths[0] ?? 0}자 문장`] : []),
              ...(!format.endingsOk ? ["자연스러운 명사형 종결 형식 미준수"] : []),
              ...(!format.naturalEndingsOk ? ["부자연스러운 문장 종결"] : []),
              ...(format.forbidden.length ? [`금지 표현 포함: ${format.forbidden.join(", ")}`] : []),
            ],
          });
          continue;
        }
        const blockingIssues = evidenceBlockingIssues(row.text, evidenceEntry.text, evidenceEntry.criterion ?? evidenceEntry.text);
        if (blockingIssues.length) {
          rejections.push({ studentId, subject, assessmentIndex: evidenceEntry.assessmentIndex, issues: blockingIssues });
          continue;
        }
        acceptedSentenceRows.push(row);
        parts.push({
          studentId,
          subject,
          assessmentIndex: evidenceEntry.assessmentIndex,
          evidence: evidenceEntry.text,
          text: row.text,
          warnings: [...format.warnings, ...evidenceGroundingWarnings(row.text, evidenceEntry.text)],
        });
      }
    }
    const complete = hasCompleteEvidenceCoverage(expectedIds, acceptedSentenceRows.map((row) => row.itemId));
    const ordered = expectedIds.map((id) => acceptedSentenceRows.find((row) => row.itemId === id)?.text ?? "");
    const sentenceFormatsOk = ordered.length > 0
      && ordered.every((sentence, index) => validateGeneratedCommentPart(sentence, source?.items[index]?.criterion ?? source?.items[index]?.text ?? "").valid);
    if (!complete || !sentenceFormatsOk) {
      failureMessages.push(generatedCommentFailureMessage({
        expectedIds,
        returnedIds: acceptedSentenceRows.map((row) => row.itemId),
        invalidSentenceCount: ordered.filter((sentence, index) => !sentence || !validateGeneratedCommentPart(sentence, source?.items[index]?.criterion ?? source?.items[index]?.text ?? "").valid).length,
      }));
    }
    const candidates = sentenceFormatsOk ? [ordered.join(" ")] : [];
    return allowed.has(`${studentId}|${subject}`) && candidates.length && complete
      ? [{ studentId, subject, comment: candidates[0], candidates }]
      : [];
  }) : [];
  if (!comments.length && !parts.length) {
    if (!rejections.length) throw new Error(failureMessages[0] ?? "AI 결과를 확인하지 못했습니다. 기존 결과는 유지하며 완료되지 않은 영역만 다시 생성합니다.");
  }
  const responseUsage = payload && typeof payload === "object"
    ? (payload as { usage?: { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } } }).usage
    : undefined;
  return {
    comments,
    parts,
    rejections,
    usage: {
      model,
      inputTokens: Number(responseUsage?.input_tokens) || 0,
      cachedInputTokens: Number(responseUsage?.input_tokens_details?.cached_tokens) || 0,
      outputTokens: Number(responseUsage?.output_tokens) || 0,
      totalTokens: Number(responseUsage?.total_tokens) || 0,
    },
  } satisfies CommentBatchResult;
}

export async function saveGeneratedComments(input: {
  ownerId: string;
  ownerEmail: string;
  classId: number;
  comments: GeneratedComment[];
}) {
  const updatedAt = new Date().toISOString();
  await Promise.all(input.comments.map((item) => archiveComment({
    ownerId: input.ownerId,
    ownerEmail: input.ownerEmail,
    classId: input.classId,
    studentId: item.studentId,
    subject: item.subject,
    nextContent: item.comment,
    source: "ai-regeneration",
  })));
  await upsertRows("generated_comments", input.comments.map((item) => ({
    student_id: item.studentId,
    subject: item.subject,
    comment: item.comment,
    candidates: item.candidates,
    generation_levels: item.generationLevels ?? [],
    confirmed: false,
    confirmed_at: null,
    updated_at: updatedAt,
    owner_email: input.ownerEmail,
    owner_id: input.ownerId,
    class_id: input.classId,
  })), "class_id,student_id,subject");
}

export async function saveGeneratedCommentParts(input: {
  ownerId: string;
  ownerEmail: string;
  classId: number;
  parts: Array<GeneratedCommentPart & { attempts: number; status?: "complete" | "warning" | "needs_review"; issues?: string[] }>;
}) {
  const updatedAt = new Date().toISOString();
  await upsertRows("generated_comment_parts", input.parts.map((item) => ({
    owner_id: input.ownerId,
    owner_email: input.ownerEmail,
    class_id: input.classId,
    student_id: item.studentId,
    subject: item.subject,
    assessment_index: item.assessmentIndex,
    evidence: item.evidence,
    sentence: item.text,
    status: item.status ?? (item.warnings.length ? "warning" : "complete"),
    issues: item.issues ?? item.warnings,
    attempts: item.attempts,
    updated_at: updatedAt,
  })), "class_id,student_id,subject,assessment_index");
}

const signingKey = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Background job signing configuration is missing");
  return key;
};

export const signCommentJob = (jobId: string) =>
  createHmac("sha256", signingKey()).update(`comment-job:${jobId}`).digest("hex");

export function verifyCommentJob(jobId: string, signature: string) {
  const expected = signCommentJob(jobId);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export const commentJobCronSecret = () =>
  createHmac("sha256", signingKey()).update("comment-job-cron:v1").digest("hex");
