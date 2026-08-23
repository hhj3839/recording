import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { buildCommentPoolSpecs, validatePoolCandidate, type PoolPlanItem } from "../app/comment-pool-library.ts";

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const directory = path.resolve(".local-secrets");
const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
if (!files.length) throw new Error("Lab credential file is required");
const content = await readFile(path.join(directory, files.at(-1)!), "utf8");
const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
if (!email || !password || !email.endsWith("@giroksam.test")) throw new Error("Valid lab credentials are required");
const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnTo: "/" }),
});
if (!login.ok) throw new Error(`Lab login failed (${login.status})`);
const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";", 1)[0]).join("; ");
const get = async (route: string) => {
  const response = await fetch(`${baseUrl}${route}`, { headers: { Cookie: cookie }, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${route} failed (${response.status})`);
  return data;
};
const [planData, poolData] = await Promise.all([get("/api/assessment-plan"), get("/api/comment-pools")]);
const specs = buildCommentPoolSpecs(planData.plan as PoolPlanItem[]);
const byFingerprint = new Map(specs.map((spec) => [spec.fingerprint, spec]));
const missing = poolData.groups.filter((group: { approvedCount: number }) => Number(group.approvedCount) === 0)
  .map((group: { fingerprint: string; subject: string; unit: string; domain: string; level: string }) => {
    const spec = byFingerprint.get(group.fingerprint);
    if (!spec) throw new Error("Current pool fingerprint does not match the assessment plan");
    return {
      subject: group.subject, unit: group.unit, domain: group.domain, level: group.level,
      criterion: spec.criterion, canonicalSentence: spec.canonicalSentence,
      canonicalIssues: validatePoolCandidate(spec.canonicalSentence, spec).issues,
    };
  });
process.stdout.write(`${JSON.stringify({ mode: "missing-comment-pool-analysis", readOnly: true, missing }, null, 2)}\n`);
