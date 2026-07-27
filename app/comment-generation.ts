import { createHmac, timingSafeEqual } from "node:crypto";
import { upsertRows } from "../db/supabase";
import { hasCompleteEvidenceCoverage, validateGeneratedComment, validateGeneratedCommentPart } from "./comment-generation-policy";
import { CommentVariation } from "./comment-variation";
import { archiveComment } from "./record-revisions";
import { primaryAiModel } from "./ai-model-policy";
import { AiTokenUsage } from "./ai-usage";

export type CommentEvidenceItem = { assessmentIndex: number; text: string };
export type CommentEvidence = { studentId: number; subject: string; items: CommentEvidenceItem[]; variation?: CommentVariation };
export type GeneratedComment = { studentId: number; subject: string; comment: string; candidates: string[] };
export type GeneratedCommentPart = { studentId: number; subject: string; assessmentIndex: number; evidence: string; text: string; warnings: string[] };
export type CommentBatchResult = { comments: GeneratedComment[]; parts: GeneratedCommentPart[]; usage: AiTokenUsage };
const COMMENT_ENDINGS = [
  "참여함.", "표현함.", "설명함.", "정리함.", "수행함.", "실천함.",
  "발표함.", "활용함.", "작성함.", "해결함.", "적용함.", "연주함.",
  "관찰함.", "계산함.", "구별함.", "이해함.", "탐구함.", "비교함.",
] as const;

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("").trim();
}

function normalizeCandidateLength(candidate: string) {
  if (validateGeneratedCommentPart(candidate).valid) return candidate;
  const length = Array.from(candidate).length;
  if (length >= 45 && length < 50 && !candidate.startsWith("수업에서 ")) {
    const contextualized = `수업에서 ${candidate}`;
    if (validateGeneratedCommentPart(contextualized).valid) return contextualized;
  }
  if (length > 60 && length <= 75) {
    const optionalModifiers = [
      "자기 주도적으로 ", "적극적으로 ", "구체적으로 ", "논리적으로 ",
      "자연스럽게 ", "효과적으로 ", "능동적으로 ", "정확하게 ",
      "성실하게 ", "꾸준하게 ", "꾸준히 ", "알맞게 ",
    ];
    let compacted = candidate;
    for (const modifier of optionalModifiers) {
      if (!compacted.includes(modifier)) continue;
      compacted = compacted.replace(modifier, "");
      if (validateGeneratedCommentPart(compacted).valid) return compacted;
    }
  }
  return "";
}

export async function generateCommentBatch(evidence: CommentEvidence[], avoidComments: string[] = [], repair = false, model = primaryAiModel()) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI 생성 설정이 아직 완료되지 않았습니다.");
  const evidenceItems = evidence.flatMap((item) => item.items.map((entry) => ({
    ...entry, key: `${item.studentId}|${item.subject}|${entry.assessmentIndex}`,
  })));
  const evidenceDictionary = Object.fromEntries(evidenceItems.map((item, index) => [`e${index + 1}`, item.text]));
  const evidenceIds = new Map(evidenceItems.map((item, index) => [item.key, `e${index + 1}`]));
  const requestEvidence = evidence.map((item) => ({
    studentId: item.studentId,
    subject: item.subject,
    itemIds: [...new Set(item.items
      .map((evidenceItem) => evidenceIds.get(`${item.studentId}|${item.subject}|${evidenceItem.assessmentIndex}`))
      .filter((id): id is string => Boolean(id)))],
    variation: item.variation,
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
                  required: ["body", "ending"],
                  properties: {
                    body: { type: "string" },
                    ending: { type: "string", enum: COMMENT_ENDINGS },
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
          content: [{ type: "input_text", text: "당신은 초등학교 담임교사의 학생평가 작성 전문가이며 학교생활기록부 교과학습발달상황에 사용할 교과 평어를 작성한다. 학생 입력의 itemIds에 연결된 각 평가 영역마다 해당 수준에 맞는 문장을 정확히 1개씩 작성한다. 영역 수와 문장 수는 반드시 같아야 하며 입력된 영역명·수준·평가기준만 사용하고 없는 영역·수준·사실을 만들지 않는다. 각 문장은 평가기준을 그대로 복사하지 말고 실제 관찰 가능한 행동 중심으로 자연스럽게 바꾸어 쓴다. 성취기준과 평가요소, 수업·평가 활동의 수행 내용, 수행 결과와 학습 태도가 구체적으로 드러나게 작성한다. 일반적인 칭찬을 피하고 모든 문장을 긍정적·발전적 관점으로 작성한다. 상 수준은 안정적인 수행과 정확성·적극성·자기주도성이, 중 수준은 대부분의 성취기준 수행과 꾸준한 참여·적절한 적용이, 하 수준은 활동 참여와 배운 내용을 익혀 가는 과정·교사의 도움을 받아 수행하는 모습·성장 가능성이 드러나게 작성한다. 부족함, 미흡함, 못함, 어려워함, 이해하지 못함, 소극적임, 불성실함을 쓰지 않는다. 각 itemId마다 candidates를 정확히 1개 작성한다. 후보는 body와 ending으로 나눈다. body는 마침표와 마지막 서술어 없이 작성하고, 선택한 ending을 한 칸 띄워 붙였을 때 50~60자의 문법적으로 자연스러운 완성 문장이 되어야 한다. 예: body가 ‘인물의 상황에 맞는 표정과 몸짓을 활용해 대화를 실감 나게’이면 ending은 ‘표현함.’을 선택한다. 연결형 뒤에 함을 억지로 덧붙이지 않는다. variation에 지정된 시작 방식을 첫 문장 첫 구절에 실제로 반영한다. 같은 묶음에서는 학생마다 첫 10~15자, 첫 핵심 동사, 문장 구조가 서로 달라야 한다. 평가기준 원문의 첫 구절을 모든 학생에게 그대로 반복하지 않는다. avoidComments에 포함된 기존 문장의 첫 구절도 다시 사용하지 않는다. 다양성을 위해 입력에 없는 활동이나 태도를 만들지는 않는다. 제목·번호·설명·따옴표·상중하 표시는 쓰지 않는다. results 객체의 result1, result2 등 각 고정 슬롯을 빠짐없이 작성한다. 각 슬롯의 studentId와 subject는 스키마가 지정한 값을 그대로 사용하고 sentences는 지정된 itemIds와 같은 순서로 작성한다. candidates는 정확히 1개이며 후보는 {body, ending} 형식이다." }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: `${repair ? "이전 응답 문장이 검수를 통과하지 못했다. 해당 영역 문장 한 개만 규칙에 맞게 다시 작성해 줘.\n" : ""}근거 사전과 학생별 근거 ID를 연결하여 각각 교과 평어를 작성해 줘. 각 학생의 variation.opening을 첫 문장에 반드시 적용하고 같은 요청 안에서 첫 10~15자를 반복하지 마.\n근거 사전: ${JSON.stringify(evidenceDictionary)}\n학생 입력: ${JSON.stringify(requestEvidence)}\n피해야 할 기존 시작 표현: ${JSON.stringify(avoidanceHints)}` }],
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
  const diagnostics: string[] = [];
  const parts: GeneratedCommentPart[] = [];
  const comments = Array.isArray(parsed) ? parsed.flatMap((item) => {
    const studentId = Number(item.studentId);
    const subject = typeof item.subject === "string" ? item.subject : "";
    const source = evidence.find((entry) => entry.studentId === studentId && entry.subject === subject);
    const expectedIds = [...new Set(source?.items
      .map((evidenceItem) => evidenceIds.get(`${studentId}|${subject}|${evidenceItem.assessmentIndex}`))
      .filter((id): id is string => Boolean(id)) ?? [])];
    const sentenceRows = Array.isArray(item.sentences)
      ? item.sentences.flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const value = row as { itemId?: unknown; candidates?: unknown };
          if (typeof value.itemId !== "string" || !Array.isArray(value.candidates)) return [];
          const candidates = value.candidates.flatMap((candidate) => {
            if (!candidate || typeof candidate !== "object") return [];
            const item = candidate as { body?: unknown; ending?: unknown };
            return typeof item.body === "string"
              && typeof item.ending === "string"
              && COMMENT_ENDINGS.includes(item.ending as typeof COMMENT_ENDINGS[number])
              ? [`${item.body.trim().replace(/[.。]+$/, "")} ${item.ending}`]
              : [];
          });
          const text = candidates.map(normalizeCandidateLength).find(Boolean);
          return text ? [{ itemId: value.itemId, text, candidateLengths: candidates.map((candidate) => Array.from(candidate).length) }] : [];
        })
      : [];
    const complete = hasCompleteEvidenceCoverage(expectedIds, sentenceRows.map((row) => row.itemId));
    for (const row of sentenceRows) {
      const evidenceEntry = source?.items.find((entry) =>
        evidenceIds.get(`${studentId}|${subject}|${entry.assessmentIndex}`) === row.itemId);
      if (evidenceEntry) {
        parts.push({
          studentId,
          subject,
          assessmentIndex: evidenceEntry.assessmentIndex,
          evidence: evidenceEntry.text,
          text: row.text,
          warnings: validateGeneratedCommentPart(row.text).warnings,
        });
      }
    }
    const ordered = expectedIds.map((id) => sentenceRows.find((row) => row.itemId === id)?.text ?? "");
    const sentenceFormatsOk = ordered.length > 0
      && ordered.every((sentence) => validateGeneratedCommentPart(sentence).valid);
    if (!complete || !sentenceFormatsOk) {
      diagnostics.push(JSON.stringify({
        studentId,
        subject,
        expectedIds,
        returnedIds: sentenceRows.map((row) => row.itemId),
        lengths: ordered.map((sentence) => Array.from(sentence).length),
        candidateLengths: sentenceRows.map((row) => row.candidateLengths),
        endings: ordered.map((sentence) => sentence.endsWith("함.")),
        forbidden: ordered.flatMap((sentence) => validateGeneratedComment(sentence, 1).forbidden),
      }));
    }
    const candidates = sentenceFormatsOk ? [ordered.join(" ")] : [];
    const format = candidates.length ? validateGeneratedComment(candidates[0], expectedIds.length) : null;
    return allowed.has(`${studentId}|${subject}`) && candidates.length && complete && format?.valid
      ? [{ studentId, subject, comment: candidates[0], candidates }]
      : [];
  }) : [];
  if (!comments.length && !parts.length) {
    const detail = diagnostics.slice(0, 3).join(" | ");
    throw new Error(`AI 결과가 영역별 1문장·50~60자·함 종결 검수를 통과하지 못했습니다.${detail ? ` 진단: ${detail}` : ""}`);
  }
  const responseUsage = payload && typeof payload === "object"
    ? (payload as { usage?: { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } } }).usage
    : undefined;
  return {
    comments,
    parts,
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
