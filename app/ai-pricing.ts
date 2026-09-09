export type AiTokenUsage = {
  model?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

const MODEL_PRICING_USD_PER_MILLION: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
};

export function estimateAiCostUsd(usage: AiTokenUsage) {
  const pricing = usage.model ? MODEL_PRICING_USD_PER_MILLION[usage.model] : undefined;
  if (!pricing) return null;
  const input = Math.max(0, Number(usage.inputTokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(usage.cachedInputTokens) || 0));
  const output = Math.max(0, Number(usage.outputTokens) || 0);
  const terra = usage.model === "gpt-5.6-terra";
  const writes = terra ? Math.min(input - cached, Math.max(0, Number(usage.cacheWriteTokens) || 0)) : 0;
  const inputMultiplier = terra && input > 272_000 ? 2 : 1;
  const outputMultiplier = terra && input > 272_000 ? 1.5 : 1;
  return (((input - cached) * pricing.input + cached * pricing.cachedInput + writes * pricing.input * 0.25) * inputMultiplier + output * pricing.output * outputMultiplier) / 1_000_000;
}
