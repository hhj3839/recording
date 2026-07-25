import { readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) throw new Error("SUPABASE_DATABASE_URL is missing");

const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
try {
  const migration = await readFile(new URL("../supabase/0003_confirmation_status.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const result = await sql`
    select count(*)::int as count
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('generated_comments', 'student_behaviors')
      and column_name in ('confirmed', 'confirmed_at')
  `;
  if (result[0]?.count !== 4) throw new Error("Confirmation migration verification failed");
  process.stdout.write("Supabase confirmation migration ready\n");
} finally {
  await sql.end();
}
