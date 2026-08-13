import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { auditStoredResults } from "./stored-quality-audit-policy.mjs";
import { isKnownFixtureText, resolveStoredAuditScope } from "./stored-audit-scope-policy.mjs";
import { buildTeacherReviewSample } from "./teacher-review-sample-policy.mjs";

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");

async function credentials() {
  if (process.env.LOAD_TEST_EMAIL && process.env.LOAD_TEST_PASSWORD) return { email: process.env.LOAD_TEST_EMAIL, password: process.env.LOAD_TEST_PASSWORD };
  const directory = path.resolve(".local-secrets");
  const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
  if (!files.length) throw new Error("Lab credential file is required");
  const content = await readFile(path.join(directory, files.at(-1)), "utf8");
  const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
  const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
  if (!email || !password) throw new Error("Lab credential file is invalid");
  return { email, password };
}

const account = await credentials();
const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...account, returnTo: "/" }),
});
if (!login.ok) throw new Error(`Lab login failed (${login.status})`);
const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";", 1)[0]).join("; ");
const get = async (route) => {
  const response = await fetch(`${baseUrl}${route}`, { headers: { Cookie: cookie }, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${route} failed (${response.status})`);
  return data;
};
const [classData, planData, commentData, behaviorData] = await Promise.all([
  get("/api/class-data"), get("/api/assessment-plan"), get("/api/generated-comments"), get("/api/student-behaviors"),
]);
const excludedStudentIds = [...new Set(String(process.env.AUDIT_EXCLUDED_STUDENT_IDS || "")
  .split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0))];
const fixtureExcludedMode = process.env.AUDIT_MODE === "official-fixture-excluded";
if (fixtureExcludedMode && !excludedStudentIds.length) {
  throw new Error("AUDIT_EXCLUDED_STUDENT_IDS is required for an official fixture-excluded audit");
}
if (!fixtureExcludedMode && excludedStudentIds.length) {
  throw new Error("AUDIT_EXCLUDED_STUDENT_IDS is allowed only with AUDIT_MODE=official-fixture-excluded");
}
const knownStudentIds = new Set(classData.students.map((student) => Number(student.id)));
const unknownExcludedIds = excludedStudentIds.filter((studentId) => !knownStudentIds.has(studentId));
if (unknownExcludedIds.length) throw new Error(`Excluded students are not in the active classroom: ${unknownExcludedIds.join(", ")}`);
const excluded = new Set(excludedStudentIds);
const students = classData.students.filter((student) => !excluded.has(Number(student.id)));
const levels = classData.levels.filter((item) => !excluded.has(Number(item.studentId)));
const comments = commentData.comments.filter((item) => !excluded.has(Number(item.studentId)));
const parts = commentData.parts.filter((item) => !excluded.has(Number(item.studentId)));
const behaviors = behaviorData.behaviors.filter((item) => !excluded.has(Number(item.studentId)));
const auditScope = resolveStoredAuditScope({
  classroom: classData.classroom,
  students, comments, behaviors,
});
auditScope.population = {
  originalStudents: classData.students.length,
  auditedStudents: students.length,
  excludedFixtureStudentIds: excludedStudentIds,
  claimLimit: excludedStudentIds.length
    ? "명시한 오류 fixture 학생을 제외한 정상 범위의 공식 수치이며 학급 전체 수치로 해석하지 않음"
    : "학급 전체 공식 수치",
};
const auditResult = auditStoredResults({
  students, plan: planData.plan, levels, comments, parts, behaviors,
});
const reviewComments = auditScope.partialReview
  ? commentData.comments.filter((item) => !isKnownFixtureText(item.comment))
  : comments;
const excludedReviewComments = commentData.comments.length - reviewComments.length;
const teacherReviewSample = auditScope.teacherReviewEligible ? buildTeacherReviewSample({
  students,
  plan: planData.plan,
  levels,
  comments: reviewComments,
  auditResult,
  limit: Number(process.env.AUDIT_REVIEW_SAMPLE_SIZE) || 30,
}) : null;
if (teacherReviewSample) {
  teacherReviewSample.scope = {
    fullClassroomAudit: auditScope.officialEligible && excludedStudentIds.length === 0,
    partialReview: auditScope.partialReview,
    excludedKnownFixtureComments: excludedReviewComments,
    eligibleStoredComments: reviewComments.filter((item) => item.comment?.trim()).length,
    claimLimit: auditScope.partialReview
      ? "fixture를 제외한 교사 의미·사실성 표본 검토 전용이며 225건 전체 품질 감사로 해석하지 않음"
      : excludedStudentIds.length
        ? "명시한 오류 fixture 학생을 제외한 정상 범위의 공식 표본"
        : "공식 감사 안전장치를 통과한 학급 표본",
  };
}
const output = JSON.stringify({
  mode: "stored-quality-audit", readOnly: true, auditScope, teacherReviewSample,
  ...auditResult,
}, null, 2);
const outputFile = process.env.AUDIT_OUTPUT_FILE?.trim();
if (outputFile) {
  const resolvedOutputFile = path.resolve(outputFile);
  const localReportDirectory = path.resolve(".local-reports");
  if (resolvedOutputFile !== localReportDirectory && !resolvedOutputFile.startsWith(`${localReportDirectory}${path.sep}`)) {
    throw new Error("AUDIT_OUTPUT_FILE must be inside .local-reports");
  }
  await mkdir(path.dirname(resolvedOutputFile), { recursive: true });
  await writeFile(resolvedOutputFile, `${output}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    saved: true,
    outputFile: resolvedOutputFile,
    auditScope,
    teacherReviewSummary: teacherReviewSample ? {
      requested: teacherReviewSample.requested,
      available: teacherReviewSample.available,
      selected: teacherReviewSample.selected,
      scope: teacherReviewSample.scope,
    } : null,
  }, null, 2)}\n`);
} else {
  process.stdout.write(`${output}\n`);
}
