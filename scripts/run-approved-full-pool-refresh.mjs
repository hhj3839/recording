import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

if (process.env.RUN_APPROVED_FULL_POOL_REFRESH !== "YES") {
  throw new Error("RUN_APPROVED_FULL_POOL_REFRESH=YES explicit approval is required");
}

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
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, returnTo: "/" }),
});
if (!login.ok) throw new Error(`Lab login failed (${login.status})`);
const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";", 1)[0]).join("; ");
const request = async (route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options, headers: { Cookie: cookie, ...(options.headers ?? {}) }, cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${route} failed (${response.status})`);
  return data;
};

const before = await request("/api/comment-pools");
if (Number(before.summary?.total) !== 75) throw new Error("Current lab scope is not exactly 75 pools");
const started = await request("/api/comment-pools", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ labOnly: true, fullRefresh: true }),
});
if (!started.jobId || Number(started.total) !== 75 || Number(started.maxAiCalls) !== 150) {
  throw new Error("Full refresh did not preserve the approved 75-pool and 150-call ceilings");
}

let state;
for (let attempt = 0; attempt < 900; attempt += 1) {
  state = await request(`/api/comment-pools?jobId=${encodeURIComponent(started.jobId)}`);
  if (["completed", "completed_with_errors", "failed"].includes(state.job.status)) break;
  if (attempt === 899) throw new Error("Full pool refresh timed out");
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (state.job.status === "failed") throw new Error(`Full pool refresh failed: ${state.job.error}`);
const after = await request("/api/comment-pools");
process.stdout.write(`${JSON.stringify({
  mode: "approved-full-pool-refresh",
  job: state.job,
  before: before.summary,
  after: after.summary,
  maxAiCalls: Number(started.maxAiCalls),
}, null, 2)}\n`);
