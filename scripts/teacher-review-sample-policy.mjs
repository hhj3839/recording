const sentencesOf = (text) => String(text || "").trim().split(/(?<=\.)\s+/).map((item) => item.trim()).filter(Boolean);

function evidenceFor(level, item) {
  if (level === "상") return item?.high ?? "";
  if (level === "중") return item?.middle ?? "";
  if (level === "하") return item?.low ?? "";
  return "";
}

function stableRows(rows) {
  return [...rows].sort((left, right) =>
    left.subject.localeCompare(right.subject, "ko")
    || left.assessmentIndex - right.assessmentIndex
    || left.studentId - right.studentId);
}

export function buildTeacherReviewSample({ students, plan, levels, comments, auditResult, limit = 30 }) {
  const allowedStudentIds = new Set(students.map((student) => Number(student.id)));
  const plansBySubject = new Map();
  for (const item of plan) {
    const rows = plansBySubject.get(item.subject) ?? [];
    rows.push(item);
    plansBySubject.set(item.subject, rows);
  }
  const levelByKey = new Map(levels.map((item) => [
    `${Number(item.studentId)}|${item.subject}|${Number(item.assessmentIndex)}`,
    item.level,
  ]));
  const warningsByKey = new Map(
    (auditResult?.comments?.remediation?.meaningReviewCandidates ?? []).map((item) => [
      `${Number(item.studentId)}|${item.subject}`,
      item.groundingWarnings ?? [],
    ]),
  );
  const rows = comments.flatMap((comment) => {
    const studentId = Number(comment.studentId);
    if (!allowedStudentIds.has(studentId) || !comment.comment?.trim()) return [];
    const subjectPlan = plansBySubject.get(comment.subject) ?? [];
    const warnings = warningsByKey.get(`${studentId}|${comment.subject}`) ?? [];
    return sentencesOf(comment.comment).map((sentence, assessmentIndex) => {
      const level = levelByKey.get(`${studentId}|${comment.subject}|${assessmentIndex}`) ?? "";
      return {
        studentId,
        subject: comment.subject,
        assessmentIndex,
        level,
        evidence: evidenceFor(level, subjectPlan[assessmentIndex]),
        sentence,
        warnings: warnings.filter((warning) => Number(warning.assessmentIndex) === assessmentIndex).map((warning) => warning.label),
      };
    });
  });
  const ordered = stableRows(rows);
  const warned = ordered.filter((row) => row.warnings.length > 0);
  const unflagged = ordered.filter((row) => row.warnings.length === 0);
  const selected = [...warned, ...unflagged].slice(0, Math.max(0, limit));
  return {
    anonymized: true,
    requested: limit,
    available: rows.length,
    selected: selected.length,
    instructions: {
      meaningMatch: "평가수준 근거와 생성 문장의 의미가 일치하면 pass, 아니면 fail",
      unsupportedFact: "평가수준 근거에 없는 활동·태도·성과·사실이 추가됐으면 yes, 아니면 no",
    },
    rows: selected.map((row, index) => ({
      reviewCode: `R${String(index + 1).padStart(3, "0")}`,
      subject: row.subject,
      assessmentIndex: row.assessmentIndex,
      level: row.level,
      evidence: row.evidence,
      sentence: row.sentence,
      warnings: row.warnings,
      judgment: { meaningMatch: "pending", unsupportedFact: "pending", note: "" },
    })),
  };
}

export function summarizeTeacherReview(rows) {
  const decided = rows.filter((row) => ["pass", "fail"].includes(row?.judgment?.meaningMatch)
    && ["yes", "no"].includes(row?.judgment?.unsupportedFact));
  const meaningPass = decided.filter((row) => row.judgment.meaningMatch === "pass").length;
  const unsupportedFacts = decided.filter((row) => row.judgment.unsupportedFact === "yes").length;
  const rate = (count) => decided.length ? Math.round(count / decided.length * 10000) / 100 : 0;
  return {
    decided: decided.length,
    meaningMatchRate: rate(meaningPass),
    meaningTarget95Met: decided.length > 0 && rate(meaningPass) >= 95,
    unsupportedFactRate: rate(unsupportedFacts),
    unsupportedFactTarget3Met: decided.length > 0 && rate(unsupportedFacts) <= 3,
    complete: decided.length === rows.length && rows.length > 0,
  };
}
