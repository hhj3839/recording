import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const apply = process.env.APPLY_APPROVED_SIX_POOL_REPAIRS === "YES";
if (apply && process.env.APPROVE_SHARED_POOL_REPAIR !== "YES") throw new Error("Second shared-pool approval gate is required");
const baseUrl = "https://giroksam-recording.vercel.app";
const files = (await readdir(".local-secrets")).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
const content = await readFile(path.join(".local-secrets", files.at(-1)), "utf8");
const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
if (!email || !password || !email.endsWith("@giroksam.test")) throw new Error("Lab credentials are required");
const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
if (!login.ok) throw new Error(`Lab login failed (${login.status})`);
const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";", 1)[0]).join("; ");
const request = async (shouldApply) => {
  const response = await fetch(`${baseUrl}/api/comment-pools/manual-repair`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ expectedIds: [381, 453, 676, 982, 1047, 1048], allowShared: true, approvalCode: "APPROVE_SIX_2026_08_24", apply: shouldApply }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Manual repair failed (${response.status})`);
  return data;
};
const preview = await request(false);
if (preview.repairCount !== 6 || preview.shared !== true) throw new Error("Dry-run no longer matches the approved six shared sentences");
const result = apply ? await request(true) : null;
if (apply && (result.applied !== true || result.retiredCount !== 6)) throw new Error("The approved repair did not complete exactly six rows");
process.stdout.write(JSON.stringify({ mode: "approved-six-pool-repairs", applied: apply, preview, result }, null, 2) + "\n");
