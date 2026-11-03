import { waitUntil } from "@vercel/functions";
import { eq, selectRows, updateRows } from "../../../../db/supabase";
import { getDataScope, dataError } from "../../../data-scope";
import { signCommentJob } from "../../../comment-generation";
import { canResumeJob } from "../../../job-resume-policy";

export const maxDuration = 300;

const runners = { comments: "/api/comment-jobs/run", behaviors: "/api/behavior-jobs/run", "comment-pools": "/api/comment-pools/run" } as const;
type Job = { id: string; job_type: keyof typeof runners; status: string; updated_at: string };

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const jobId = typeof body?.jobId === "string" ? body.jobId : "";
    if (!jobId || jobId.length > 100) return Response.json({ error: "재개할 작업을 확인해 주세요." }, { status: 400 });
    const { user, classId } = await getDataScope();
    const scope = { id: eq(jobId), owner_id: eq(user.id), class_id: eq(classId) };
    const job = (await selectRows<Job>("generation_jobs", { ...scope, limit: 1 }))[0];
    if (!job || !Object.hasOwn(runners, job.job_type)) return Response.json({ error: "재개할 작업을 찾을 수 없습니다." }, { status: 404 });
    if (!canResumeJob(job)) return Response.json({ error: "작업이 진행 중이거나 종료됐습니다. 잠시 후 상태를 확인해 주세요." }, { status: 409 });
    // Reserve only this existing job; never change batches, progress or saved results.
    const timestamp = new Date().toISOString();
    const claimed = await updateRows<Job>("generation_jobs", {
      ...scope, job_type: eq(job.job_type), status: eq(job.status), updated_at: eq(job.updated_at),
    }, { status: "queued", updated_at: timestamp });
    if (!claimed.length) return Response.json({ error: "다른 요청이 작업 상태를 변경했습니다. 최신 상태를 확인해 주세요." }, { status: 409 });
    waitUntil((async () => {
      try {
        const response = await fetch(new URL(runners[job.job_type], request.url), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id, signature: signCommentJob(job.id) }),
        });
        if (!response.ok) throw new Error("dispatch failed");
      } catch {
        // Do not overwrite a runner that already claimed/progressed this job.
        await updateRows("generation_jobs", { ...scope, status: eq("queued"), updated_at: eq(timestamp) }, {
          error_message: "재개 요청 전달에 실패했습니다. 잠시 후 기존 작업을 다시 재개해 주세요.",
        }).catch(() => undefined);
      }
    })());
    return Response.json({ jobId: job.id, accepted: true }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return dataError(error, "작업을 재개하지 못했습니다.");
  }
}
