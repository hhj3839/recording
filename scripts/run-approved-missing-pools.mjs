import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

if (process.env.RUN_APPROVED_MISSING_POOLS !== "YES") {
  throw new Error("RUN_APPROVED_MISSING_POOLS=YES explicit approval is required");
}

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const directory = path.resolve(".local-secrets");
const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
if (!files.length) throw new Error("Lab credential file is required");
const content = await readFile(path.join(directory, files.at(-1)), "utf8");
const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
if (!email || !password || !email.toLowerCase().endsWith("@giroksam.test")) throw new Error("Valid lab credentials are required");

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnTo: "/" }),
});
if (!login.ok) throw new Error(`Lab login failed (${login.status})`);
const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";", 1)[0]).join("; ");
const request = async (route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { Cookie: cookie, ...(options.headers ?? {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${route} failed (${response.status})`);
  return data;
};

const approvedUsageBaseline = 76;
const beforeUsage = await request("/api/usage");
if (Number(beforeUsage.monthly) < approvedUsageBaseline || Number(beforeUsage.monthly) - approvedUsageBaseline > 8) {
  throw new Error("Approved usage baseline no longer matches");
}
const pools = await request("/api/comment-pools");
const expected = new Set([
  "수학|2. 평면도형|도형과 측정2|중",
  "수학|3. 나눗셈|수와 연산3|상",
  "수학|3. 나눗셈|수와 연산3|하",
  "미술|1. 생활 속 미술 만나기|감상|하",
]);
const missing = pools.groups.filter((group) => Number(group.approvedCount) === 0);
const actual = new Set(missing.map((group) => `${group.subject}|${group.unit}|${group.domain}|${group.level}`));
if ([...actual].some((key) => !expected.has(key))) throw new Error("Missing pool scope contains an unapproved group");

const jobs = [];
for (const group of missing) {
  const currentUsage = await request("/api/usage");
  const remainingApprovedCalls = 8 - (Number(currentUsage.monthly) - approvedUsageBaseline);
  if (remainingApprovedCalls < 2) break;
  const targetFingerprints = [group.fingerprint];
  const started = await request("/api/comment-pools", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: group.subject, maxGroups: 1, labOnly: true, targetFingerprints }),
  });
  if (!started.jobId) throw new Error(`${group.subject} did not start a bounded pool job`);
  if (Number(started.maxAiCalls) > 2) throw new Error(`${group.subject} exceeded the approved call ceiling`);
  jobs.push({ subject: group.subject, unit: group.unit, domain: group.domain, level: group.level, jobId: started.jobId, maxAiCalls: Number(started.maxAiCalls) });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await request(`/api/comment-pools?jobId=${encodeURIComponent(started.jobId)}`);
    if (["completed", "completed_with_errors"].includes(state.job.status)) break;
    if (state.job.status === "failed") throw new Error(`${group.subject} pool job failed: ${state.job.error}`);
    if (attempt === 119) throw new Error(`${group.subject} pool job timed out`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

const [afterUsage, afterPools] = await Promise.all([request("/api/usage"), request("/api/comment-pools")]);
const remainingMissing = afterPools.groups.filter((group) => Number(group.approvedCount) === 0);
const usedCalls = Number(afterUsage.monthly) - approvedUsageBaseline;
if (usedCalls > 8) throw new Error(`Approved maximum exceeded: ${usedCalls}/8 calls`);
process.stdout.write(`${JSON.stringify({
  mode: "approved-missing-pools", jobs, usedCalls,
  approvalBaseline: approvedUsageBaseline, usageBefore: beforeUsage.monthly, usageAfter: afterUsage.monthly,
  usablePools: afterPools.summary.usable, totalPools: afterPools.summary.total,
  remainingMissing: remainingMissing.map((group) => ({ subject: group.subject, unit: group.unit, domain: group.domain, level: group.level })),
}, null, 2)}\n`);
