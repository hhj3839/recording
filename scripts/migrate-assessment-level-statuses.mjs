import postgres from "postgres";
import { readFile } from "node:fs/promises";

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) throw new Error("SUPABASE_DATABASE_URL is required");

const sql = postgres(connectionString, { ssl: "require", max: 1 });
try {
  const migration = await readFile(new URL("../supabase/0010_assessment_level_statuses.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const result = await sql`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conname = 'assessment_levels_level_check'
  `;
  const definition = String(result[0]?.definition ?? "");
  if (!definition.includes("미응시") || !definition.includes("평가 예정")) {
    throw new Error("Assessment level status migration verification failed");
  }
  process.stdout.write("Supabase assessment level statuses migration ready\n");
} finally {
  await sql.end();
}
