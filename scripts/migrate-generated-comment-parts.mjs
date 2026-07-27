import { readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) throw new Error("SUPABASE_DATABASE_URL is missing");

const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
try {
  const migration = await readFile(new URL("../supabase/0020_generated_comment_parts.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const result = await sql`
    select count(*)::int as count
    from information_schema.tables
    where table_schema = 'public' and table_name = 'generated_comment_parts'
  `;
  if (result[0]?.count !== 1) throw new Error("Generated comment parts migration verification failed");
  process.stdout.write("Supabase generated comment parts migration ready\n");
} finally {
  await sql.end();
}
