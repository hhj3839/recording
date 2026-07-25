import { createHmac, timingSafeEqual } from "node:crypto";
import { upsertRows } from "../db/supabase";
import { recordAiUsage } from "./ai-usage";
import { archiveComment } from "./record-revisions";

export type CommentEvidence = { studentId: number; subject: string; items: string[] };
export type GeneratedComment = { studentId: number; subject: string; comment: string };

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("").trim();
}

export async function generateCommentBatch(evidence: CommentEvidence[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI 생성 설정이 아직 완료되지 않았습니다.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
      reasoning: { effort: "low" },
      store: false,
      max_output_tokens: Math.min(5000, Math.max(1200, evidence.length * 260)),
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "대한민국 초등학교 교과학습발달상황 작성 전문가이다. 제공된 평가계획과 수준만 활용한다. 학생 이름·성별·추측·학생 간 비교를 쓰지 않는다. 하 수준도 성장 중심으로 표현한다. 각 결과는 2~3문장으로 자연스럽게 연결하고 모든 문장을 함·됨·보임·돋보임 등의 명사형으로 끝낸다. 반드시 JSON 배열만 출력하며 각 원소는 studentId, subject, comment 필드를 가진다." }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: `다음 학생 식별번호별·과목별 근거로 각각 교과 평어를 작성해 줘.\n${JSON.stringify(evidence)}` }],
        },
      ],
      text: { verbosity: "low" },
    }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error("AI 생성 요청을 처리하지 못했습니다.");
  const raw = extractOutputText(payload).replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(raw) as Array<{ studentId?: unknown; subject?: unknown; comment?: unknown }>;
  const allowed = new Set(evidence.map((item) => `${item.studentId}|${item.subject}`));
  const comments = Array.isArray(parsed) ? parsed.flatMap((item) => {
    const studentId = Number(item.studentId);
    const subject = typeof item.subject === "string" ? item.subject : "";
    const comment = typeof item.comment === "string" ? item.comment.trim() : "";
    return allowed.has(`${studentId}|${subject}`) && comment ? [{ studentId, subject, comment }] : [];
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
