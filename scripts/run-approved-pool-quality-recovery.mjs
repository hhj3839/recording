import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const jobId = process.env.COMMENT_POOL_JOB_ID?.trim() ?? "";
if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(jobId)) throw new Error("COMMENT_POOL_JOB_ID is required");
const apply = process.env.APPLY_APPROVED_POOL_RECOVERY === "YES";
const expectedRecoverable = Number(process.env.EXPECTED_RECOVERABLE_POOLS);
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
const response = await fetch(`${baseUrl}/api/comment-pools/recover-job`, {
  method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ jobId, apply, expectedRecoverable: apply ? expectedRecoverable : undefined }),
});
const data = await response.json();
if (!response.ok) throw new Error(data.error || `Pool recovery failed (${response.status})`);
process.stdout.write(`${JSON.stringify({ mode: "approved-pool-quality-recovery", aiCalls: 0, ...data }, null, 2)}\n`);
