import { validateRecord } from "./record-validation.ts";

export type StrictBehaviorCandidate = { studentId: number; behavior: string };

export function selectBehaviorCandidate(candidates: unknown[]) {
  const unique = [...new Set(candidates.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
  const ranked = unique.map((behavior) => {
    const validation = validateRecord(behavior, true);
    const byteDistance = validation.bytes < 500 ? 500 - validation.bytes : validation.bytes > 600 ? validation.bytes - 600 : 0;
    const nonLengthFailures = [validation.sentenceCountOk, validation.endingsOk, validation.growthIncluded, validation.spellingOk,
      !validation.forbidden.length, !validation.styleIssues.length, !validation.repeated.length]
      .filter((passed) => !passed).length;
    return { behavior, validation, score: nonLengthFailures * 10_000 + byteDistance };
  }).sort((left, right) => Number(right.validation.valid) - Number(left.validation.valid) || left.score - right.score);
  return ranked[0] ?? null;
}

export function assertStrictGeneratedBehaviors<T extends StrictBehaviorCandidate>(behaviors: T[]) {
  const invalid = behaviors.filter((item) => !validateRecord(item.behavior, true).valid);
  if (invalid.length) {
    throw new Error(`엄격 검수를 통과하지 못한 행동특성은 저장할 수 없습니다: ${invalid.map((item) => item.studentId).join(", ")}`);
  }
  return behaviors;
}
