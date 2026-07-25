import { readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) throw new Error("SUPABASE_DATABASE_URL is missing");

const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
try {
  const migration = await readFile(new URL("../supabase/0002_auth_ownership.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const result = await sql`
    select count(*)::int as count
    from information_schema.columns
    where table_schema = 'public'
      and column_name in ('user_id', 'owner_id')
      and table_name in ('teachers','classrooms','assessment_plans','students','assessment_levels','generated_comments','student_behaviors')
  `;
  if (result[0]?.count !== 7) throw new Error("Ownership migration verification failed");
  process.stdout.write("Supabase ownership migration ready\n");
} finally {
  await sql.end();
}
