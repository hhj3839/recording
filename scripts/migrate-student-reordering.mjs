import postgres from "postgres";
import { readFile } from "node:fs/promises";

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) throw new Error("SUPABASE_DATABASE_URL is missing");
const sql = postgres(connectionString, { ssl: "require", max: 1 });
try {
  const migration = await readFile(new URL("../supabase/0008_student_reordering.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const [row] = await sql`select to_regprocedure('public.reorder_students(uuid,bigint,bigint[])') as function_name`;
  if (!row?.function_name) throw new Error("student reordering migration verification failed");
  console.log("Supabase student reordering migration ready");
} finally {
  await sql.end();
}
