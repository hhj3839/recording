/** Count saved coverage, not the presence of a partially assembled paragraph. */
export function commentCompletion(
  levels: readonly string[],
  comment: string,
  parts: readonly { assessmentIndex: number; status: string; sentence: string }[],
  generatedLevels: readonly { assessmentIndex: number; level: string }[],
) {
  const required = levels.flatMap((level, assessmentIndex) =>
    ["상", "중", "하"].includes(level) ? [{ assessmentIndex, level }] : []);
  const saved = required.filter(({ assessmentIndex, level }) => {
    if (!comment.trim()) return false;
    if (parts.length) return parts.some((part) => part.assessmentIndex === assessmentIndex
      && ["complete", "warning"].includes(part.status) && Boolean(part.sentence.trim()));
    // Manual edits remove parts but retain the generation coverage snapshot.
    return generatedLevels.some((item) => item.assessmentIndex === assessmentIndex && item.level === level);
  }).length;
  return { required: required.length, saved, complete: required.length > 0 && saved === required.length };
}
