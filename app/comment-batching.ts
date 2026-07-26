export const COMMENT_BATCH_SIZE = 3;

export function batchCommentsBySubject<T extends { subject: string }>(items: T[], size = COMMENT_BATCH_SIZE) {
  if (!Number.isInteger(size) || size < 1) throw new Error("배치 크기는 1 이상의 정수여야 합니다.");
  return [...new Set(items.map((item) => item.subject))].flatMap((subject) => {
    const subjectItems = items.filter((item) => item.subject === subject);
    return Array.from(
      { length: Math.ceil(subjectItems.length / size) },
      (_, index) => subjectItems.slice(index * size, index * size + size),
    );
  });
}
