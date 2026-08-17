import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.SUPABASE_DATABASE_URL;
if (!url || !serviceKey || !databaseUrl) {
  throw new Error("Supabase platform audit configuration is missing");
}

const client = createClient(url, serviceKey, { auth: { persistSession: false } });
let authUsers = 0;
for (let page = 1; ; page += 1) {
  const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  authUsers += data.users.length;
  if (data.users.length < 1000) break;
}

const sql = postgres(databaseUrl, { max: 1, ssl: "require" });
const [schemas, policies, buckets, objects, extensions, publicTables] = await Promise.all([
  sql`select schemaname, count(*)::int as tables,
      count(*) filter (where rowsecurity)::int as rls_tables
    from pg_tables
    where schemaname in ('public', 'auth', 'storage')
    group by schemaname order by schemaname`,
  sql`select schemaname, count(*)::int as policies
    from pg_policies
    where schemaname in ('public', 'auth', 'storage')
    group by schemaname order by schemaname`,
  sql`select count(*)::int as count,
      count(*) filter (where public)::int as public_count
    from storage.buckets`,
  sql`select count(*)::int as count,
      coalesce(sum((metadata->>'size')::bigint), 0)::bigint as bytes
    from storage.objects`,
  sql`select extname from pg_extension order by extname`,
  sql`select tablename, rowsecurity
    from pg_tables where schemaname = 'public' order by tablename`,
]);
await sql.end();

process.stdout.write(`${JSON.stringify({
  mode: "supabase-platform-audit",
  readOnly: true,
  auth: { users: authUsers },
  database: {
    schemas,
    policies,
    publicTables,
    extensions: extensions.map((row) => row.extname),
  },
  storage: {
    buckets: Number(buckets[0]?.count ?? 0),
    publicBuckets: Number(buckets[0]?.public_count ?? 0),
    objects: Number(objects[0]?.count ?? 0),
    bytes: String(objects[0]?.bytes ?? 0),
  },
}, null, 2)}\n`);
