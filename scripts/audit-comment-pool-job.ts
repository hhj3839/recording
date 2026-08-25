import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const jobId = process.env.COMMENT_POOL_JOB_ID?.trim() ?? "";
if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(jobId)) throw new Error("COMMENT_POOL_JOB_ID is required");
const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const directory = path.resolve(".local-secrets");
const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
const content = files.length ? await readFile(path.join(directory, files.at(-1)!), "utf8") : "";
const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
if (!email || !password || !email.toLowerCase().endsWith("@giroksam.test")) throw new Error("Valid lab credentials are required");

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, returnTo: "/" }),
});
if (!login.ok) throw new Error(`Lab login failed (${login.status})`);
const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";", 1)[0]).join("; ");
const response = await fetch(`${baseUrl}/api/comment-pools?jobId=${encodeURIComponent(jobId)}&audit=1`, {
  method: "GET", headers: { Cookie: cookie }, cache: "no-store",
});
const data = await response.json();
if (!response.ok) throw new Error(data.error || `Pool job audit failed (${response.status})`);
process.stdout.write(`${JSON.stringify({ mode: "comment-pool-job-audit", readOnly: true, ...data }, null, 2)}\n`);
