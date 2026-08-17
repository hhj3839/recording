export function selectCommentLoadScope(mode, students, subjects, preferredSubject = "") {
  const sampleScope = mode === "sample" || mode === "preflight";
  const selectedSubject = preferredSubject && subjects.includes(preferredSubject)
    ? preferredSubject
    : subjects[0];
  return {
    selectedStudents: sampleScope ? students.slice(0, 5) : students,
    selectedSubjects: mode === "start" ? subjects : selectedSubject ? [selectedSubject] : [],
  };
}

export function commentLoadOverwriteExisting(mode) {
  return mode === "sample" || mode === "subject";
}

export function selectBehaviorLoadScope(mode, readyStudents, approvedStudentIds = []) {
  if (approvedStudentIds.length) {
    const approved = new Set(approvedStudentIds.map(Number));
    return readyStudents.filter((item) => approved.has(Number(item.studentId)));
  }
  const sampleScope = mode === "sample" || mode === "preflight";
  if (!sampleScope) return readyStudents.slice(0, 25);
  return [...readyStudents]
    .sort((left, right) => Number(left.strict) - Number(right.strict))
    .slice(0, 5);
}
