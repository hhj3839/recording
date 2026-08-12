import { validateRecord } from "./record-validation.ts";

export type StrictBehaviorCandidate = { studentId: number; behavior: string };

export function assertStrictGeneratedBehaviors<T extends StrictBehaviorCandidate>(behaviors: T[]) {
  const invalid = behaviors.filter((item) => !validateRecord(item.behavior, true).valid);
  if (invalid.length) {
    throw new Error(`엄격 검수를 통과하지 못한 행동특성은 저장할 수 없습니다: ${invalid.map((item) => item.studentId).join(", ")}`);
  }
  return behaviors;
}
