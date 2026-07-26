import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const labEmail = process.env.LAB_ACCOUNT_EMAIL;
if (!url || !serviceKey || !labEmail) throw new Error("Supabase admin configuration or LAB_ACCOUNT_EMAIL is missing");
if (process.env.RESET_LAB_AI_USAGE !== "YES") throw new Error("RESET_LAB_AI_USAGE=YES confirmation is required");

const client = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let page = 1;
let labUser;
while (!labUser) {
  const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw error;
  labUser = data.users.find((user) => user.email === labEmail);
  if (data.users.length < 100) break;
  page += 1;
}
if (!labUser) throw new Error("Lab account was not found");

const monthStart = new Date();
monthStart.setUTCDate(1);
monthStart.setUTCHours(0, 0, 0, 0);

const countUsage = async () => {
  const { count, error } = await client
    .from("ai_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", labUser.id)
    .gte("created_at", monthStart.toISOString());
  if (error) throw error;
  return count ?? 0;
};

const before = await countUsage();
const { error: deleteError } = await client
  .from("ai_usage_events")
  .delete()
  .eq("owner_id", labUser.id)
  .gte("created_at", monthStart.toISOString());
if (deleteError) throw deleteError;
const after = await countUsage();

process.stdout.write(`${JSON.stringify({
  account: labEmail,
  periodStart: monthStart.toISOString(),
  deleted: before - after,
  remaining: after,
})}\n`);
