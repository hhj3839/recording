import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const authorizedExpected = { 사회: 9, 도덕: 14, 수학: 4, 과학: 4, 음악: 3, 미술: 7, 체육: 4, 영어: 2 };
// The production request can cross a serverless execution boundary. This exact
// remainder makes the approved operation safely resumable without revisiting
// subjects that have already completed.
let expected = process.env.RESUME_APPROVED_POOL_REPAIRS === "YES"
  ? { 과학: 4, 음악: 3, 미술: 7, 체육: 4, 영어: 2 }
  : authorizedExpected;
const requestedSubject = process.env.APPROVED_POOL_REPAIR_SUBJECT?.trim();
if (requestedSubject) {
  const expectedCount = expected[requestedSubject];
  if (!expectedCount) throw new Error("The requested subject is outside the approved remainder");
  expected = { [requestedSubject]: expectedCount };
}
const apply = process.env.APPLY_APPROVED_POOL_REPAIRS === "YES";
if (apply && process.env.APPROVE_SHARED_POOL_REPAIR !== "YES") throw new Error("Explicit shared-pool repair approval is required");
const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const secretDirectory = path.resolve(".local-secrets");
const files = (await readdir(secretDirectory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
const content = files.length ? await readFile(path.join(secretDirectory, files.at(-1)), "utf8") : "";
const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
if (!email || !password || !email.endsWith("@giroksam.test")) throw new Error("Valid lab credentials are required");
const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnTo: "/" }),
});
if (!login.ok) throw new Error(`Lab login failed (${login.status})`);
const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";", 1)[0]).join("; ");
const previews = [];
for (const [subject, expectedCount] of Object.entries(expected)) {
  const response = await fetch(`${baseUrl}/api/comment-pools/repair`, {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ subject, expectedCount, allowShared: true, apply: false }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${subject} dry-run failed (${response.status})`);
  previews.push(data);
}
const currentExpectedTotal = Object.values(expected).reduce((sum, count) => sum + count, 0);
if (previews.reduce((sum, item) => sum + Number(item.repairCount), 0) !== currentExpectedTotal || previews.some((item) => item.shared !== true)) {
  throw new Error("Shared-pool repair dry-run no longer matches the approved scope");
}
const results = [];
if (apply) {
  for (const [subject, expectedCount] of Object.entries(expected)) {
    const response = await fetch(`${baseUrl}/api/comment-pools/repair`, {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ subject, expectedCount, allowShared: true, apply: true }),
    });
    const data = await response.json();
    if (!response.ok || data.applied !== true || Number(data.retiredCount) !== expectedCount) {
      throw new Error(`${data.error || `${subject} repair failed (${response.status})`} [stage=${response.headers.get("x-pool-repair-stage") || "unknown"}]`);
    }
    results.push(data);
  }
}
process.stdout.write(`${JSON.stringify({
  mode: "approved-pool-repair", applied: apply, expectedTotal: 47,
  currentExpectedTotal,
  previews, results,
  retiredTotal: results.reduce((sum, item) => sum + Number(item.retiredCount), 0),
}, null, 2)}\n`);
