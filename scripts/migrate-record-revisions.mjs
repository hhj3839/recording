import { readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) throw new Error("SUPABASE_DATABASE_URL is missing");

const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
try {
  const migration = await readFile(new URL("../supabase/0005_record_revisions.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const result = await sql`
    select count(*)::int as count
    from information_schema.tables
    where table_schema = 'public' and table_name = 'record_revisions'
  `;
  if (result[0]?.count !== 1) throw new Error("Record revision migration verification failed");
  process.stdout.write("Supabase record revision migration ready\n");
} finally {
  await sql.end();
}
