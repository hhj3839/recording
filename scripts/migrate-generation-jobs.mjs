import postgres from "postgres";
import { readFile } from "node:fs/promises";

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) throw new Error("SUPABASE_DATABASE_URL is missing");
const sql = postgres(connectionString, { ssl: "require", max: 1 });
try {
  const migration = await readFile(new URL("../supabase/0006_generation_jobs.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const [row] = await sql`select to_regclass('public.generation_jobs') as table_name`;
  if (!row?.table_name) throw new Error("generation_jobs verification failed");
  console.log("Supabase generation job migration ready");
} finally {
  await sql.end();
}
