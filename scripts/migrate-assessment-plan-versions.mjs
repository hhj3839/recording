import postgres from "postgres";
import { readFile } from "node:fs/promises";

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) throw new Error("SUPABASE_DATABASE_URL is missing");
const sql = postgres(connectionString, { ssl: "require", max: 1 });
try {
  const migration = await readFile(new URL("../supabase/0009_assessment_plan_versions.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const [row] = await sql`select to_regclass('public.assessment_plan_versions') as table_name`;
  if (!row?.table_name) throw new Error("assessment plan version migration verification failed");
  console.log("Supabase assessment plan version migration ready");
} finally {
  await sql.end();
}
