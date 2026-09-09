// All workloads use Terra; obsolete environment overrides cannot split routing.
export const primaryAiModel = () => "gpt-5.6-terra";

export function generationModel(...args: unknown[]) {
  void args;
  return primaryAiModel();
}
