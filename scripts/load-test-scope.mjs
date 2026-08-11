export function selectCommentLoadScope(mode, students, subjects) {
  const sampleScope = mode === "sample" || mode === "preflight";
  return {
    selectedStudents: sampleScope ? students.slice(0, 5) : students,
    selectedSubjects: mode === "start" ? subjects : subjects.slice(0, 1),
  };
}
