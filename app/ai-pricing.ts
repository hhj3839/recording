export type AiTokenUsage = {
  model?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

const MODEL_PRICING_USD_PER_MILLION: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
};

export function estimateAiCostUsd(usage: AiTokenUsage) {
  const pricing = usage.model ? MODEL_PRICING_USD_PER_MILLION[usage.model] : undefined;
  if (!pricing) return null;
  const input = Math.max(0, Number(usage.inputTokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(usage.cachedInputTokens) || 0));
  const output = Math.max(0, Number(usage.outputTokens) || 0);
  return ((input - cached) * pricing.input + cached * pricing.cachedInput + output * pricing.output) / 1_000_000;
}
