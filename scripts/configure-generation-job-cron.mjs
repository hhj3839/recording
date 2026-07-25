import { createHmac } from "node:crypto";
import postgres from "postgres";

const connectionString = process.env.SUPABASE_DATABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = (process.env.GIROKSAM_APP_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
if (!connectionString || !serviceKey) throw new Error("Supabase job cron configuration is missing");

const secret = createHmac("sha256", serviceKey).update("comment-job-cron:v1").digest("hex");
const sql = postgres(connectionString, { ssl: "require", max: 1 });
try {
  await sql.unsafe("create extension if not exists pg_net with schema extensions");
  await sql.unsafe("create extension if not exists pg_cron with schema pg_catalog");
  await sql`
    delete from vault.secrets
    where name = 'comment_job_runner_secret'
  `;
  await sql`
    select vault.create_secret(
      ${secret},
      'comment_job_runner_secret',
      '기록샘 교과 평어 백그라운드 작업 호출 전용'
    )
  `;
  await sql`
    select cron.unschedule(jobid)
    from cron.job
    where jobname = 'giroksam-comment-jobs'
  `;
  const command = `
    select net.http_post(
      url := '${appUrl}/api/comment-jobs/pump',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'comment_job_runner_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb
    )
  `;
  await sql`select cron.schedule('giroksam-comment-jobs', '* * * * *', ${command})`;
  const [job] = await sql`
    select jobid, schedule, active
    from cron.job
    where jobname = 'giroksam-comment-jobs'
  `;
  if (!job?.active) throw new Error("Background generation cron verification failed");
  console.log(`Supabase generation job cron ready: job ${job.jobid}, ${job.schedule}`);
} finally {
  await sql.end();
}
