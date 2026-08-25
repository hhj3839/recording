import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  buildCommentPoolSpecs,
  commentPoolQuality,
  poolSentenceSimilarity,
  validatePoolCandidate,
  type PoolPlanItem,
} from "../app/comment-pool-library.ts";

if (process.env.RUN_APPROVED_SINGLE_POOL_QUALITY_GATE !== "YES") {
  throw new Error("RUN_APPROVED_SINGLE_POOL_QUALITY_GATE=YES explicit approval is required");
}

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");
const approvedSubject = (process.env.APPROVED_POOL_SUBJECT || "국어").trim();
const approvedUnit = (process.env.APPROVED_POOL_UNIT || "").trim();
const approvedDomain = (process.env.APPROVED_POOL_DOMAIN || "").trim();
const approvedLevel = (process.env.APPROVED_POOL_LEVEL || "").trim();
const preflightOnly = process.env.APPROVED_POOL_PREFLIGHT_ONLY === "YES";
if (!new Set(["국어", "수학"]).has(approvedSubject)) {
  throw new Error("Only an explicitly approved Korean or mathematics pool may be tested");
}
const directory = path.resolve(".local-secrets");
const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
const content = files.length ? await readFile(path.join(directory, files.at(-1)!), "utf8") : "";
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
const request = async (route: string, options: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { Cookie: cookie, ...(options.headers ?? {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${route} failed (${response.status})`);
  return data;
};

const [planData, poolsBefore, usageBefore] = await Promise.all([
  request("/api/assessment-plan"),
  request("/api/comment-pools"),
  request("/api/usage"),
]);
const plan = (planData.plan as Array<PoolPlanItem & { type?: string; sortOrder?: number }>).map((item) => ({
  ...item,
  assessment_type: item.assessment_type ?? item.type ?? "",
  sort_order: item.sort_order ?? item.sortOrder ?? 0,
}));
const specs = buildCommentPoolSpecs(plan);
const subjectSpecs = specs.filter((spec) => spec.subject === approvedSubject);
if (preflightOnly) {
  process.stdout.write(`${JSON.stringify({
    mode: "approved-single-pool-quality-preflight",
    labOnly: true,
    subject: approvedSubject,
    scopes: subjectSpecs.map((spec) => ({
      unit: spec.unit,
      domain: spec.domain,
      level: spec.level,
      criterion: spec.criterion,
      existingPool: poolsBefore.groups.some((group: { fingerprint: string; poolVersionId?: number | null }) =>
        group.fingerprint === spec.fingerprint && group.poolVersionId != null && Number.isInteger(Number(group.poolVersionId))),
    })),
  }, null, 2)}\n`);
  process.exit(0);
}
if (!approvedUnit || !approvedDomain || !approvedLevel) {
  throw new Error("APPROVED_POOL_UNIT, APPROVED_POOL_DOMAIN, and APPROVED_POOL_LEVEL are required");
}
const targets = subjectSpecs.filter((spec) => spec.unit === approvedUnit
  && spec.domain === approvedDomain
  && spec.level === approvedLevel);
if (targets.length !== 1) throw new Error(`The exact approved pool scope was not found uniquely (${targets.length})`);
const target = targets[0];

const scopeMatches = (group: { subject: string; unit: string; domain: string; level: string }) =>
  group.subject === target.subject && group.unit === target.unit && group.domain === target.domain && group.level === target.level;
const previousGroups = poolsBefore.groups.filter(scopeMatches);
const startedAt = Date.now();
const started = await request("/api/comment-pools", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    subject: target.subject,
    maxGroups: 1,
    labOnly: true,
    targetFingerprints: [target.fingerprint],
    refresh: true,
  }),
});
if (!started.jobId) throw new Error("The bounded single-pool job did not start");
if (Number(started.total) !== 1 || Number(started.maxAiCalls) > 2) {
  throw new Error(`Approved scope exceeded: groups=${started.total}, maxAiCalls=${started.maxAiCalls}`);
}

let jobState;
for (let attempt = 0; attempt < 120; attempt += 1) {
  jobState = await request(`/api/comment-pools?jobId=${encodeURIComponent(started.jobId)}`);
  if (["completed", "completed_with_errors", "failed"].includes(jobState.job.status)) break;
  if (attempt === 119) throw new Error("The bounded single-pool job timed out");
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

const [poolsAfter, usageAfter, generatedVersionAudit] = await Promise.all([
  request("/api/comment-pools"),
  request("/api/usage"),
  request(`/api/comment-pools?jobId=${encodeURIComponent(started.jobId)}&audit=1`),
]);
const currentGroup = poolsAfter.groups.find((group: { fingerprint: string }) => group.fingerprint === target.fingerprint);
const detail = currentGroup
  ? await request(`/api/comment-pools?fingerprint=${encodeURIComponent(target.fingerprint)}`)
  : { sentences: [] };
const sentences = (detail.sentences ?? []).map((row: { sentence: string }) => row.sentence);
const validations = sentences.map((sentence: string) => validatePoolCandidate(sentence, target));
const similarities = sentences.flatMap((sentence: string, index: number) =>
  sentences.slice(index + 1).map((other: string) => poolSentenceSimilarity(sentence, other)));
const calls = Number(usageAfter.monthly) - Number(usageBefore.monthly);
if (calls > 2) throw new Error(`Approved maximum exceeded: ${calls}/2 calls`);
const activated = jobState?.job?.status === "completed";

process.stdout.write(`${JSON.stringify({
  mode: "approved-single-pool-quality-gate",
  labOnly: true,
  scope: { subject: target.subject, unit: target.unit, domain: target.domain, level: target.level },
  preservedPreviousPoolVersions: previousGroups.map((group: { poolVersionId?: number }) => group.poolVersionId).filter(Boolean),
  job: { id: started.jobId, status: jobState?.job?.status, activated, error: jobState?.job?.error ?? "" },
  elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
  usage: {
    calls,
    inputTokens: Number(usageAfter.tokens?.input) - Number(usageBefore.tokens?.input),
    cachedInputTokens: Number(usageAfter.tokens?.cachedInput) - Number(usageBefore.tokens?.cachedInput),
    outputTokens: Number(usageAfter.tokens?.output) - Number(usageBefore.tokens?.output),
    totalTokens: Number(usageAfter.tokens?.total) - Number(usageBefore.tokens?.total),
    estimatedCostUsd: Math.round((Number(usageAfter.estimatedCostUsd) - Number(usageBefore.estimatedCostUsd)) * 1_000_000) / 1_000_000,
  },
  activePoolSource: activated ? "newly_generated" : "retained_previous",
  generatedVersionAudit: generatedVersionAudit.audit ?? [],
  activePoolQuality: commentPoolQuality(sentences, target.canonicalSentence),
  activePoolGrounding: {
    passing: validations.filter((result: { issues: string[] }) => result.issues.length === 0).length,
    failing: validations.filter((result: { issues: string[] }) => result.issues.length > 0).length,
    issues: [...new Set(validations.flatMap((result: { issues: string[] }) => result.issues))],
  },
  activePoolSimilarity: {
    maximum: similarities.length ? Math.max(...similarities) : 0,
    average: similarities.length ? similarities.reduce((sum: number, value: number) => sum + value, 0) / similarities.length : 0,
  },
  activePoolSentences: sentences,
}, null, 2)}\n`);
