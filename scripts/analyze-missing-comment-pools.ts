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
const plan = (planData.plan as Array<PoolPlanItem & { type?: string; sortOrder?: number }>).map((item) => ({
  ...item,
  assessment_type: item.assessment_type ?? item.type ?? "",
  sort_order: item.sort_order ?? item.sortOrder ?? 0,
}));
const specs = buildCommentPoolSpecs(plan);
const byFingerprint = new Map(specs.map((spec) => [spec.fingerprint, spec]));
const byScope = new Map(specs.map((spec) => [
  `${spec.subject}|${spec.unit}|${spec.domain}|${spec.level}`,
  spec,
]));
type MissingPool = {
  subject: string; unit: string; domain: string; level: string;
  criterion: string; canonicalSentence: string; canonicalIssues: string[];
};
type PoolGroup = { fingerprint: string; subject: string; unit: string; domain: string; level: string; approvedCount: number };
const unmatched: Array<{ fingerprint: string; subject: string; unit: string; domain: string; level: string }> = [];
const missingCandidates: Array<MissingPool | null> = (poolData.groups as PoolGroup[])
  .filter((group) => Number(group.approvedCount) === 0)
  .map((group): MissingPool | null => {
    const spec = byFingerprint.get(group.fingerprint)
      ?? byScope.get(`${group.subject}|${group.unit}|${group.domain}|${group.level}`);
    if (!spec) {
      unmatched.push(group);
      return null;
    }
    return {
      subject: group.subject, unit: group.unit, domain: group.domain, level: group.level,
      criterion: spec.criterion, canonicalSentence: spec.canonicalSentence,
      canonicalIssues: validatePoolCandidate(spec.canonicalSentence, spec).issues,
    };
  });
const missing = missingCandidates.filter((row): row is MissingPool => row !== null);
process.stdout.write(`${JSON.stringify({
  mode: "missing-comment-pool-analysis", readOnly: true,
  summary: poolData.summary,
  missingCount: missing.length,
  missing,
  unmatchedCount: unmatched.length,
  unmatched,
}, null, 2)}\n`);
