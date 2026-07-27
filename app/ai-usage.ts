import { eq, gte, insertRows, selectRows } from "../db/supabase";
import { AiTokenUsage, estimateAiCostUsd } from "./ai-pricing";
export type { AiTokenUsage } from "./ai-pricing";

export const MONTHLY_AI_LIMIT = 150;
export const MINUTE_AI_LIMIT = 10;

type UsageRow = {
  created_at: string;
  input_tokens?: number | string;
  cached_input_tokens?: number | string;
  output_tokens?: number | string;
  total_tokens?: number | string;
  estimated_cost_usd?: number | string | null;
};
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
    tokens: {
      input: rows.reduce((sum, row) => sum + (Number(row.input_tokens) || 0), 0),
      cachedInput: rows.reduce((sum, row) => sum + (Number(row.cached_input_tokens) || 0), 0),
      output: rows.reduce((sum, row) => sum + (Number(row.output_tokens) || 0), 0),
      total: rows.reduce((sum, row) => sum + (Number(row.total_tokens) || 0), 0),
    },
    estimatedCostUsd: Math.round(rows.reduce((sum, row) => sum + (Number(row.estimated_cost_usd) || 0), 0) * 1_000_000) / 1_000_000,
  };
}

export async function checkAiUsage(ownerId: string) {
  const usage = await getAiUsage(ownerId);
  if (usage.monthly >= MONTHLY_AI_LIMIT) return { ...usage, allowed: false, reason: "monthly" as const };
  if (usage.recent >= MINUTE_AI_LIMIT) return { ...usage, allowed: false, reason: "minute" as const };
  return { ...usage, allowed: true, reason: null };
}

export async function recordAiUsage(input: { ownerId: string; ownerEmail: string; classId: number; feature: string } & AiTokenUsage) {
  const inputTokens = Math.max(0, Number(input.inputTokens) || 0);
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Number(input.cachedInputTokens) || 0));
  const outputTokens = Math.max(0, Number(input.outputTokens) || 0);
  await insertRows("ai_usage_events", [{
    owner_id: input.ownerId,
    owner_email: input.ownerEmail,
    class_id: input.classId,
    feature: input.feature,
    model: input.model ?? null,
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    total_tokens: Math.max(inputTokens + outputTokens, Number(input.totalTokens) || 0),
    estimated_cost_usd: estimateAiCostUsd(input),
    created_at: new Date().toISOString(),
  }]);
}
