import { eq, gte, insertRows, selectRows } from "../db/supabase";

export const MONTHLY_AI_LIMIT = 300;
export const MINUTE_AI_LIMIT = 10;

type UsageRow = { created_at: string };

const monthStart = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
};

export async function getAiUsage(ownerId: string) {
  const rows = await selectRows<UsageRow>("ai_usage_events", {
    owner_id: eq(ownerId),
    created_at: gte(monthStart()),
    order: "created_at.desc",
    limit: MONTHLY_AI_LIMIT + 1,
  });
  const minuteAgo = Date.now() - 60_000;
  return {
    monthly: rows.length,
    recent: rows.filter((row) => new Date(row.created_at).getTime() >= minuteAgo).length,
    limit: MONTHLY_AI_LIMIT,
  };
}

export async function checkAiUsage(ownerId: string) {
  const usage = await getAiUsage(ownerId);
  if (usage.monthly >= MONTHLY_AI_LIMIT) return { ...usage, allowed: false, reason: "monthly" as const };
  if (usage.recent >= MINUTE_AI_LIMIT) return { ...usage, allowed: false, reason: "minute" as const };
  return { ...usage, allowed: true, reason: null };
}

export async function recordAiUsage(input: { ownerId: string; ownerEmail: string; classId: number; feature: string }) {
  await insertRows("ai_usage_events", [{
    owner_id: input.ownerId,
    owner_email: input.ownerEmail,
    class_id: input.classId,
    feature: input.feature,
    created_at: new Date().toISOString(),
  }]);
}
