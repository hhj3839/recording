const FIXTURE_CLASSROOM_PATTERN = /(?:오류\s*UI|UI\s*오류|fixture)/i;
const FIXTURE_STUDENT_PATTERN = /^오류학생/i;
const FIXTURE_CONTENT_PATTERNS = [
  /학원에서\s*대회\s*실적을\s*준비하며\s*되여/,
  /학원에서\s*역활을\s*맡았다/,
  /010-1234-5678/,
];

export function isKnownFixtureText(value) {
  const text = String(value ?? "");
  return FIXTURE_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function resolveStoredAuditScope({ env = process.env, classroom, students, comments = [], behaviors = [] }) {
  const requestedMode = env.AUDIT_MODE;
  const allowedModes = ["official", "official-fixture-excluded", "teacher-review"];
  const mode = allowedModes.includes(requestedMode) ? requestedMode : "diagnostic";
  const expectedClassroomId = Number(env.AUDIT_CLASSROOM_ID);
  const hasExpectedClassroomId = Number.isInteger(expectedClassroomId) && expectedClassroomId > 0;
  const fixtureSignals = [];

  if (FIXTURE_CLASSROOM_PATTERN.test(String(classroom?.schoolName ?? ""))) {
    fixtureSignals.push("fixtureClassroomName");
  }
  if ((students ?? []).some((student) => FIXTURE_STUDENT_PATTERN.test(String(student?.name ?? "")))) {
    fixtureSignals.push("fixtureStudentName");
  }
  const storedTexts = [
    ...comments.map((item) => item?.comment),
    ...behaviors.flatMap((item) => [item?.characteristic, item?.behavior]),
  ].map((value) => String(value ?? ""));
  if (storedTexts.some(isKnownFixtureText)) {
    fixtureSignals.push("knownFixtureContent");
  }

  if (hasExpectedClassroomId && Number(classroom?.id) !== expectedClassroomId) {
    throw new Error(`Audit classroom mismatch: expected ${expectedClassroomId}, active ${classroom?.id ?? "unknown"}`);
  }
  if (["official", "official-fixture-excluded", "teacher-review"].includes(mode) && !hasExpectedClassroomId) {
    throw new Error("AUDIT_CLASSROOM_ID is required for an official audit or teacher review");
  }
  if (["official", "official-fixture-excluded"].includes(mode) && fixtureSignals.length) {
    throw new Error(`Official audit blocked by fixture signals: ${fixtureSignals.join(", ")}`);
  }
  if (mode === "teacher-review" && fixtureSignals.some((signal) => signal !== "knownFixtureContent")) {
    throw new Error(`Teacher review blocked by fixture scope: ${fixtureSignals.join(", ")}`);
  }

  return {
    mode,
    officialEligible: ["official", "official-fixture-excluded"].includes(mode) && fixtureSignals.length === 0,
    teacherReviewEligible: ["official", "official-fixture-excluded"].includes(mode) ? fixtureSignals.length === 0
      : mode === "teacher-review" && fixtureSignals.every((signal) => signal === "knownFixtureContent"),
    partialReview: mode === "teacher-review",
    targetVerified: hasExpectedClassroomId,
    fixtureDetected: fixtureSignals.length > 0,
    fixtureSignals,
    classroom: classroom ? {
      id: Number(classroom.id),
      schoolName: classroom.schoolName,
      schoolYear: Number(classroom.schoolYear),
      semester: Number(classroom.semester),
      grade: Number(classroom.grade),
      classNumber: Number(classroom.classNumber),
    } : null,
  };
}
