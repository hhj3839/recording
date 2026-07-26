import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const mode = process.argv[2] || "status";

async function credentials() {
  if (process.env.LOAD_TEST_EMAIL && process.env.LOAD_TEST_PASSWORD) {
    return { email: process.env.LOAD_TEST_EMAIL, password: process.env.LOAD_TEST_PASSWORD };
  }
  const directory = path.resolve(".local-secrets");
  const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
  if (!files.length) throw new Error("Lab credential file is required");
  const content = await readFile(path.join(directory, files.at(-1)), "utf8");
  const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
  const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
  if (!email || !password) throw new Error("Lab credential file is invalid");
  return { email, password };
}

function cookieHeader(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";", 1)[0]).join("; ");
}

const account = await credentials();
const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...account, returnTo: "/" }),
});
if (!login.ok) throw new Error(`Lab login failed (${login.status})`);
const cookie = cookieHeader(login);
const request = async (route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { Cookie: cookie, ...(options.headers ?? {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${route} failed (${response.status})`);
  return data;
};

if (mode === "start") {
  const [classData, planData] = await Promise.all([request("/api/class-data"), request("/api/assessment-plan")]);
  if (classData.students.length !== 25) throw new Error(`Expected 25 active students, found ${classData.students.length}`);
  const subjects = [...new Set(planData.plan.map((item) => item.subject))];
  const planCounts = Object.fromEntries(subjects.map((subject) => [subject, planData.plan.filter((item) => item.subject === subject).length]));
  const levelLookup = new Map(classData.levels.map((item) => [`${item.studentId}|${item.subject}|${item.assessmentIndex}`, item.level]));
  const scores = Object.fromEntries(subjects.map((subject) => [
    subject,
    classData.students.map((student) => ({
      studentId: student.id,
      levels: Array.from({ length: planCounts[subject] }, (_, index) => levelLookup.get(`${student.id}|${subject}|${index}`) ?? "-"),
    })),
  ]));
  const expectedItems = Object.values(scores).flat().filter((student) => student.levels.some((level) => ["상", "중", "하"].includes(level))).length;
  if (expectedItems !== 25 * subjects.length) {
    throw new Error(`Expected ${25 * subjects.length} student-subject inputs, found ${expectedItems}`);
  }
  const startedAt = new Date().toISOString();
  const result = await request("/api/comment-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scores }),
  });
  process.stdout.write(`${JSON.stringify({
    mode, startedAt, jobId: result.job.id, status: result.job.status,
    students: 25, subjects: subjects.length, subjectNames: subjects,
    expectedItems, totalBatches: result.job.totalBatches, alreadyRunning: Boolean(result.alreadyRunning),
  })}\n`);
} else {
  const [jobData, generatedData] = await Promise.all([request("/api/comment-jobs"), request("/api/generated-comments")]);
  const job = jobData.job;
  if (!job) throw new Error("No comment generation job found");
  const elapsedSeconds = Math.round((Date.parse(job.completedAt || new Date().toISOString()) - Date.parse(job.createdAt)) / 1000);
  process.stdout.write(`${JSON.stringify({
    mode, jobId: job.id, status: job.status, totalItems: job.totalItems,
    completedItems: job.completedItems, failedItems: job.failedItems,
    totalBatches: job.totalBatches, currentBatch: job.currentBatch,
    savedComments: generatedData.comments.length, elapsedSeconds,
    error: job.error || "",
  })}\n`);
}
