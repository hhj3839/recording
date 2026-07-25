import postgres from "postgres";
import { readFile } from "node:fs/promises";

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) throw new Error("SUPABASE_DATABASE_URL is missing");
const sql = postgres(connectionString, { ssl: "require", max: 1 });
try {
  const migration = await readFile(new URL("../supabase/0007_behavior_generation_jobs.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const [row] = await sql`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conname = 'generation_jobs_job_type_check'
  `;
  if (!row?.definition?.includes("behaviors")) throw new Error("behavior generation job migration verification failed");
  console.log("Supabase behavior generation job migration ready");
} finally {
  await sql.end();
}
