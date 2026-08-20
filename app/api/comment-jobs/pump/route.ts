import { timingSafeEqual } from "node:crypto";
import { selectRows } from "../../../../db/supabase";
import { commentJobCronSecret, signCommentJob } from "../../../comment-generation";

export const maxDuration = 60;

type ActiveJob = { id: string; job_type: "comments" | "behaviors" | "comment-pools" };

function validSecret(request: Request) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = commentJobCronSecret();
  return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(request: Request) {
  if (!validSecret(request)) return Response.json({ error: "허용되지 않은 작업 실행 요청입니다." }, { status: 403 });
  const jobs = await selectRows<ActiveJob>("generation_jobs", {
    status: "in.(queued,running)",
    order: "created_at.asc",
    limit: 1,
  });
  if (!jobs[0]) return Response.json({ ok: true, processed: 0 });

  const runPath = jobs[0].job_type === "behaviors"
    ? "/api/behavior-jobs/run"
    : jobs[0].job_type === "comment-pools" ? "/api/comment-pools/run" : "/api/comment-jobs/run";
  const response = await fetch(new URL(runPath, request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: jobs[0].id, signature: signCommentJob(jobs[0].id) }),
  });
  if (!response.ok) return Response.json({ error: "작업 배치를 실행하지 못했습니다." }, { status: 502 });
  return Response.json({ ok: true, processed: 1 });
}
