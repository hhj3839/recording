export type CommentAssemblyPart = {
  assessmentIndex: number;
  text: string;
};

export function rotateCommentPartsForStudent<T extends CommentAssemblyPart>(parts: T[], studentId: number) {
  const ordered = [...parts].sort((left, right) => left.assessmentIndex - right.assessmentIndex);
  if (ordered.length < 2) return ordered;
  const numericId = Number.isFinite(studentId) ? Math.abs(Math.trunc(studentId)) : 1;
  const offset = Math.max(0, numericId - 1) % ordered.length;
  return [...ordered.slice(offset), ...ordered.slice(0, offset)];
}

export function assembleRotatedComment<T extends CommentAssemblyPart>(parts: T[], studentId: number) {
  return rotateCommentPartsForStudent(parts.filter((part) => part.text.trim()), studentId)
    .map((part) => part.text.trim())
    .join(" ");
}
