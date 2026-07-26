import { createHmac, timingSafeEqual } from "node:crypto";
import { upsertRows } from "../db/supabase";
import { hasCompleteEvidenceCoverage, validateGeneratedComment } from "./comment-generation-policy";
import { CommentVariation } from "./comment-variation";
import { archiveComment } from "./record-revisions";

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

export async function generateCommentBatch(evidence: CommentEvidence[], avoidComments: string[] = [], repair = false) {
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
      model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
      reasoning: { effort: "none" },
      store: false,
      max_output_tokens: 10000,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "당신은 초등학교 담임교사의 학생평가 작성 전문가이며 학교생활기록부 교과학습발달상황에 사용할 교과 평어를 작성한다. 학생 입력의 itemIds에 연결된 각 평가 영역마다 해당 수준에 맞는 문장을 정확히 1개씩 작성한다. 영역 수와 문장 수는 반드시 같아야 하며 입력된 영역명·수준·평가기준만 사용하고 없는 영역·수준·사실을 만들지 않는다. 각 문장은 평가기준을 그대로 복사하지 말고 실제 관찰 가능한 행동 중심으로 자연스럽게 바꾸어 쓴다. 성취기준과 평가요소, 수업·평가 활동의 수행 내용, 수행 결과와 학습 태도가 구체적으로 드러나게 작성한다. 일반적인 칭찬을 피하고 모든 문장을 긍정적·발전적 관점으로 작성한다. 상 수준은 안정적인 수행과 정확성·적극성·자기주도성이, 중 수준은 대부분의 성취기준 수행과 꾸준한 참여·적절한 적용이, 하 수준은 활동 참여와 배운 내용을 익혀 가는 과정·교사의 도움을 받아 수행하는 모습·성장 가능성이 드러나게 작성한다. 부족함, 미흡함, 못함, 어려워함, 이해하지 못함, 소극적임, 불성실함을 쓰지 않는다. 각 문장은 공백과 마침표를 포함해 반드시 50~60자로 작성하고 정확히 ‘함.’으로 끝낸다. 문장마다 글자 수를 직접 세어 49자 이하 또는 61자 이상이면 출력 전에 고친다. 문장 시작과 문형을 반복하지 않고, variation의 구조·시작 방식·근거 순서를 활용하며 같은 묶음 학생 및 avoidComments와 표현을 겹치지 않게 한다. 제목·번호·설명·따옴표·상중하 표시는 쓰지 않는다. 반드시 JSON 배열만 출력한다. 각 원소는 studentId, subject, sentences 필드를 가지며 sentences는 입력 itemIds와 같은 순서의 {itemId, text} 배열이다. 각 text는 해당 itemId 하나만 반영한 50~60자의 ‘함.’ 문장이다." }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: `${repair ? "이전 응답이 문장 수·글자 수·함 종결 검사를 통과하지 못했다. 각 문장을 출력하기 전에 글자 수를 다시 세어 엄격히 수정해 줘.\n" : ""}근거 사전과 학생별 근거 ID를 연결하여 각각 교과 평어를 작성해 줘.\n근거 사전: ${JSON.stringify(evidenceDictionary)}\n학생 입력: ${JSON.stringify(requestEvidence)}\n피해야 할 기존 시작 표현: ${JSON.stringify(avoidanceHints)}` }],
        },
      ],
      text: { verbosity: "low" },
    }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error("AI 생성 요청을 처리하지 못했습니다.");
  const raw = extractOutputText(payload).replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(raw) as Array<{ studentId?: unknown; subject?: unknown; sentences?: unknown }>;
  const allowed = new Set(evidence.map((item) => `${item.studentId}|${item.subject}`));
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
          const value = row as { itemId?: unknown; text?: unknown };
          return typeof value.itemId === "string" && typeof value.text === "string"
            ? [{ itemId: value.itemId, text: value.text.trim() }]
            : [];
        })
      : [];
    const complete = hasCompleteEvidenceCoverage(expectedIds, sentenceRows.map((row) => row.itemId));
    const ordered = expectedIds.map((id) => sentenceRows.find((row) => row.itemId === id)?.text ?? "");
    const sentenceFormatsOk = ordered.length > 0
      && ordered.every((sentence) => validateGeneratedComment(sentence, 1).valid);
    const candidates = sentenceFormatsOk ? [ordered.join(" ")] : [];
    const format = candidates.length ? validateGeneratedComment(candidates[0], expectedIds.length) : null;
    return allowed.has(`${studentId}|${subject}`) && candidates.length && complete && format?.valid
      ? [{ studentId, subject, comment: candidates[0], candidates }]
      : [];
  }) : [];
  if (!comments.length) throw new Error("AI 결과가 영역별 1문장·50~60자·함 종결 검수를 통과하지 못했습니다.");
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
