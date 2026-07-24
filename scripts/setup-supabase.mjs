import { readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) throw new Error("SUPABASE_DATABASE_URL is missing");

const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
try {
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  await sql.unsafe(schema);
  const tables = await sql`
    select count(*)::int as count
    from information_schema.tables
    where table_schema = 'public'
      and table_name in ('teachers','classrooms','assessment_plans','students','assessment_levels','generated_comments','student_behaviors')
  `;
  if (tables[0]?.count !== 7) throw new Error("Supabase schema verification failed");
  process.stdout.write("Supabase schema ready: 7 tables\n");
} finally {
  await sql.end();
}
