import { readFile, readdir } from "node:fs/promises";
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
const auditScope = resolveStoredAuditScope({
  classroom: classData.classroom,
  students: classData.students,
  comments: commentData.comments,
  behaviors: behaviorData.behaviors,
});
const auditResult = auditStoredResults({
  students: classData.students, plan: planData.plan, levels: classData.levels,
  comments: commentData.comments, parts: commentData.parts, behaviors: behaviorData.behaviors,
});
const reviewComments = auditScope.partialReview
  ? commentData.comments.filter((item) => !isKnownFixtureText(item.comment))
  : commentData.comments;
const excludedReviewComments = commentData.comments.length - reviewComments.length;
const teacherReviewSample = auditScope.teacherReviewEligible ? buildTeacherReviewSample({
  students: classData.students,
  plan: planData.plan,
  levels: classData.levels,
  comments: reviewComments,
  auditResult,
  limit: Number(process.env.AUDIT_REVIEW_SAMPLE_SIZE) || 30,
}) : null;
if (teacherReviewSample) {
  teacherReviewSample.scope = {
    fullClassroomAudit: auditScope.officialEligible,
    partialReview: auditScope.partialReview,
    excludedKnownFixtureComments: excludedReviewComments,
    eligibleStoredComments: reviewComments.filter((item) => item.comment?.trim()).length,
    claimLimit: auditScope.partialReview
      ? "fixture를 제외한 교사 의미·사실성 표본 검토 전용이며 225건 전체 품질 감사로 해석하지 않음"
      : "공식 감사 안전장치를 통과한 학급 표본",
  };
}
process.stdout.write(`${JSON.stringify({
  mode: "stored-quality-audit", readOnly: true, auditScope, teacherReviewSample,
  ...auditResult,
}, null, 2)}\n`);
