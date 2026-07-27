import { createHmac, timingSafeEqual } from "node:crypto";
import { upsertRows } from "../db/supabase";
import { hasCompleteEvidenceCoverage, validateGeneratedComment } from "./comment-generation-policy";
import { CommentVariation } from "./comment-variation";
import { archiveComment } from "./record-revisions";
import { primaryAiModel } from "./ai-model-policy";

export type CommentEvidence = { studentId: number; subject: string; items: string[]; variation?: CommentVariation };
export type GeneratedComment = { studentId: number; subject: string; comment: string; candidates: string[] };

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("").trim();
}

function normalizeCandidateLength(candidate: string) {
  if (validateGeneratedComment(candidate, 1).valid) return candidate;
  const length = Array.from(candidate).length;
  if (length >= 45 && length < 50 && !candidate.startsWith("수업에서 ")) {
    const contextualized = `수업에서 ${candidate}`;
    if (validateGeneratedComment(contextualized, 1).valid) return contextualized;
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
      if (validateGeneratedComment(compacted, 1).valid) return compacted;
    }
  }
  return "";
}

export async function generateCommentBatch(evidence: CommentEvidence[], avoidComments: string[] = [], repair = false, model = primaryAiModel()) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI 생성 설정이 아직 완료되지 않았습니다.");
  const evidenceItems = [...new Set(evidence.flatMap((item) => item.items))];
  const evidenceDictionary = Object.fromEntries(evidenceItems.map((item, index) => [`e${index + 1}`, item]));
  const evidenceIds = new Map(evidenceItems.map((item, index) => [item, `e${index + 1}`]));
  const requestEvidence = evidence.map((item) => ({
    studentId: item.studentId,
    subject: item.subject,
    itemIds: [...new Set(item.items
      .map((evidenceItem) => evidenceIds.get(evidenceItem))
      .filter((id): id is string => Boolean(id)))],
    variation: item.variation,
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
          content: [{ type: "input_text", text: "당신은 초등학교 담임교사의 학생평가 작성 전문가이며 학교생활기록부 교과학습발달상황에 사용할 교과 평어를 작성한다. 학생 입력의 itemIds에 연결된 각 평가 영역마다 해당 수준에 맞는 문장을 정확히 1개씩 작성한다. 영역 수와 문장 수는 반드시 같아야 하며 입력된 영역명·수준·평가기준만 사용하고 없는 영역·수준·사실을 만들지 않는다. 각 문장은 평가기준을 그대로 복사하지 말고 실제 관찰 가능한 행동 중심으로 자연스럽게 바꾸어 쓴다. 성취기준과 평가요소, 수업·평가 활동의 수행 내용, 수행 결과와 학습 태도가 구체적으로 드러나게 작성한다. 일반적인 칭찬을 피하고 모든 문장을 긍정적·발전적 관점으로 작성한다. 상 수준은 안정적인 수행과 정확성·적극성·자기주도성이, 중 수준은 대부분의 성취기준 수행과 꾸준한 참여·적절한 적용이, 하 수준은 활동 참여와 배운 내용을 익혀 가는 과정·교사의 도움을 받아 수행하는 모습·성장 가능성이 드러나게 작성한다. 부족함, 미흡함, 못함, 어려워함, 이해하지 못함, 소극적임, 불성실함을 쓰지 않는다. 각 itemId마다 candidates를 정확히 1개 작성한다. stem에는 마침표와 종결어미를 제외한 48~58자의 본문만 쓰며 ending의 ‘함.’을 붙였을 때 전체 문장이 50~60자가 되고 자연스러워야 한다. variation의 구조·시작 방식·근거 순서를 활용하며 같은 묶음 학생 및 avoidComments와 표현을 겹치지 않게 한다. 제목·번호·설명·따옴표·상중하 표시는 쓰지 않는다. 모든 입력 학생을 빠짐없이 한 번씩 작성하며 results 원소 수는 학생 입력 수와 반드시 같아야 한다. 각 원소는 studentId, subject, sentences 필드를 가지며 sentences는 입력 itemIds와 같은 순서의 {itemId, candidates} 배열이다. candidates는 정확히 1개이며 {stem, ending}이고 ending은 반드시 스키마가 지정한 ‘함.’을 사용한다." }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: `${repair ? "이전 응답의 후보들이 글자 수 검사를 통과하지 못했다. 세 후보의 길이 차이를 반드시 유지해 줘.\n" : ""}근거 사전과 학생별 근거 ID를 연결하여 각각 교과 평어를 작성해 줘.\n근거 사전: ${JSON.stringify(evidenceDictionary)}\n학생 입력: ${JSON.stringify(requestEvidence)}\n피해야 할 기존 시작 표현: ${JSON.stringify(avoidanceHints)}` }],
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
                type: "array",
                minItems: evidence.length,
                maxItems: evidence.length,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["studentId", "subject", "sentences"],
                  properties: {
                    studentId: { type: "integer" },
                    subject: { type: "string" },
                    sentences: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["itemId", "candidates"],
                        properties: {
                          itemId: { type: "string" },
                          candidates: {
                            type: "array",
                            minItems: 1,
                            maxItems: 1,
                            items: {
                              type: "object",
                              additionalProperties: false,
                              required: ["stem", "ending"],
                              properties: {
                                stem: { type: "string" },
                                ending: { type: "string", enum: ["함."] },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error("AI 생성 요청을 처리하지 못했습니다.");
  const raw = extractOutputText(payload).replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const decoded = JSON.parse(raw) as { results?: unknown };
  const parsed = Array.isArray(decoded.results)
    ? decoded.results as Array<{ studentId?: unknown; subject?: unknown; sentences?: unknown }>
    : [];
  const allowed = new Set(evidence.map((item) => `${item.studentId}|${item.subject}`));
  const diagnostics: string[] = [];
  const comments = Array.isArray(parsed) ? parsed.flatMap((item) => {
    const studentId = Number(item.studentId);
    const subject = typeof item.subject === "string" ? item.subject : "";
    const source = evidence.find((entry) => entry.studentId === studentId && entry.subject === subject);
    const expectedIds = [...new Set(source?.items
      .map((evidenceItem) => evidenceIds.get(evidenceItem))
      .filter((id): id is string => Boolean(id)) ?? [])];
    const sentenceRows = Array.isArray(item.sentences)
      ? item.sentences.flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const value = row as { itemId?: unknown; candidates?: unknown };
          if (typeof value.itemId !== "string" || !Array.isArray(value.candidates)) return [];
          const candidates = value.candidates.flatMap((candidate) => {
            if (!candidate || typeof candidate !== "object") return [];
            const item = candidate as { stem?: unknown; ending?: unknown };
            return typeof item.stem === "string" && item.ending === "함."
              ? [`${item.stem.trim().replace(/[.。]+$/, "")}함.`]
              : [];
          });
          const text = candidates.map(normalizeCandidateLength).find(Boolean);
          return text ? [{ itemId: value.itemId, text, candidateLengths: candidates.map((candidate) => Array.from(candidate).length) }] : [];
        })
      : [];
    const complete = hasCompleteEvidenceCoverage(expectedIds, sentenceRows.map((row) => row.itemId));
    const ordered = expectedIds.map((id) => sentenceRows.find((row) => row.itemId === id)?.text ?? "");
    const sentenceFormatsOk = ordered.length > 0
      && ordered.every((sentence) => validateGeneratedComment(sentence, 1).valid);
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
  if (!comments.length) {
    const detail = diagnostics.slice(0, 3).join(" | ");
    throw new Error(`AI 결과가 영역별 1문장·50~60자·함 종결 검수를 통과하지 못했습니다.${detail ? ` 진단: ${detail}` : ""}`);
  }
  return comments;
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
