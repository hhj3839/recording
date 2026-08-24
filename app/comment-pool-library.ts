import { createHash } from "node:crypto";
import { buildCanonicalCommentSentence, criterionSemanticIssues, evidenceBlockingIssues, evidenceGroundingWarnings, levelAppropriatenessIssues, positiveGrowthCriterion, repairSafeNominalEnding, validateGeneratedCommentPart } from "./comment-generation-policy.ts";

export const COMMENT_POOL_TARGET = 12;
export const COMMENT_POOL_MINIMUM = 8;
export const COMMENT_POOL_SIMILARITY_LIMIT = 0.9;
export const COMMENT_POOL_CLUSTER_THRESHOLD = 0.75;
export const COMMENT_POOL_CLUSTER_LIMIT = 2;
export const COMMENT_POOL_OPENING_LIMIT = 2;
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

const compactPoolSentence = (value: string) => normalizedPoolSentence(value).replace(/[^가-힣A-Za-z0-9]/g, "");

export function poolSentenceSimilarity(left: string, right: string) {
  const grams = (value: string) => {
    const compact = compactPoolSentence(value);
    if (compact.length < 3) return new Set(compact ? [compact] : []);
    return new Set(Array.from({ length: compact.length - 2 }, (_, index) => compact.slice(index, index + 3)));
  };
  const leftGrams = grams(left);
  const rightGrams = grams(right);
  const common = [...leftGrams].filter((gram) => rightGrams.has(gram)).length;
  const union = new Set([...leftGrams, ...rightGrams]).size;
  return union ? common / union : 0;
}

export function poolSentenceOpening(value: string) {
  return compactPoolSentence(value).slice(0, 15);
}

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
    .replace(/(?:모둠원과\s*)?협력(?:하여|해|하며)\s*/g, "")
    .replace(/(?:자신\s*있게|스스로|또박또박|또렷하게|또렷이|분명하게|분명히|자연스럽게|적절하게|적절히|간명하게|차근차근|적극적으로|효과적으로|꾸준히|자신의\s*말로)\s*/g, "")
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
  const validated: Array<{ text: string; index: number }> = [];
  const rejectedIssues = new Set<string>();
  for (const [index, candidate] of candidates.entries()) {
    const result = validatePoolCandidate(candidate, spec);
    if (result.issues.length) {
      result.issues.forEach((issue) => rejectedIssues.add(issue));
      continue;
    }
    const key = normalizedPoolSentence(result.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    validated.push({ text: result.text, index });
  }

  const approved: string[] = [];
  const references = [...existing];
  const openingCounts = new Map<string, number>();
  references.forEach((sentence) => {
    const opening = poolSentenceOpening(sentence);
    openingCounts.set(opening, (openingCounts.get(opening) ?? 0) + 1);
  });
  const remaining = [...validated];
  while (remaining.length && existing.length + approved.length < COMMENT_POOL_TARGET) {
    const ranked = remaining.map((candidate) => ({
      ...candidate,
      opening: poolSentenceOpening(candidate.text),
      similarity: references.reduce((highest, reference) => Math.max(highest, poolSentenceSimilarity(candidate.text, reference)), 0),
      clusterSize: references.filter((reference) => poolSentenceSimilarity(candidate.text, reference) >= COMMENT_POOL_CLUSTER_THRESHOLD).length,
    })).sort((left, right) =>
      left.clusterSize - right.clusterSize
      || (openingCounts.get(left.opening) ?? 0) - (openingCounts.get(right.opening) ?? 0)
      || left.similarity - right.similarity
      || left.index - right.index);
    const selected = ranked.find((candidate) =>
      candidate.similarity < COMMENT_POOL_SIMILARITY_LIMIT
      && candidate.clusterSize < COMMENT_POOL_CLUSTER_LIMIT
      && (openingCounts.get(candidate.opening) ?? 0) < COMMENT_POOL_OPENING_LIMIT);
    if (!selected) break;
    approved.push(selected.text);
    references.push(selected.text);
    openingCounts.set(selected.opening, (openingCounts.get(selected.opening) ?? 0) + 1);
    remaining.splice(remaining.findIndex((candidate) => candidate.index === selected.index), 1);
  }
  return { approved, rejectedIssues: [...rejectedIssues] };
}
