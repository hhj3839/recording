import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  criterionSemanticIssues,
  evidenceBlockingIssues,
  levelAppropriatenessIssues,
  positiveGrowthCriterion,
  validateGeneratedCommentPart,
} from "../app/comment-generation-policy.ts";

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");

async function credentials() {
  if (process.env.LOAD_TEST_EMAIL && process.env.LOAD_TEST_PASSWORD) {
    return { email: process.env.LOAD_TEST_EMAIL, password: process.env.LOAD_TEST_PASSWORD };
  }
  const directory = path.resolve(".local-secrets");
  const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
  if (!files.length) throw new Error("Lab credential file is required");
  const content = await readFile(path.join(directory, files.at(-1)!), "utf8");
  const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
  const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
  if (!email || !password) throw new Error("Lab credential file is invalid");
  return { email, password };
}

const account = await credentials();
const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...account, returnTo: "/" }),
});
if (!login.ok) throw new Error(`Lab login failed (${login.status})`);
const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";", 1)[0]).join("; ");
const get = async (route: string) => {
  const response = await fetch(`${baseUrl}${route}`, { headers: { Cookie: cookie }, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${route} failed (${response.status})`);
  return data;
};

const [classData, planData, generatedData, poolData] = await Promise.all([
  get("/api/class-data"), get("/api/assessment-plan"), get("/api/generated-comments"), get("/api/comment-pools"),
]);
const subjects = [...new Set<string>(planData.plan.map((item: { subject: string }) => item.subject))];
const plans = new Map(subjects.map((subject) => [subject, planData.plan.filter((item: { subject: string }) => item.subject === subject)]));
const levels = new Map<string, string>(classData.levels.map((item: { studentId: number; subject: string; assessmentIndex: number; level: string }) => [
  `${item.studentId}|${item.subject}|${item.assessmentIndex}`, String(item.level),
] as [string, string]));
const rows = generatedData.parts.map((part: { studentId: number; subject: string; assessmentIndex: number; sentence: string }) => {
  const item = plans.get(part.subject)?.[part.assessmentIndex];
  const level = levels.get(`${part.studentId}|${part.subject}|${part.assessmentIndex}`);
  const rawCriterion = level === "상" ? item?.high : level === "중" ? item?.middle : level === "하" ? item?.low : "";
  const criterion = positiveGrowthCriterion(level, rawCriterion ?? "");
  const levelCriteria = { high: item?.high ?? "", middle: item?.middle ?? "", low: item?.low ?? "" };
  const issues = [
    ...(!validateGeneratedCommentPart(part.sentence, criterion).valid ? ["형식·명사형"] : []),
    ...levelAppropriatenessIssues(part.sentence, level, criterion),
    ...evidenceBlockingIssues(part.sentence, criterion, criterion),
    ...criterionSemanticIssues(part.sentence, criterion, levelCriteria),
  ];
  return { ...part, level, issues: [...new Set(issues)] };
});
const normalized = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").replace(/[.!?。！？]/g, "");
const bySubject = Object.fromEntries(subjects.map((subject) => {
  const subjectRows = rows.filter((row: { subject: string }) => row.subject === subject);
  const pass = subjectRows.filter((row: { issues: string[] }) => row.issues.length === 0).length;
  const frequencies = new Map<string, number>();
  for (const row of subjectRows) {
    const key = `${row.assessmentIndex}|${row.level}|${normalized(row.sentence)}`;
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  }
  const duplicateParts = subjectRows.filter((row: { assessmentIndex: number; level: string; sentence: string }) =>
    (frequencies.get(`${row.assessmentIndex}|${row.level}|${normalized(row.sentence)}`) ?? 0) > 1).length;
  return [subject, {
    parts: subjectRows.length, pass,
    passRate: subjectRows.length ? Math.round(pass / subjectRows.length * 10000) / 100 : 0,
    duplicateParts,
  }];
}));
const issueCounts: Record<string, number> = {};
for (const row of rows) for (const issue of row.issues) issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
const pass = rows.filter((row: { issues: string[] }) => row.issues.length === 0).length;
const poolBySubject = Object.fromEntries(subjects.map((subject) => {
  const groups = poolData.groups.filter((group: { subject: string }) => group.subject === subject);
  return [subject, {
    groups: groups.length,
    usable: groups.filter((group: { approvedCount: number }) => Number(group.approvedCount) > 0).length,
    ready: groups.filter((group: { approvedCount: number; targetCount: number }) => Number(group.approvedCount) >= Number(group.targetCount)).length,
    approvedSentences: groups.reduce((sum: number, group: { approvedCount: number }) => sum + Number(group.approvedCount), 0),
  }];
}));
const unavailablePools = poolData.groups
  .filter((group: { approvedCount: number }) => Number(group.approvedCount) === 0)
  .map((group: { subject: string; assessmentIndex: number; unit: string; domain: string; level: string }) => ({
    subject: group.subject,
    assessmentIndex: Number(group.assessmentIndex),
    unit: group.unit,
    domain: group.domain,
    level: group.level,
  }));
const includeSamples = process.env.AUDIT_INCLUDE_SAMPLES === "YES";
process.stdout.write(`${JSON.stringify({
  mode: "stored-comment-parts-audit", readOnly: true,
  students: classData.students.length, subjects: subjects.length, parts: rows.length,
  pass, passRate: rows.length ? Math.round(pass / rows.length * 10000) / 100 : 0,
  bySubject, poolBySubject, unavailablePools, issueCounts,
  failedSamples: !includeSamples ? undefined : rows.filter((row: { issues: string[] }) => row.issues.length).slice(0, 20)
    .map((row: { studentId: number; subject: string; assessmentIndex: number; level: string; issues: string[] }) => ({
      studentId: row.studentId, subject: row.subject, assessmentIndex: row.assessmentIndex, level: row.level, issues: row.issues,
    })),
}, null, 2)}\n`);
