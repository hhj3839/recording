import postgres from "postgres";
import { readFile } from "node:fs/promises";

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) throw new Error("SUPABASE_DATABASE_URL is required");
const sql = postgres(connectionString, { ssl: "require", max: 1 });
try {
  const migration = await readFile(new URL("../supabase/0013_behavior_evidence_validation.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const result = await sql`
    select count(*)::int as count from information_schema.columns
    where table_schema = 'public' and table_name = 'student_behaviors'
      and column_name in ('evidence_status', 'evidence_issues', 'evidence_hash', 'evidence_validated_at')
  `;
  if (result[0]?.count !== 4) throw new Error("Behavior evidence validation migration verification failed");
  process.stdout.write("Supabase behavior evidence validation migration ready\n");
} finally {
  await sql.end();
}
