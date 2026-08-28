import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const apply = process.env.APPLY_APPROVED_FINAL_POOL === "YES";
const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const directory = path.resolve(".local-secrets");
const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
const content = files.length ? await readFile(path.join(directory, files.at(-1)), "utf8") : "";
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
const response = await fetch(`${baseUrl}/api/comment-pools/complete-last-pool`, {
  method: "POST",
  headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({
    jobId: "4613781b-cbae-4e08-a79f-cfbebec8f1bb",
    expectedApprovedCount: 4,
    approvalCode: "COMPLETE_LAST_POOL_2026_08_28",
    apply,
  }),
});
const data = await response.json();
if (!response.ok) throw new Error(`${data.error || `Final pool completion failed (${response.status})`}${Array.isArray(data.issues) ? `: ${data.issues.join(" / ")}` : ""}`);
process.stdout.write(`${JSON.stringify({ mode: "approved-final-pool-completion", ...data }, null, 2)}\n`);
