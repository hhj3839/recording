import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { buildCommentPoolSpecs, repairLegacyPoolCandidate, validatePoolCandidate, type PoolPlanItem } from "../app/comment-pool-library.ts";

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const directory = path.resolve(".local-secrets");
const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
const content = files.length ? await readFile(path.join(directory, files.at(-1)!), "utf8") : "";
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
const specByFingerprint = new Map(specs.map((spec) => [spec.fingerprint, spec]));
const specByScope = new Map(specs.map((spec) => [
  `${spec.subject}|${spec.unit}|${spec.domain}|${spec.level}`,
  spec,
]));
type PoolDetail = { sentences: Array<{ id: number; sentence: string }> };
const details: PoolDetail[] = [];
for (let index = 0; index < poolData.groups.length; index += 10) {
  const slice = poolData.groups.slice(index, index + 10);
  details.push(...await Promise.all(slice.map((group: { fingerprint: string }) =>
    get(`/api/comment-pools?fingerprint=${encodeURIComponent(group.fingerprint)}`))));
}
const issueCounts: Record<string, number> = {};
const unmatchedGroups: Array<{ fingerprint: string; subject: string; unit: string; domain: string; level: string }> = [];
const rows = poolData.groups.flatMap((group: { fingerprint: string; subject: string; unit: string; domain: string; level: string }, groupIndex: number) => {
  const spec = specByFingerprint.get(group.fingerprint)
    ?? specByScope.get(`${group.subject}|${group.unit}|${group.domain}|${group.level}`);
  if (!spec) {
    unmatchedGroups.push(group);
    return [];
  }
  return details[groupIndex].sentences.map((row: { id: number; sentence: string }) => {
    const issues = validatePoolCandidate(row.sentence, spec).issues;
    issues.forEach((issue) => { issueCounts[issue] = (issueCounts[issue] ?? 0) + 1; });
    return {
      id: Number(row.id), subject: group.subject, unit: group.unit, domain: group.domain, level: group.level,
      issues, repairable: issues.length > 0 && Boolean(repairLegacyPoolCandidate(row.sentence, spec)),
    };
  });
});
const subjects = [...new Set(rows.map((row: { subject: string }) => row.subject))];
const bySubject = Object.fromEntries(subjects.map((subject) => {
  const subjectRows = rows.filter((row: { subject: string }) => row.subject === subject);
  const passing = subjectRows.filter((row: { issues: string[] }) => row.issues.length === 0).length;
  return [subject, {
    approved: subjectRows.length, passing, failing: subjectRows.length - passing,
    passRate: subjectRows.length ? Math.round(passing / subjectRows.length * 10000) / 100 : 0,
    repairable: subjectRows.filter((row: { repairable: boolean }) => row.repairable).length,
    affectedPools: new Set(subjectRows.filter((row: { issues: string[] }) => row.issues.length)
      .map((row: { unit: string; domain: string; level: string }) => `${row.unit}|${row.domain}|${row.level}`)).size,
  }];
}));
const passing = rows.filter((row: { issues: string[] }) => row.issues.length === 0).length;
const affectedCriteria = [...new Map(rows.filter((row: { issues: string[] }) => row.issues.length).map((row: { subject: string; unit: string; domain: string; level: string }) => {
  const spec = specs.find((item) => item.subject === row.subject && item.unit === row.unit && item.domain === row.domain && item.level === row.level);
  const key = `${row.subject}|${row.unit}|${row.domain}|${row.level}`;
  return [key, { subject: row.subject, unit: row.unit, domain: row.domain, level: row.level, criterion: spec?.criterion ?? "", canonicalIssues: spec ? validatePoolCandidate(spec.canonicalSentence, spec).issues : [] }];
})).values()];
process.stdout.write(`${JSON.stringify({
  mode: "approved-comment-pool-audit", readOnly: true,
  pools: poolData.groups.length, currentPools: poolData.groups.length - unmatchedGroups.length,
  unmatchedPools: unmatchedGroups.length, unmatchedGroups,
  approved: rows.length, passing, failing: rows.length - passing,
  passRate: rows.length ? Math.round(passing / rows.length * 10000) / 100 : 0,
  repairable: rows.filter((row: { repairable: boolean }) => row.repairable).length,
  bySubject, issueCounts, affectedCriteria,
  failedIds: rows.filter((row: { issues: string[] }) => row.issues.length).map((row: { id: number; subject: string; unit: string; domain: string; level: string; issues: string[]; repairable: boolean }) => ({
    id: row.id, subject: row.subject, unit: row.unit, domain: row.domain, level: row.level, issues: row.issues, repairable: row.repairable,
  })),
}, null, 2)}\n`);
