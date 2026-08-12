import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { auditStoredResults } from "./stored-quality-audit-policy.mjs";

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");

async function credentials() {
  if (process.env.LOAD_TEST_EMAIL && process.env.LOAD_TEST_PASSWORD) return { email: process.env.LOAD_TEST_EMAIL, password: process.env.LOAD_TEST_PASSWORD };
  const directory = path.resolve(".local-secrets");
  const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
  if (!files.length) throw new Error("Lab credential file is required");
  const content = await readFile(path.join(directory, files.at(-1)), "utf8");
  const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
  const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
  if (!email || !password) throw new Error("Lab credential file is invalid");
  return { email, password };
}

const account = await credentials();
const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...account, returnTo: "/" }),
});
if (!login.ok) throw new Error(`Lab login failed (${login.status})`);
const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";", 1)[0]).join("; ");
const get = async (route) => {
  const response = await fetch(`${baseUrl}${route}`, { headers: { Cookie: cookie }, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${route} failed (${response.status})`);
  return data;
};
const [classData, planData, commentData, behaviorData] = await Promise.all([
  get("/api/class-data"), get("/api/assessment-plan"), get("/api/generated-comments"), get("/api/student-behaviors"),
]);
process.stdout.write(`${JSON.stringify({
  mode: "stored-quality-audit", readOnly: true,
  ...auditStoredResults({
    students: classData.students, plan: planData.plan, levels: classData.levels,
    comments: commentData.comments, parts: commentData.parts, behaviors: behaviorData.behaviors,
  }),
}, null, 2)}\n`);
