import { createHmac, timingSafeEqual } from "node:crypto";
import { upsertRows } from "../db/supabase";
import { recordAiUsage } from "./ai-usage";
import { hasCompleteEvidenceCoverage } from "./comment-generation-policy";
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

export async function generateCommentBatch(evidence: CommentEvidence[], avoidComments: string[] = []) {
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
      reasoning: { effort: "low" },
      store: false,
      max_output_tokens: Math.min(10000, Math.max(1600, requestEvidence.reduce((sum, item) => sum + 220 + item.itemIds.length * 110, 0))),
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "대한민국 초등학교 교과학습발달상황 작성 전문가이다. 제공된 평가계획과 수준만 활용한다. 학생 이름·성별·추측·학생 간 비교를 쓰지 않는다. 하 수준도 성장 중심으로 표현한다. 각 입력의 variation에 지정된 문장 구조·시작 방식·근거 순서를 따르되 근거에 없는 사실을 만들지 않는다. 같은 묶음의 학생끼리 첫 구절, 핵심 동사, 문장 구조, 종결 표현이 겹치지 않게 적극적으로 분산한다. avoidComments의 문장을 복사하거나 비슷하게 바꾸어 쓰지 않는다. 학생 입력의 itemIds에 연결된 모든 평가 항목을 반드시 빠짐없이 반영한다. 각 항목의 평가 영역과 입력 수준(상·중·하)에 해당하는 기준이 결과에서 구체적으로 드러나야 하며, 강점 위주로 일부 항목을 생략하거나 여러 항목을 근거 없이 하나로 뭉뚱그리지 않는다. 문장 수와 분량은 항목 수에 맞게 스스로 정하되 자연스러운 하나의 평어로 작성한다. 후보는 정확히 1개만 만든다. 모든 문장을 함·됨·보임·돋보임 등의 명사형으로 끝낸다. 반드시 JSON 배열만 출력하며 각 원소는 studentId, subject, candidates(문자열 1개 배열), coveredItemIds 필드를 가진다. coveredItemIds에는 실제 평어에 반영한 itemIds 전체를 입력과 동일하게 넣는다." }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: `근거 사전과 학생별 근거 ID를 연결하여 각각 교과 평어를 작성해 줘.\n근거 사전: ${JSON.stringify(evidenceDictionary)}\n학생 입력: ${JSON.stringify(requestEvidence)}\n피해야 할 기존 시작 표현: ${JSON.stringify(avoidanceHints)}` }],
        },
      ],
      text: { verbosity: "low" },
    }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error("AI 생성 요청을 처리하지 못했습니다.");
  const raw = extractOutputText(payload).replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(raw) as Array<{ studentId?: unknown; subject?: unknown; comment?: unknown; candidates?: unknown; coveredItemIds?: unknown }>;
  const allowed = new Set(evidence.map((item) => `${item.studentId}|${item.subject}`));
  const comments = Array.isArray(parsed) ? parsed.flatMap((item) => {
    const studentId = Number(item.studentId);
    const subject = typeof item.subject === "string" ? item.subject : "";
    const source = evidence.find((entry) => entry.studentId === studentId && entry.subject === subject);
    const expectedIds = [...new Set(source?.items
      .map((evidenceItem) => evidenceIds.get(evidenceItem))
      .filter((id): id is string => Boolean(id)) ?? [])];
    const candidates = Array.isArray(item.candidates)
      ? item.candidates.filter((candidate): candidate is string => typeof candidate === "string").map((candidate) => candidate.trim()).filter(Boolean).slice(0, 1)
      : typeof item.comment === "string" ? [item.comment.trim()].filter(Boolean) : [];
    const complete = hasCompleteEvidenceCoverage(expectedIds, item.coveredItemIds);
    return allowed.has(`${studentId}|${subject}`) && candidates.length && complete ? [{ studentId, subject, comment: candidates[0], candidates }] : [];
  }) : [];
  if (!comments.length) throw new Error("AI가 평어를 반환하지 않았습니다.");
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
  await recordAiUsage({
    ownerId: input.ownerId,
    ownerEmail: input.ownerEmail,
    classId: input.classId,
    feature: "all-comments-background",
  });
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
