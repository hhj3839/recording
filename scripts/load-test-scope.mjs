export function selectCommentLoadScope(mode, students, subjects) {
  const sampleScope = mode === "sample" || mode === "preflight";
  return {
    selectedStudents: sampleScope ? students.slice(0, 5) : students,
    selectedSubjects: mode === "start" ? subjects : subjects.slice(0, 1),
  };
}

export function selectBehaviorLoadScope(mode, readyStudents) {
  const sampleScope = mode === "sample" || mode === "preflight";
  if (!sampleScope) return readyStudents.slice(0, 25);
  return [...readyStudents]
    .sort((left, right) => Number(left.strict) - Number(right.strict))
    .slice(0, 5);
}
