import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const mode = process.argv[2] || "status";
if (mode === "seed" && process.env.SEED_BEHAVIOR_TEST_DATA !== "YES") {
  throw new Error("실험실 특성 입력은 SEED_BEHAVIOR_TEST_DATA=YES로 명시적으로 승인해야 합니다.");
}
if (mode === "sample" && process.env.RUN_BEHAVIOR_5_TEST !== "YES") {
  throw new Error("5명 실제 AI 검사는 RUN_BEHAVIOR_5_TEST=YES로 명시적으로 승인해야 합니다.");
}
if (mode === "full" && process.env.RUN_BEHAVIOR_25_TEST !== "YES") {
  throw new Error("25명 실제 AI 검사는 5명 게이트 통과 후 RUN_BEHAVIOR_25_TEST=YES로 명시적으로 승인해야 합니다.");
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

function characteristicCount(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;
  const labeled = normalized.split(/\r?\n|·/).filter((item) => /^[^:\n]{2,20}:\s*\S/.test(item.trim()));
  return labeled.length || normalized.split(/\r?\n|·/).map((item) => item.trim()).filter(Boolean).length;
}

function validateBehavior(text) {
  const normalized = String(text || "").trim();
  const bytes = new TextEncoder().encode(normalized).length;
  const sentences = normalized.split(/(?<=[.!?])\s+|\n+/).map((item) => item.trim()).filter(Boolean);
  const nominalEnding = (sentence) => {
    const last = sentence.trim().replace(/[.!?]+$/, "").at(-1);
    if (!last) return false;
    const code = last.charCodeAt(0);
    return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 16;
  };
  return {
    bytes,
    strict: bytes >= 500 && bytes <= 550 && sentences.length > 0 && sentences.every(nominalEnding),
    reviewable: bytes >= 470 && bytes <= 580 && sentences.length > 0 && sentences.every(nominalEnding),
  };
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

if (["preflight", "seed", "sample", "full"].includes(mode)) {
  const [classData, behaviorData, usage] = await Promise.all([
    request("/api/class-data"), request("/api/student-behaviors"), request("/api/usage"),
  ]);
  const behaviorByStudent = new Map(behaviorData.behaviors.map((item) => [item.studentId, item]));
  if (mode === "seed") {
    const templates = [
      "학습 태도: 수업에 성실히 참여하며 궁금한 내용을 질문함 · 교우관계: 친구의 말을 경청하고 갈등을 대화로 해결함 · 책임감: 맡은 역할을 끝까지 수행함 · 생활 습관: 준비물을 스스로 점검함 · 성장 모습: 발표에 꾸준히 참여하는 모습이 향상됨",
      "학습 태도: 과제 해결 방법을 스스로 탐색함 · 교우관계: 모둠원의 의견을 존중하며 협력함 · 책임감: 공동 과제를 계획대로 수행함 · 자기관리: 학습 시간과 준비물을 관리함 · 성장 모습: 자신의 생각을 구체적으로 설명하는 힘이 성장함",
      "학습 태도: 학습 내용을 차분히 정리하고 복습함 · 교우관계: 도움이 필요한 친구를 살피고 배려함 · 의사소통: 상대의 말을 듣고 알맞게 응답함 · 생활 습관: 교실 규칙을 꾸준히 실천함 · 성장 모습: 모둠 활동에서 의견을 적극적으로 제시하게 됨",
      "학습 태도: 새로운 문제에 끈기 있게 도전함 · 교우관계: 친구들과 역할을 공정하게 나누어 협력함 · 책임감: 시작한 활동을 마무리함 · 자기관리: 주변을 정리하고 할 일을 점검함 · 성장 모습: 피드백을 반영하여 과제 완성도가 향상됨",
      "학습 태도: 관찰한 내용을 자세히 기록하고 질문함 · 교우관계: 다른 의견을 존중하며 공통점을 찾음 · 책임감: 학급에서 맡은 일을 꾸준히 실천함 · 표현: 생각을 다양한 방법으로 나타냄 · 성장 모습: 여러 사람 앞에서 말하는 자신감이 점차 성장함",
    ];
    const selected = classData.students.slice(0, templates.length);
    for (let index = 0; index < selected.length; index += 1) {
      await request("/api/student-behaviors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: selected[index].id,
          characteristic: templates[index],
          behavior: behaviorByStudent.get(selected[index].id)?.behavior ?? "",
          confirmed: false,
        }),
      });
    }
    process.stdout.write(`${JSON.stringify({ mode, seededStudents: selected.length, studentIds: selected.map((item) => item.id) })}\n`);
    process.exit(0);
  }
  const ready = classData.students.map((student) => ({
    studentId: student.id,
    characteristic: behaviorByStudent.get(student.id)?.characteristic ?? "",
  })).filter((item) => characteristicCount(item.characteristic) >= 4);
  const targetCount = mode === "sample" ? 5 : 25;
  const selected = ready.slice(0, targetCount);
  const estimatedInitialCalls = Math.ceil(selected.length / 5);
  if (mode === "preflight") {
    process.stdout.write(`${JSON.stringify({
      mode, ready: ready.length >= 5, activeStudents: classData.students.length, readyStudents: ready.length,
      sampleGateStudents: Math.min(5, ready.length), estimatedInitialCalls,
      monthlyUsage: usage.monthly, monthlyLimit: usage.limit,
      remainingCalls: Math.max(0, usage.limit - usage.monthly),
    })}\n`);
    process.exit(0);
  }
  if (selected.length !== targetCount) {
    throw new Error(`특성이 4개 이상 입력된 학생이 ${selected.length}명입니다. ${targetCount}명이 필요합니다.`);
  }
  const result = await request("/api/behavior-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ students: selected }),
  });
  process.stdout.write(`${JSON.stringify({
    mode, jobId: result.job.id, status: result.job.status, students: selected.length,
    totalBatches: result.job.totalBatches, estimatedInitialCalls, alreadyRunning: Boolean(result.alreadyRunning),
  })}\n`);
} else {
  const [jobData, behaviorData, usage] = await Promise.all([
    request("/api/behavior-jobs"), request("/api/student-behaviors"), request("/api/usage"),
  ]);
  const job = jobData.job;
  if (!job) throw new Error("No behavior generation job found");
  const current = behaviorData.behaviors.filter((item) => Date.parse(item.updatedAt) >= Date.parse(job.createdAt));
  const validations = current.map((item) => ({ studentId: item.studentId, ...validateBehavior(item.behavior) }));
  process.stdout.write(`${JSON.stringify({
    mode, jobId: job.id, status: job.status, totalItems: job.totalItems,
    completedItems: job.completedItems, failedItems: job.failedItems,
    savedBehaviors: current.length,
    strictCount: validations.filter((item) => item.strict).length,
    reviewableCount: validations.filter((item) => item.reviewable).length,
    strictSuccessRate: current.length ? Math.round(validations.filter((item) => item.strict).length / current.length * 10000) / 100 : 0,
    monthlyUsage: usage.monthly, monthlyLimit: usage.limit, tokens: usage.tokens,
    estimatedCostUsd: usage.estimatedCostUsd,
    invalidSamples: validations.filter((item) => !item.strict).slice(0, 10),
    error: job.error || "",
  })}\n`);
}
