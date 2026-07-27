export const primaryAiModel = () => process.env.OPENAI_PRIMARY_MODEL || "gpt-5.4-mini";

export function generationModel(...args: unknown[]) {
  void args;
  return primaryAiModel();
}
