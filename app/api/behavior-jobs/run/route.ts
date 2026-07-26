import { waitUntil } from "@vercel/functions";
import { eq, selectRows, updateRows } from "../../../../db/supabase";
import { getAiUsage, MONTHLY_AI_LIMIT, recordAiUsage } from "../../../ai-usage";
import { BehaviorInput, GeneratedBehavior, generateBehaviorBatch, saveGeneratedBehaviors } from "../../../behavior-generation";
import { signCommentJob, verifyCommentJob } from "../../../comment-generation";

export const maxDuration = 300;
const MAX_GENERATION_ATTEMPTS = 3;
type JobRow = {
  id: string; owner_id: string; owner_email: string; class_id: number; status: string; batches: BehaviorInput[][];
  current_batch: number; total_batches: number; completed_items: number; failed_items: number; error_message: string; started_at: string | null;
};
function queueNext(request: Request, jobId: string) {
  waitUntil(fetch(new URL("/api/behavior-jobs/run", request.url), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, signature: signCommentJob(jobId) }),
  }).catch(() => undefined));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { jobId?: unknown; signature?: unknown };
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!jobId || !verifyCommentJob(jobId, signature)) return Response.json({ error: "허용되지 않은 작업 요청입니다." }, { status: 403 });
  const job = (await selectRows<JobRow>("generation_jobs", { id: eq(jobId), job_type: eq("behaviors"), limit: 1 }))[0];
  if (!job || !["queued", "running"].includes(job.status)) return Response.json({ ok: true, terminal: true });
  const batchIndex = Number(job.current_batch);
  const batch = job.batches[batchIndex];
  if (!batch?.length) {
    await updateRows("generation_jobs", { id: eq(jobId) }, {
      status: job.failed_items ? "completed_with_errors" : "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    return Response.json({ ok: true, terminal: true });
  }
  await updateRows("generation_jobs", { id: eq(jobId) }, {
    status: "running", started_at: job.started_at ?? new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  let behaviors: GeneratedBehavior[] = [];
  let errorMessage = "";
  let pending = batch;
  const batchStudentIds = new Set(batch.map((item) => item.studentId));
  const existingBehaviors = await selectRows<{ student_id: number; behavior: string }>("student_behaviors", {
    owner_id: eq(job.owner_id), class_id: eq(job.class_id),
  });
  const avoidBehaviors = existingBehaviors
    .filter((item) => !batchStudentIds.has(Number(item.student_id)))
    .map((item) => item.behavior)
    .filter(Boolean);
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS && pending.length; attempt += 1) {
    const usage = await getAiUsage(job.owner_id);
    if (usage.monthly >= MONTHLY_AI_LIMIT) {
      errorMessage = `월 AI 요청 한도 ${MONTHLY_AI_LIMIT}회를 사용하여 남은 학생의 자동 재시도를 중단했습니다.`;
      break;
    }
    try {
      const generated = await generateBehaviorBatch(pending, avoidBehaviors);
      behaviors = [...behaviors, ...generated];
      const generatedIds = new Set(generated.map((item) => item.studentId));
      pending = pending.filter((item) => !generatedIds.has(item.studentId));
    }
    catch (error) { errorMessage = error instanceof Error ? error.message : "AI 생성 오류"; }
    finally {
      await recordAiUsage({
        ownerId: job.owner_id, ownerEmail: job.owner_email, classId: Number(job.class_id),
        feature: `all-behaviors-attempt-${attempt + 1}`,
      });
    }
  }
  if (behaviors.length) {
    await saveGeneratedBehaviors({ ownerId: job.owner_id, ownerEmail: job.owner_email, classId: Number(job.class_id), behaviors });
  }
  const returned = new Set(behaviors.map((item) => item.studentId));
  const failedInBatch = batch.filter((item) => !returned.has(item.studentId)).length;
  if (failedInBatch) {
    const detail = `행동특성 배치 ${batchIndex + 1}: ${failedInBatch}명이 ${MAX_GENERATION_ATTEMPTS}회 생성 후에도 500~550바이트·음/임 종결 검수를 통과하지 못했습니다.`;
    errorMessage = [job.error_message, errorMessage, detail].filter(Boolean).join(" ").slice(-1800);
  }
  const nextBatch = batchIndex + 1;
  const failedItems = Number(job.failed_items) + failedInBatch;
  const completedItems = Number(job.completed_items) + behaviors.length;
  const terminal = nextBatch >= Number(job.total_batches);
  await updateRows("generation_jobs", { id: eq(jobId) }, {
    status: terminal ? (failedItems ? "completed_with_errors" : "completed") : "running",
    current_batch: nextBatch, completed_items: completedItems, failed_items: failedItems,
    error_message: errorMessage || job.error_message, completed_at: terminal ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  });
  if (!terminal) queueNext(request, jobId);
  return Response.json({ ok: true, terminal, completedItems, failedItems });
}
