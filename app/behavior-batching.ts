export const BEHAVIOR_BATCH_SIZE = 5;

export function batchBehaviors<T>(items: T[], size = BEHAVIOR_BATCH_SIZE) {
  if (!Number.isInteger(size) || size < 1) throw new Error("배치 크기는 1 이상의 정수여야 합니다.");
  return Array.from(
    { length: Math.ceil(items.length / size) },
    (_, index) => items.slice(index * size, index * size + size),
  );
}
