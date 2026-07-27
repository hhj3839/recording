import { readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) throw new Error("SUPABASE_DATABASE_URL is missing");

const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
try {
  const migration = await readFile(new URL("../supabase/0019_ai_token_usage.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const result = await sql`
    select count(*)::int as count
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_usage_events'
      and column_name in (
        'model', 'input_tokens', 'cached_input_tokens',
        'output_tokens', 'total_tokens', 'estimated_cost_usd'
      )
  `;
  if (result[0]?.count !== 6) throw new Error("AI token usage migration verification failed");
  process.stdout.write("Supabase AI token usage migration ready\n");
} finally {
  await sql.end();
}
