import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { selectCommentLoadScope } from "./load-test-scope.mjs";

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const mode = process.argv[2] || "status";
const paidModeApprovals = {
  sample: ["RUN_COMMENT_5_TEST", "5명 실제 AI 검사"],
  subject: ["RUN_COMMENT_25_TEST", "25명·1과목 실제 AI 검사"],
  start: ["RUN_FULL_225_TEST", "225건 전체 실제 AI 검사"],
  "missing-start": ["RUN_MISSING_COMMENT_TEST", "누락 교과 평어 실제 AI 검사"],
};
const paidModeApproval = paidModeApprovals[mode];
if (paidModeApproval && process.env[paidModeApproval[0]] !== "YES") {
  throw new Error(`${paidModeApproval[1]}는 ${paidModeApproval[0]}=YES로 명시적으로 승인해야 합니다.`);
}
const commentBatchSize = 5;
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

if (mode === "missing") {
  const [classData, planData, generatedData, usage] = await Promise.all([
    request("/api/class-data"),
    request("/api/assessment-plan"),
    request("/api/generated-comments"),
    request("/api/usage"),
  ]);
  const subjects = [...new Set(planData.plan.map((item) => item.subject))];
  const saved = new Set(generatedData.comments.filter((item) => item.comment.trim()).map((item) => `${item.studentId}|${item.subject}`));
  const missing = subjects.flatMap((subject) => classData.students.flatMap((student) =>
    saved.has(`${student.id}|${subject}`) ? [] : [{ subject, studentId: student.id, studentNumber: student.number }],
  ));
  process.stdout.write(`${JSON.stringify({
    mode,
    students: classData.students.length,
    subjects: subjects.length,
    expectedItems: classData.students.length * subjects.length,
    savedItems: saved.size,
    missingItems: missing.length,
    missing,
    monthlyUsage: usage.monthly,
    monthlyLimit: usage.limit,
    remainingCalls: Math.max(0, usage.limit - usage.monthly),
  })}\n`);
  process.exit(0);
}

if (mode === "missing-start") {
  const [classData, planData, generatedData, usage] = await Promise.all([
    request("/api/class-data"),
    request("/api/assessment-plan"),
    request("/api/generated-comments"),
    request("/api/usage"),
  ]);
  const subjects = [...new Set(planData.plan.map((item) => item.subject))];
  const saved = new Set(generatedData.comments.filter((item) => item.comment.trim()).map((item) => `${item.studentId}|${item.subject}`));
  const levelLookup = new Map(classData.levels.map((item) => [`${item.studentId}|${item.subject}|${item.assessmentIndex}`, item.level]));
  const scores = Object.fromEntries(subjects.flatMap((subject) => {
    const subjectPlan = planData.plan.filter((item) => item.subject === subject);
    const missingStudents = classData.students.filter((student) => !saved.has(`${student.id}|${subject}`));
    return missingStudents.length ? [[subject, missingStudents.map((student) => ({
      studentId: student.id,
      levels: subjectPlan.map((_, index) => levelLookup.get(`${student.id}|${subject}|${index}`) ?? "-"),
    }))]] : [];
  }));
  const selectedStudentIds = [...new Set(Object.values(scores).flat().map((item) => item.studentId))];
  const missingItems = Object.values(scores).flat().length;
  if (!missingItems) throw new Error("No missing comments found");
  const estimatedBatches = Object.values(scores).reduce((total, students) => total + Math.ceil(students.length / commentBatchSize), 0);
  if (usage.monthly + estimatedBatches > usage.limit) throw new Error("Monthly AI limit is insufficient for missing comments");
  const result = await request("/api/comment-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scores, selectedStudentIds, overwriteExisting: false }),
  });
  process.stdout.write(`${JSON.stringify({
    mode, jobId: result.job.id, status: result.job.status, alreadyRunning: Boolean(result.alreadyRunning),
    subjects: Object.keys(scores), missingItems, estimatedBatches, monthlyUsageBefore: usage.monthly,
  })}\n`);
  process.exit(0);
}

if (mode === "start" || mode === "subject" || mode === "sample" || mode === "preflight") {
  const [classData, planData] = await Promise.all([request("/api/class-data"), request("/api/assessment-plan")]);
  if (classData.students.length !== 25) throw new Error(`Expected 25 active students, found ${classData.students.length}`);
  const subjects = [...new Set(planData.plan.map((item) => item.subject))];
  const { selectedStudents, selectedSubjects } = selectCommentLoadScope(mode, classData.students, subjects);
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
  const estimatedBatches = selectedSubjects.reduce(
    (total, subject) => total + Math.ceil(scores[subject].filter((student) =>
      student.levels.some((level) => ["상", "중", "하"].includes(level))).length / commentBatchSize),
    0,
  );
  if (mode === "preflight") {
    const usage = await request("/api/usage");
    process.stdout.write(`${JSON.stringify({
      mode,
      ready: true,
      students: selectedStudents.length,
      subjects: selectedSubjects.length,
      subjectNames: selectedSubjects,
      assessmentPlanItems: planData.plan.length,
      assessmentLevels: classData.levels.length,
      expectedItems,
      estimatedBatches,
      monthlyUsage: usage.monthly,
      monthlyLimit: usage.limit,
      remainingCalls: Math.max(0, usage.limit - usage.monthly),
      canStartWithinLimit: usage.monthly + estimatedBatches <= usage.limit,
    })}\n`);
    process.exit(0);
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
    expectedItems, estimatedBatches, totalBatches: result.job.totalBatches, alreadyRunning: Boolean(result.alreadyRunning),
  })}\n`);
} else {
  const [jobData, generatedData, usageData, planData, classData] = await Promise.all([
    request("/api/comment-jobs"), request("/api/generated-comments"), request("/api/usage"), request("/api/assessment-plan"), request("/api/class-data"),
  ]);
  const job = jobData.job;
  if (!job) throw new Error("No comment generation job found");
  const elapsedSeconds = Math.round((Date.parse(job.completedAt || new Date().toISOString()) - Date.parse(job.createdAt)) / 1000);
  const expectedBySubject = Object.fromEntries([...new Set(planData.plan.map((item) => item.subject))]
    .map((subject) => [subject, planData.plan.filter((item) => item.subject === subject).length]));
  const currentComments = generatedData.comments.filter((item) => Date.parse(item.updatedAt) >= Date.parse(job.createdAt));
  const validations = currentComments.map((item) => ({
    ...validateComment(item.comment, expectedBySubject[item.subject] ?? 0),
    studentId: item.studentId,
    subject: item.subject,
  }));
  const validComments = validations.filter((item) => item.valid).length;
  process.stdout.write(`${JSON.stringify({
    mode, jobId: job.id, status: job.status, totalItems: job.totalItems,
    completedItems: job.completedItems, failedItems: job.failedItems,
    totalBatches: job.totalBatches, currentBatch: job.currentBatch,
    savedComments: currentComments.length, elapsedSeconds, validComments,
    strictSuccessRate: currentComments.length ? Math.round(validComments / currentComments.length * 10000) / 100 : 0,
    monthlyUsage: usageData.monthly, monthlyLimit: usageData.limit,
    tokens: usageData.tokens,
    estimatedCostUsd: usageData.estimatedCostUsd,
    invalidSamples: validations.filter((item) => !item.valid).slice(0, 10),
    error: job.error || "",
    ...(mode === "quality" ? {
      qualitySamples: currentComments.slice(0, 10).flatMap((item) => {
        const subjectPlan = planData.plan.filter((plan) => plan.subject === item.subject);
        const sentences = item.comment.trim().split(/(?<=\.)\s+/);
        const levels = classData.levels.filter((level) => level.studentId === item.studentId && level.subject === item.subject);
        return sentences.map((sentence, index) => {
          const level = levels.find((row) => Number(row.assessmentIndex) === index)?.level ?? "-";
          const plan = subjectPlan[index];
          const criterion = level === "상" ? plan?.high : level === "중" ? plan?.middle : level === "하" ? plan?.low : "";
          return { subject: item.subject, domain: plan?.domain ?? "", level, criterion, sentence };
        });
      }).slice(0, 30),
    } : {}),
  })}\n`);
}
