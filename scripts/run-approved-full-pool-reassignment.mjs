import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

if (process.env.RUN_APPROVED_FULL_POOL_REASSIGNMENT !== "YES"
  || process.env.CONFIRM_ZERO_AI_POOL_REASSIGNMENT !== "YES") {
  throw new Error("Exact full-pool reassignment approval gates are required");
}
const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const files = (await readdir(".local-secrets")).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
const content = await readFile(path.join(".local-secrets", files.at(-1)), "utf8");
const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
if (!email || !password || !email.endsWith("@giroksam.test")) throw new Error("Valid lab credentials are required");
const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
if (!login.ok) throw new Error(`Lab login failed (${login.status})`);
const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";", 1)[0]).join("; ");
const request = async (route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { Cookie: cookie, ...(options.headers ?? {}) }, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${route} failed (${response.status})`);
  return data;
};
const [classData, planData, poolData, usageBefore] = await Promise.all([
  request("/api/class-data"), request("/api/assessment-plan"), request("/api/comment-pools"), request("/api/usage"),
]);
if (classData.students.length !== 25) throw new Error(`Expected 25 lab students, found ${classData.students.length}`);
const subjects = [...new Set(planData.plan.map((item) => item.subject))];
if (subjects.length !== 9 || planData.plan.length !== 25) throw new Error("Expected the approved 9-subject, 25-area plan");
if (poolData.summary.total !== 75 || poolData.summary.usable !== 75) throw new Error("All 75 approved pools must be usable before reassignment");
const levelLookup = new Map(classData.levels.map((item) => [`${item.studentId}|${item.subject}|${item.assessmentIndex}`, item.level]));
const scores = Object.fromEntries(subjects.map((subject) => {
  const subjectPlan = planData.plan.filter((item) => item.subject === subject);
  return [subject, classData.students.map((student) => ({
    studentId: student.id,
    levels: subjectPlan.map((_, index) => levelLookup.get(`${student.id}|${subject}|${index}`) ?? "-"),
  }))];
}));
const selectedStudentIds = classData.students.map((student) => Number(student.id));
const targetAssessmentIndexes = Object.fromEntries(subjects.flatMap((subject) => {
  const indexes = planData.plan.filter((item) => item.subject === subject).map((_, index) => index);
  return selectedStudentIds.map((studentId) => [`${studentId}|${subject}`, indexes]);
}));
const started = await request("/api/comment-jobs", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ scores, selectedStudentIds, overwriteExisting: false, targetAssessmentIndexes, forceTargetRegeneration: true }),
});
if (started.job.totalItems !== 625) throw new Error(`Expected 625 parts, received ${started.job.totalItems}`);
let job = started.job;
const deadline = Date.now() + 12 * 60_000;
while (["queued", "running"].includes(job.status) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  job = (await request("/api/comment-jobs")).job;
}
if (job.status !== "completed" || job.completedItems !== 625 || job.failedItems !== 0) {
  throw new Error(`Reassignment did not complete cleanly: ${JSON.stringify(job)}`);
}
const [generated, usageAfter] = await Promise.all([request("/api/generated-comments"), request("/api/usage")]);
if (usageAfter.monthly !== usageBefore.monthly) throw new Error(`AI usage changed from ${usageBefore.monthly} to ${usageAfter.monthly}`);
const activeIds = new Set(selectedStudentIds);
const savedParts = (generated.parts ?? []).filter((part) => activeIds.has(Number(part.studentId)) && subjects.includes(part.subject));
const savedComments = generated.comments.filter((comment) => activeIds.has(Number(comment.studentId)) && subjects.includes(comment.subject));
process.stdout.write(JSON.stringify({
  mode: "approved-full-pool-reassignment", jobId: job.id, status: job.status,
  students: 25, subjects: 9, completedParts: job.completedItems, failedParts: job.failedItems,
  savedParts: savedParts.length, savedComments: savedComments.length,
  usageBefore: usageBefore.monthly, usageAfter: usageAfter.monthly, aiCalls: usageAfter.monthly - usageBefore.monthly,
}, null, 2) + "\n");
