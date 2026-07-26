export const primaryAiModel = () => process.env.OPENAI_PRIMARY_MODEL || "gpt-5.4-mini";
export const fallbackAiModel = () => process.env.OPENAI_FALLBACK_MODEL || "gpt-5.6-terra";

export function generationModel(attempt: number, maxAttempts = 3) {
  return attempt === maxAttempts - 1 ? fallbackAiModel() : primaryAiModel();
}
