import { waitUntil } from "@vercel/functions";
import { eq, selectRows, updateRows } from "../../../../db/supabase";
import { getAiUsage, MONTHLY_AI_LIMIT, recordAiUsage } from "../../../ai-usage";
import { selectMostDiverseComments } from "../../../comment-diversity";
import { CommentEvidence, GeneratedComment, generateCommentBatch, saveGeneratedComments, signCommentJob, verifyCommentJob } from "../../../comment-generation";
import { generationModel } from "../../../ai-model-policy";

export const maxDuration = 300;
const MAX_GENERATION_ATTEMPTS = 3;

type JobRow = {
  id: string;
  owner_id: string;
  owner_email: string;
  class_id: number;
  status: string;
  batches: CommentEvidence[][];
  current_batch: number;
  total_batches: number;
  total_items: number;
  completed_items: number;
  failed_items: number;
  error_message: string;
  started_at: string | null;
  updated_at: string;
};

function queueNext(request: Request, jobId: string) {
  const url = new URL("/api/comment-jobs/run", request.url);
  const signature = signCommentJob(jobId);
  waitUntil(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, signature }),
    }).catch(() => undefined),
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { jobId?: unknown; signature?: unknown };
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!jobId || !verifyCommentJob(jobId, signature)) {
    return Response.json({ error: "허용되지 않은 작업 요청입니다." }, { status: 403 });
  }

  const job = (await selectRows<JobRow>("generation_jobs", { id: eq(jobId), limit: 1 }))[0];
  if (!job) return Response.json({ ok: true, terminal: true });
  const lockAge = Date.now() - Date.parse(job.updated_at);
  if (job.status === "running" && lockAge < 360_000) {
    return Response.json({ ok: true, terminal: false, busy: true });
  }
  if (!["queued", "running"].includes(job.status)) return Response.json({ ok: true, terminal: true });
  const batchIndex = Number(job.current_batch);
  const batch = job.batches[batchIndex];
  if (!batch?.length) {
    await updateRows("generation_jobs", { id: eq(jobId) }, {
      status: job.failed_items ? "completed_with_errors" : "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return Response.json({ ok: true, terminal: true });
  }

  const claimed = await updateRows<JobRow>("generation_jobs", {
    id: eq(jobId), status: eq(job.status), updated_at: eq(job.updated_at),
  }, {
    status: "running",
    started_at: job.started_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (!claimed[0]) return Response.json({ ok: true, terminal: false, busy: true });

  let comments: GeneratedComment[] = [];
  let errorMessage = "";
  let pending = batch;
  const subject = batch[0]?.subject ?? "";
  const batchStudentIds = new Set(batch.map((item) => item.studentId));
  const existingComments = subject ? await selectRows<{ student_id: number; comment: string }>("generated_comments", {
    owner_id: eq(job.owner_id), class_id: eq(job.class_id), subject: eq(subject),
  }) : [];
  const avoidComments = existingComments
    .filter((item) => !batchStudentIds.has(Number(item.student_id)))
    .map((item) => item.comment)
    .filter(Boolean);
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS && pending.length; attempt += 1) {
    const usage = await getAiUsage(job.owner_id);
    if (usage.monthly >= MONTHLY_AI_LIMIT) {
      errorMessage = `월 AI 요청 한도 ${MONTHLY_AI_LIMIT}회를 사용하여 남은 항목의 자동 재시도를 중단했습니다.`;
      break;
    }
    const groups = attempt === 0 ? [pending] : pending.map((item) => [item]);
    const generatedThisAttempt: GeneratedComment[] = [];
    for (const group of groups) {
      const groupUsage = await getAiUsage(job.owner_id);
      if (groupUsage.monthly >= MONTHLY_AI_LIMIT) {
        errorMessage = `월 AI 요청 한도 ${MONTHLY_AI_LIMIT}회를 사용하여 남은 항목의 자동 재시도를 중단했습니다.`;
        break;
      }
      try {
        const generated = await generateCommentBatch(
          group,
          [...avoidComments, ...comments.map((item) => item.comment)],
          attempt > 0,
          generationModel(attempt, MAX_GENERATION_ATTEMPTS),
        );
        generatedThisAttempt.push(...generated);
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "AI 생성 오류";
      } finally {
        await recordAiUsage({
          ownerId: job.owner_id, ownerEmail: job.owner_email, classId: Number(job.class_id),
          feature: `all-comments-attempt-${attempt + 1}`,
        });
      }
    }
    comments = [...comments, ...generatedThisAttempt];
    const generatedKeys = new Set(generatedThisAttempt.map((item) => `${item.studentId}|${item.subject}`));
    pending = pending.filter((item) => !generatedKeys.has(`${item.studentId}|${item.subject}`));
  }
  comments = selectMostDiverseComments(comments, avoidComments)
    .map((item) => ({ ...item, candidates: item.candidates.slice(0, 1) }));
  const cancelledBeforeSave = (await selectRows<{ status: string }>("generation_jobs", { id: eq(jobId), limit: 1 }))[0]?.status === "cancelled";
  if (cancelledBeforeSave) {
    return Response.json({ ok: true, terminal: true, cancelled: true });
  }
  if (comments.length) {
    await saveGeneratedComments({
      ownerId: job.owner_id,
      ownerEmail: job.owner_email,
      classId: Number(job.class_id),
      comments,
    });
  }

  const returned = new Set(comments.map((item) => `${item.studentId}|${item.subject}`));
  const failedInBatch = batch.filter((item) => !returned.has(`${item.studentId}|${item.subject}`)).length;
  if (failedInBatch) {
    const detail = `${subject} 배치 ${batchIndex + 1}: ${failedInBatch}건이 ${MAX_GENERATION_ATTEMPTS}회 생성 후에도 영역별 1문장·50~60자·함 종결 검수를 통과하지 못했습니다.`;
    errorMessage = [job.error_message, errorMessage, detail].filter(Boolean).join(" ").slice(-1800);
  }
  const nextBatch = batchIndex + 1;
  const failedItems = Number(job.failed_items) + failedInBatch;
  const completedItems = Number(job.completed_items) + comments.length;
  const terminal = nextBatch >= Number(job.total_batches);
  const latestStatus = (await selectRows<{ status: string }>("generation_jobs", { id: eq(jobId), limit: 1 }))[0]?.status;
  if (latestStatus === "cancelled") {
    return Response.json({ ok: true, terminal: true, cancelled: true, completedItems, failedItems });
  }
  await updateRows("generation_jobs", { id: eq(jobId) }, {
    status: terminal ? (failedItems ? "completed_with_errors" : "completed") : "queued",
    current_batch: nextBatch,
    completed_items: completedItems,
    failed_items: failedItems,
    error_message: failedItems ? (errorMessage || job.error_message) : "",
    completed_at: terminal ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  if (!terminal) queueNext(request, jobId);
  return Response.json({ ok: true, terminal, completedItems, failedItems });
}
