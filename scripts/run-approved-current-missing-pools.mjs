import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

if (process.env.RUN_APPROVED_CURRENT_MISSING_POOLS !== "YES") {
  throw new Error("RUN_APPROVED_CURRENT_MISSING_POOLS=YES explicit approval is required");
}

const expectedCount = Number(process.env.EXPECTED_MISSING_POOLS);
const approvedCallLimit = Number(process.env.MAX_APPROVED_AI_CALLS);
if (expectedCount !== 15 || approvedCallLimit !== 30) {
  throw new Error("Expected exactly 15 pools and a 30-call ceiling");
}

const expectedScopes = new Set([
  "사회|1. 우리가 사는 곳|지리 인식|중",
  "사회|2. 일상에서 만나는 과거|역사 일반|상",
  "사회|2. 일상에서 만나는 과거|지역사|상",
  "사회|2. 일상에서 만나는 과거|지역사|중",
  "사회|2. 일상에서 만나는 과거|지역사|하",
  "도덕|3. 함께하는 우리 가족|타인과의 관계|하",
  "수학|1. 덧셈과 뺄셈|수와 연산1|상",
  "수학|1. 덧셈과 뺄셈|수와 연산1|하",
  "수학|2. 평면도형|도형과 측정2|하",
  "수학|4. 곱셈|수와 연산4|중",
  "과학|1. 힘과 우리 생활|운동과 에너지|상",
  "과학|2. 동물의 생활|생명2|하",
  "과학|4. 생물의 한살이|생명3|하",
  "음악|2. 음악을 열어요|연주|상",
  "미술|3. 수채로 표현하기|표현|상",
]);

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const directory = path.resolve(".local-secrets");
const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
if (!files.length) throw new Error("Lab credential file is required");
const content = await readFile(path.join(directory, files.at(-1)), "utf8");
const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
if (!email || !password || !email.toLowerCase().endsWith("@giroksam.test")) {
  throw new Error("Valid lab credentials are required");
}

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, returnTo: "/" }),
});
if (!login.ok) throw new Error(`Lab login failed (${login.status})`);
const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";", 1)[0]).join("; ");
const request = async (route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { Cookie: cookie, ...(options.headers ?? {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${route} failed (${response.status})`);
  return data;
};

const [beforePools, beforeUsage] = await Promise.all([
  request("/api/comment-pools"),
  request("/api/usage"),
]);
const missing = beforePools.groups.filter((group) => group.status !== "ready");
const actualScopes = new Set(missing.map((group) => `${group.subject}|${group.unit}|${group.domain}|${group.level}`));
if (missing.length > expectedCount || [...actualScopes].some((scope) => !expectedScopes.has(scope))) {
  throw new Error("Current missing pool scope does not match the approved 15-pool scope");
}

const startedAt = Date.now();
const started = beforePools.activeJob
  ? { ...beforePools.activeJob, jobId: beforePools.activeJob.id, maxAiCalls: Number(beforePools.activeJob.total) * 2 }
  : await request("/api/comment-pools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      labOnly: true,
      maxGroups: expectedCount,
      targetFingerprints: missing.map((group) => group.fingerprint),
    }),
    });
if (!started.jobId) throw new Error("Bounded missing-pool job did not start");
if (Number(started.total) > expectedCount || Number(started.maxAiCalls ?? Number(started.total) * 2) > approvedCallLimit) {
  throw new Error("Server job scope exceeded the approved limits");
}

let state;
for (let attempt = 0; attempt < 300; attempt += 1) {
  state = await request(`/api/comment-pools?jobId=${encodeURIComponent(started.jobId)}`);
  if (["completed", "completed_with_errors", "failed"].includes(state.job.status)) break;
  if (attempt === 299) throw new Error("Missing-pool job timed out");
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

const [afterPools, afterUsage] = await Promise.all([
  request("/api/comment-pools"),
  request("/api/usage"),
]);
const usedCalls = Number(afterUsage.monthly) - Number(beforeUsage.monthly);
if (usedCalls > approvedCallLimit) throw new Error(`Approved maximum exceeded: ${usedCalls}/${approvedCallLimit}`);

process.stdout.write(`${JSON.stringify({
  mode: "approved-current-missing-pools",
  jobId: started.jobId,
  jobStatus: state.job.status,
  elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  requestedPools: expectedCount,
  maxAiCalls: approvedCallLimit,
  usedCalls,
  usageBefore: beforeUsage.monthly,
  usageAfter: afterUsage.monthly,
  summaryBefore: beforePools.summary,
  summaryAfter: afterPools.summary,
  remaining: afterPools.groups
    .filter((group) => group.status !== "ready")
    .map((group) => ({ subject: group.subject, unit: group.unit, domain: group.domain, level: group.level })),
}, null, 2)}\n`);
