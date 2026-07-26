import postgres from "postgres";
import { readFile } from "node:fs/promises";

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) throw new Error("SUPABASE_DATABASE_URL is required");
const sql = postgres(connectionString, { ssl: "require", max: 1 });
try {
  const migration = await readFile(new URL("../supabase/0015_school_organizations.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const result = await sql`
    select count(*)::int as count from information_schema.tables
    where table_schema = 'public' and table_name in ('school_organizations', 'school_members')
  `;
  if (result[0]?.count !== 2) throw new Error("School organization migration verification failed");
  process.stdout.write("Supabase school organization migration ready\n");
} finally {
  await sql.end();
}
