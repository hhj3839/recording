import { waitUntil } from "@vercel/functions";
import { eq, selectRows, updateRows } from "../../../../db/supabase";
import { selectMostDiverseComments } from "../../../comment-diversity";
import { CommentEvidence, GeneratedComment, generateCommentBatch, saveGeneratedComments, signCommentJob, verifyCommentJob } from "../../../comment-generation";

export const maxDuration = 60;

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
  if (!job || !["queued", "running"].includes(job.status)) return Response.json({ ok: true, terminal: true });
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

  await updateRows("generation_jobs", { id: eq(jobId) }, {
    status: "running",
    started_at: job.started_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  let comments: GeneratedComment[] = [];
  let errorMessage = "";
  const subject = batch[0]?.subject ?? "";
  const batchStudentIds = new Set(batch.map((item) => item.studentId));
  const existingComments = subject ? await selectRows<{ student_id: number; comment: string }>("generated_comments", {
    owner_id: eq(job.owner_id), class_id: eq(job.class_id), subject: eq(subject),
  }) : [];
  const avoidComments = existingComments
    .filter((item) => !batchStudentIds.has(Number(item.student_id)))
    .map((item) => item.comment)
    .filter(Boolean);
  for (let attempt = 0; attempt < 2 && !comments.length; attempt += 1) {
    try {
      comments = await generateCommentBatch(batch, avoidComments);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "AI 생성 오류";
    }
  }
  comments = selectMostDiverseComments(comments, avoidComments).map((item) => {
    const source = batch.find((entry) => entry.studentId === item.studentId && entry.subject === item.subject);
    const visibleCandidateCount = source?.options?.candidateCount ?? 1;
    return { ...item, candidates: item.candidates.slice(0, visibleCandidateCount) };
  });
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
  const nextBatch = batchIndex + 1;
  const failedItems = Number(job.failed_items) + failedInBatch;
  const completedItems = Number(job.completed_items) + comments.length;
  const terminal = nextBatch >= Number(job.total_batches);
  await updateRows("generation_jobs", { id: eq(jobId) }, {
    status: terminal ? (failedItems ? "completed_with_errors" : "completed") : "running",
    current_batch: nextBatch,
    completed_items: completedItems,
    failed_items: failedItems,
    error_message: errorMessage || job.error_message,
    completed_at: terminal ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  if (!terminal) queueNext(request, jobId);
  return Response.json({ ok: true, terminal, completedItems, failedItems });
}
