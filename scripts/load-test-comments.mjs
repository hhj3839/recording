import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const mode = process.argv[2] || "status";
const commentForbiddenExpressions = ["부족함", "미흡함", "못함", "어려워함", "이해하지 못함", "소극적임", "불성실함"];

function validateComment(comment, expectedSentenceCount) {
  const sentences = comment.trim().split(/(?<=\.)\s+/).map((item) => item.trim()).filter(Boolean);
  const lengths = sentences.map((sentence) => Array.from(sentence).length);
  return {
    valid: sentences.length === expectedSentenceCount
      && lengths.every((length) => length >= 50 && length <= 60)
      && sentences.every((sentence) => sentence.endsWith("함."))
      && !commentForbiddenExpressions.some((expression) => comment.includes(expression)),
    sentenceCount: sentences.length,
    lengths,
  };
}

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

if (mode === "start" || mode === "sample") {
  const [classData, planData] = await Promise.all([request("/api/class-data"), request("/api/assessment-plan")]);
  if (classData.students.length !== 25) throw new Error(`Expected 25 active students, found ${classData.students.length}`);
  const subjects = [...new Set(planData.plan.map((item) => item.subject))];
  const selectedSubjects = mode === "sample" ? subjects.slice(0, 1) : subjects;
  const selectedStudents = mode === "sample" ? classData.students.slice(0, 5) : classData.students;
  const planCounts = Object.fromEntries(selectedSubjects.map((subject) => [subject, planData.plan.filter((item) => item.subject === subject).length]));
  const levelLookup = new Map(classData.levels.map((item) => [`${item.studentId}|${item.subject}|${item.assessmentIndex}`, item.level]));
  const scores = Object.fromEntries(selectedSubjects.map((subject) => [
    subject,
    selectedStudents.map((student) => ({
      studentId: student.id,
      levels: Array.from({ length: planCounts[subject] }, (_, index) => levelLookup.get(`${student.id}|${subject}|${index}`) ?? "-"),
    })),
  ]));
  const expectedItems = Object.values(scores).flat().filter((student) => student.levels.some((level) => ["상", "중", "하"].includes(level))).length;
  if (expectedItems !== selectedStudents.length * selectedSubjects.length) {
    throw new Error(`Expected ${selectedStudents.length * selectedSubjects.length} student-subject inputs, found ${expectedItems}`);
  }
  const startedAt = new Date().toISOString();
  const result = await request("/api/comment-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scores,
      selectedStudentIds: selectedStudents.map((student) => student.id),
    }),
  });
  process.stdout.write(`${JSON.stringify({
    mode, startedAt, jobId: result.job.id, status: result.job.status,
    students: selectedStudents.length, subjects: selectedSubjects.length, subjectNames: selectedSubjects,
    expectedItems, totalBatches: result.job.totalBatches, alreadyRunning: Boolean(result.alreadyRunning),
  })}\n`);
} else {
  const [jobData, generatedData, usageData, planData] = await Promise.all([
    request("/api/comment-jobs"), request("/api/generated-comments"), request("/api/usage"), request("/api/assessment-plan"),
  ]);
  const job = jobData.job;
  if (!job) throw new Error("No comment generation job found");
  const elapsedSeconds = Math.round((Date.parse(job.completedAt || new Date().toISOString()) - Date.parse(job.createdAt)) / 1000);
  const expectedBySubject = Object.fromEntries([...new Set(planData.plan.map((item) => item.subject))]
    .map((subject) => [subject, planData.plan.filter((item) => item.subject === subject).length]));
  const validations = generatedData.comments.map((item) => ({
    ...validateComment(item.comment, expectedBySubject[item.subject] ?? 0),
    studentId: item.studentId,
    subject: item.subject,
  }));
  const validComments = validations.filter((item) => item.valid).length;
  process.stdout.write(`${JSON.stringify({
    mode, jobId: job.id, status: job.status, totalItems: job.totalItems,
    completedItems: job.completedItems, failedItems: job.failedItems,
    totalBatches: job.totalBatches, currentBatch: job.currentBatch,
    savedComments: generatedData.comments.length, elapsedSeconds, validComments,
    strictSuccessRate: generatedData.comments.length ? Math.round(validComments / generatedData.comments.length * 10000) / 100 : 0,
    monthlyUsage: usageData.monthly, monthlyLimit: usageData.limit,
    invalidSamples: validations.filter((item) => !item.valid).slice(0, 10),
    error: job.error || "",
  })}\n`);
}
