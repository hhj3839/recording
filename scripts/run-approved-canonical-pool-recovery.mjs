import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

if (process.env.RUN_APPROVED_CANONICAL_RECOVERY !== "YES") throw new Error("Explicit canonical recovery approval is required");
const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const directory = path.resolve(".local-secrets");
const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
const content = files.length ? await readFile(path.join(directory, files.at(-1)), "utf8") : "";
const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
if (!email || !password || !email.endsWith("@giroksam.test")) throw new Error("Valid lab credentials are required");
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
const [beforeUsage, pools] = await Promise.all([request("/api/usage"), request("/api/comment-pools")]);
const expected = new Set([
  "수학|3. 나눗셈|수와 연산3|상", "수학|3. 나눗셈|수와 연산3|하", "미술|1. 생활 속 미술 만나기|감상|하",
]);
const missing = pools.groups.filter((group) => Number(group.approvedCount) === 0);
const actual = new Set(missing.map((group) => `${group.subject}|${group.unit}|${group.domain}|${group.level}`));
if (missing.length !== 3 || [...expected].some((key) => !actual.has(key)) || [...actual].some((key) => !expected.has(key))) {
  throw new Error("Canonical recovery scope changed");
}
const jobs = [];
for (const group of missing) {
  const started = await request("/api/comment-pools", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: group.subject, maxGroups: 1, labOnly: true, canonicalOnly: true, targetFingerprints: [group.fingerprint] }),
  });
  if (!started.jobId || Number(started.maxAiCalls) !== 0) throw new Error("Canonical recovery attempted to allow a paid call");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = await request(`/api/comment-pools?jobId=${encodeURIComponent(started.jobId)}`);
    if (["completed", "completed_with_errors"].includes(state.job.status)) break;
    if (attempt === 29) throw new Error("Canonical recovery timed out");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  jobs.push({ subject: group.subject, unit: group.unit, domain: group.domain, level: group.level, jobId: started.jobId });
}
const [afterUsage, afterPools] = await Promise.all([request("/api/usage"), request("/api/comment-pools")]);
if (Number(afterUsage.monthly) !== Number(beforeUsage.monthly)) throw new Error("Canonical recovery unexpectedly used AI calls");
process.stdout.write(`${JSON.stringify({ mode: "approved-canonical-recovery", jobs, calls: 0, usage: afterUsage.monthly, usable: afterPools.summary.usable, total: afterPools.summary.total }, null, 2)}\n`);
