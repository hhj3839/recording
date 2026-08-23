import { createHash } from "node:crypto";
import { buildCanonicalCommentSentence, criterionSemanticIssues, evidenceBlockingIssues, evidenceGroundingWarnings, levelAppropriatenessIssues, positiveGrowthCriterion, repairSafeNominalEnding, validateGeneratedCommentPart } from "./comment-generation-policy.ts";

export const COMMENT_POOL_TARGET = 20;
export const COMMENT_POOL_GENERATOR_VERSION = "pool-v1";
export type PoolLevel = "상" | "중" | "하";

export type PoolPlanItem = {
  id: number;
  subject: string;
  unit: string;
  goal: string;
  domain: string;
  perspective: string;
  high: string;
  middle: string;
  low: string;
  sort_order?: number;
};

export type CommentPoolSpec = {
  fingerprint: string;
  assessmentPlanId: number;
  assessmentIndex: number;
  subject: string;
  unit: string;
  goal: string;
  domain: string;
  perspective: string;
  level: PoolLevel;
  criterion: string;
  levelCriteria: { high: string; middle: string; low: string };
  canonicalSentence: string;
};

const stable = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
export const normalizedPoolSentence = (value: string) => stable(value).replace(/[.!?。！？]+$/g, "");

export function poolFingerprint(input: Omit<CommentPoolSpec, "fingerprint" | "assessmentPlanId" | "assessmentIndex" | "canonicalSentence">) {
  return createHash("sha256").update(JSON.stringify([
    COMMENT_POOL_GENERATOR_VERSION,
    stable(input.subject), stable(input.unit), stable(input.goal), stable(input.domain), stable(input.perspective), input.level,
    stable(input.criterion), stable(input.levelCriteria.high), stable(input.levelCriteria.middle), stable(input.levelCriteria.low),
  ])).digest("hex");
}

export function buildCommentPoolSpecs(plan: PoolPlanItem[]): CommentPoolSpec[] {
  return [...plan].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)).flatMap((item, assessmentIndex) => {
    const levelCriteria = { high: stable(item.high), middle: stable(item.middle), low: stable(item.low) };
    return ([
      ["상", levelCriteria.high], ["중", levelCriteria.middle], ["하", levelCriteria.low],
    ] as const).flatMap(([level, rawCriterion]) => {
      const criterion = positiveGrowthCriterion(level, rawCriterion);
      if (!criterion) return [];
      const base = {
        subject: stable(item.subject), unit: stable(item.unit), goal: stable(item.goal), domain: stable(item.domain), perspective: stable(item.perspective), level,
        criterion, levelCriteria,
      };
      return [{
        ...base,
        fingerprint: poolFingerprint(base),
        assessmentPlanId: Number(item.id),
        assessmentIndex,
        canonicalSentence: buildCanonicalCommentSentence(criterion),
      }];
    });
  });
}

export function validatePoolCandidate(candidate: string, spec: CommentPoolSpec) {
  const text = repairSafeNominalEnding(candidate);
  const evidence = `${spec.unit} | ${spec.domain} | 수준: ${spec.level} | 기준: ${spec.criterion}`;
  const issues = [
    ...(!validateGeneratedCommentPart(text, spec.criterion).valid ? ["문장 형식 또는 명사형 종결 검수 미통과"] : []),
    ...levelAppropriatenessIssues(text, spec.level, spec.criterion),
    ...evidenceBlockingIssues(text, `${evidence} | 생성용 기준: ${spec.criterion}`, spec.criterion),
    ...evidenceGroundingWarnings(text, spec.criterion).map((issue) => issue.replace(/ 확인 필요$/, "")),
    ...criterionSemanticIssues(text, spec.criterion, spec.levelCriteria),
  ];
  return { text, issues: [...new Set(issues)] };
}

export function repairLegacyPoolCandidate(candidate: string, spec: CommentPoolSpec) {
  const original = validatePoolCandidate(candidate, spec);
  if (!original.issues.length) return null;
  const repaired = repairSafeNominalEnding(candidate)
    .replace(/(?:자신\s*있게|스스로|또박또박|또렷하게|또렷이|분명하게|분명히|자연스럽게|적절하게|적절히|간명하게|차근차근|자신의\s*말로)\s*/g, "")
    .replace(/썼음\.$/, "씀.")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!repaired || normalizedPoolSentence(repaired) === normalizedPoolSentence(candidate)) return null;
  const result = validatePoolCandidate(repaired, spec);
  return result.issues.length ? null : { original: candidate, repaired: result.text, originalIssues: original.issues };
}

export function approvePoolCandidates(candidates: string[], spec: CommentPoolSpec, existing: string[] = []) {
  const seen = new Set(existing.map(normalizedPoolSentence));
  const approved: string[] = [];
  const rejectedIssues = new Set<string>();
  for (const candidate of candidates) {
    const result = validatePoolCandidate(candidate, spec);
    if (result.issues.length) {
      result.issues.forEach((issue) => rejectedIssues.add(issue));
      continue;
    }
    const key = normalizedPoolSentence(result.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    approved.push(result.text);
    if (existing.length + approved.length >= COMMENT_POOL_TARGET) break;
  }
  return { approved, rejectedIssues: [...rejectedIssues] };
}
