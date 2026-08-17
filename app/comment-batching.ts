export const COMMENT_BATCH_SIZE = 25;
export const COMMENT_REPAIR_EVIDENCE_BATCH_SIZE = 10;
export const MAX_COMMENT_AI_CALLS_PER_BATCH = 5;
export const MAX_COMMENT_DIVERSITY_CALLS_PER_BATCH = 1;

export function batchCommentsByAssessmentArea<
  TItem extends { assessmentIndex: number },
  T extends { subject: string; items: TItem[]; subjectItems?: TItem[] },
>(items: T[], size = COMMENT_BATCH_SIZE) {
  if (!Number.isInteger(size) || size < 1) throw new Error("배치 크기는 1 이상의 정수여야 합니다.");
  return [...new Set(items.map((item) => item.subject))].flatMap((subject) => {
    const subjectItems = items.filter((item) => item.subject === subject);
    const assessmentIndexes = [...new Set(subjectItems.flatMap((item) => item.items.map((entry) => entry.assessmentIndex)))].sort((a, b) => a - b);
    return assessmentIndexes.flatMap((assessmentIndex) => {
      const areaItems = subjectItems.flatMap((item) => {
        const target = item.items.find((entry) => entry.assessmentIndex === assessmentIndex);
        return target ? [{
          ...item,
          items: [target],
          // A missing-area repair carries the full subject evidence separately.
          // Preserve it so the runner can rebuild the complete saved comment
          // after generating only the requested area.
          subjectItems: item.subjectItems ?? item.items,
        }] : [];
      });
      return Array.from({ length: Math.ceil(areaItems.length / size) }, (_, index) => areaItems.slice(index * size, index * size + size));
    });
  });
}

export function batchCommentRepairs<
  TItem,
  TEntry extends { studentId: number; subject: string; items: TItem[] },
>(entries: TEntry[], size = COMMENT_REPAIR_EVIDENCE_BATCH_SIZE): TEntry[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("보완 영역 배치 크기는 1 이상의 정수여야 합니다.");
  const flattened = entries.flatMap((entry) => entry.items.map((item) => ({ entry, item })));
  return Array.from({ length: Math.ceil(flattened.length / size) }, (_, index) => {
    const grouped = new Map<string, TEntry>();
    for (const { entry, item } of flattened.slice(index * size, index * size + size)) {
      const key = `${entry.studentId}|${entry.subject}`;
      const current = grouped.get(key);
      if (current) current.items.push(item);
      else grouped.set(key, { ...entry, items: [item] });
    }
    return [...grouped.values()];
  });
}
