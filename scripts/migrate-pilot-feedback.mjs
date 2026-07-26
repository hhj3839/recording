import postgres from "postgres";
import { readFile } from "node:fs/promises";

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) throw new Error("SUPABASE_DATABASE_URL is required");
const sql = postgres(connectionString, { ssl: "require", max: 1 });
try {
  const migration = await readFile(new URL("../supabase/0012_pilot_feedback.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const result = await sql`select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_name = 'pilot_feedback'`;
  if (result[0]?.count !== 1) throw new Error("Pilot feedback migration verification failed");
  process.stdout.write("Supabase pilot feedback migration ready\n");
} finally {
  await sql.end();
}
