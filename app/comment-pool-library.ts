import { createHash } from "node:crypto";
import { buildCanonicalCommentSentence, criterionToSafeNominalCandidates, hasNaturalNominalEnding, positiveGrowthCriterion, repairSafeNominalEnding } from "./comment-generation-policy.ts";

export const COMMENT_POOL_TARGET = 20;
export const COMMENT_POOL_MINIMUM = 5;
export const COMMENT_POOL_SIMILARITY_LIMIT = 0.9;
export const COMMENT_POOL_CLUSTER_THRESHOLD = 0.75;
export const COMMENT_POOL_CLUSTER_LIMIT = 2;
export const COMMENT_POOL_REUSE_MINIMUM_OPENING_RATIO = 0.5;
export const COMMENT_POOL_REUSE_MAX_CLUSTER_RATIO = 0.2;
export const COMMENT_POOL_REUSE_MAX_NEAREST_SIMILARITY = 0.82;
export const COMMENT_POOL_GENERATOR_VERSION = "pool-v2-quality-gated";
export const COMMENT_POOL_SHORT_CRITERION_LENGTH = 38;
export type PoolLevel = "상" | "중" | "하";

export type PoolPlanItem = {
  id: number;
  subject: string;
  unit: string;
  goal: string;
  domain: string;
  assessment_type?: string;
  perspective: string;
  high: string;
  middle: string;
  low: string;
  caution?: string;
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
  assessmentType?: string;
  perspective: string;
  level: PoolLevel;
  criterion: string;
  levelCriteria: { high: string; middle: string; low: string };
  caution?: string;
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

export function commentPoolQuality(sentences: string[], referenceSentence = "") {
  const normalized = sentences.map(normalizedPoolSentence).filter(Boolean);
  const unique = [...new Set(normalized)];
  const pairSimilarities: number[] = [];
  const nearest = unique.map((sentence, index) => {
    let highest = 0;
    unique.forEach((other, otherIndex) => {
      if (index === otherIndex) return;
      const similarity = poolSentenceSimilarity(sentence, other);
      pairSimilarities.push(index < otherIndex ? similarity : -1);
      highest = Math.max(highest, similarity);
    });
    return highest;
  });
  const comparablePairs = pairSimilarities.filter((value) => value >= 0);
  const clusteredPairs = comparablePairs.filter((value) => value >= COMMENT_POOL_CLUSTER_THRESHOLD).length;
  const openingCount = new Set(unique.map(poolSentenceOpening)).size;
  const openingRatio = unique.length ? openingCount / unique.length : 0;
  const clusterRatio = comparablePairs.length ? clusteredPairs / comparablePairs.length : 0;
  const averageNearestSimilarity = nearest.length
    ? nearest.reduce((sum, value) => sum + value, 0) / nearest.length
    : 0;
  const averageLength = normalized.length
    ? normalized.reduce((sum, sentence) => sum + sentence.length, 0) / normalized.length
    : 0;
  const referenceLength = normalizedPoolSentence(referenceSentence).length;
  const minimumAverageLength = referenceLength >= 50 ? Math.max(45, referenceLength * 0.8) : 0;
  const issues = [
    ...(unique.length < COMMENT_POOL_MINIMUM ? ["안전 검수 통과 문장 수 부족"] : []),
  ];
  const warnings = [
    ...(unique.length !== normalized.length ? ["완전히 같은 승인 문장 중복"] : []),
    ...(openingRatio < COMMENT_POOL_REUSE_MINIMUM_OPENING_RATIO ? ["문장 첫머리 다양성 부족"] : []),
    ...(clusterRatio > COMMENT_POOL_REUSE_MAX_CLUSTER_RATIO ? ["유사 문장 군집 과다"] : []),
    ...(averageNearestSimilarity > COMMENT_POOL_REUSE_MAX_NEAREST_SIMILARITY ? ["문장 구조 다양성 부족"] : []),
    ...(minimumAverageLength > 0 && averageLength < minimumAverageLength ? ["평가기준 정보량 보존 부족"] : []),
  ];
  return {
    reusable: issues.length === 0,
    issues,
    warnings,
    count: normalized.length,
    uniqueCount: unique.length,
    openingCount,
    openingRatio,
    clusteredPairs,
    totalPairs: comparablePairs.length,
    clusterRatio,
    averageNearestSimilarity,
    averageLength,
    referenceLength,
    minimumAverageLength,
  };
}

export function commentPoolIsComplete(sentences: string[], referenceSentence = "") {
  const quality = commentPoolQuality(sentences, referenceSentence);
  return quality.reusable && quality.uniqueCount >= COMMENT_POOL_TARGET;
}

export function poolFingerprint(input: Omit<CommentPoolSpec, "fingerprint" | "assessmentPlanId" | "assessmentIndex" | "canonicalSentence">) {
  return createHash("sha256").update(JSON.stringify([
    COMMENT_POOL_GENERATOR_VERSION,
    stable(input.subject), stable(input.unit), stable(input.goal), stable(input.domain), stable(input.assessmentType ?? ""), stable(input.perspective), input.level,
    stable(input.criterion), stable(input.levelCriteria.high), stable(input.levelCriteria.middle), stable(input.levelCriteria.low),
    stable(input.caution ?? ""),
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
        subject: stable(item.subject), unit: stable(item.unit), goal: stable(item.goal), domain: stable(item.domain),
        assessmentType: stable(item.assessment_type ?? ""), perspective: stable(item.perspective), level,
        criterion, levelCriteria, caution: stable(item.caution ?? ""),
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
  const issues = hasNaturalNominalEnding(text) ? [] : ["자연스러운 명사형 종결 검수 미통과"];
  return { text, issues, qualityWarnings: [], qualityScore: poolCandidateQualityScore(text, spec) };
}

export function poolCandidateQualityScore(candidate: string, spec: CommentPoolSpec) {
  const text = repairSafeNominalEnding(candidate);
  const length = Array.from(normalizedPoolSentence(text)).length;
  const referenceLength = Array.from(normalizedPoolSentence(spec.canonicalSentence)).length;
  const shortCriterion = referenceLength < COMMENT_POOL_SHORT_CRITERION_LENGTH;
  const minimumLength = shortCriterion ? Math.max(18, referenceLength - 2) : 50;
  const maximumLength = shortCriterion ? Math.min(45, Math.max(32, referenceLength + 18)) : 80;
  const lengthScore = length >= minimumLength && length <= maximumLength
    ? 30
    : Math.max(0, 30 - Math.min(Math.abs(length - minimumLength), Math.abs(length - maximumLength)) * (shortCriterion ? 1.5 : 2));
  const evidenceText = `${spec.goal} ${spec.perspective} ${spec.caution ?? ""}`.normalize("NFKC");
  const groundedActivityWords = ["관찰", "조사", "토의", "발표", "역할", "그림", "실험", "만들", "표현", "설명", "정리", "비교", "분류"]
    .filter((word) => evidenceText.includes(word) && text.includes(word)).length;
  const connectiveVariety = new Set(text.match(/(?:하며|하여|하고|뒤|후|통해|바탕으로|살펴|활용해)/g) ?? []).size;
  const activityScore = shortCriterion
    ? Math.min(54, groundedActivityWords * 18)
    : Math.min(30, groundedActivityWords * 10);
  const connectiveScore = Math.min(shortCriterion ? 5 : 10, connectiveVariety * 5);
  const canonicalBonus = normalizedPoolSentence(text) === normalizedPoolSentence(spec.canonicalSentence) ? 10 : 0;
  return lengthScore + activityScore + connectiveScore + canonicalBonus;
}

export function commentPoolSelectionTarget(spec: CommentPoolSpec) {
  void spec;
  return COMMENT_POOL_TARGET;
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
  const selectionTarget = commentPoolSelectionTarget(spec);
  const seen = new Set(existing.map(normalizedPoolSentence));
  const approved: string[] = [];
  const rejectedIssues = new Set<string>();
  for (const candidate of candidates) {
    if (existing.length + approved.length >= selectionTarget) break;
    const result = validatePoolCandidate(candidate, spec);
    if (result.issues.length) {
      result.issues.forEach((issue) => rejectedIssues.add(issue));
      continue;
    }
    const key = normalizedPoolSentence(result.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    approved.push(result.text);
  }
  return { approved, rejectedIssues: [...rejectedIssues] };
}

function groundedFreeVariantCandidates(spec: CommentPoolSpec) {
  const seeds = [spec.canonicalSentence, ...criterionToSafeNominalCandidates(spec.criterion)]
    .map((sentence) => repairSafeNominalEnding(sentence))
    .filter(Boolean);
  const variants = [...seeds];
  const addSingleReplacements = (sentence: string) => {
    const replacements: Array<[RegExp, string]> = [
      [/하여/, "해"],
      [/한\s+뒤/, "한 후"],
      [/한\s+후/, "한 뒤"],
      [/알고,\s*/, "알고 있으며, "],
      [/알고,\s*/, "알고 이를 바탕으로 "],
      [/알고,\s*/, "알고 있으며 이를 바탕으로 "],
      [/하고,\s*/, "하며, "],
      [/하며,\s*/, "하고, "],
    ];
    replacements.forEach(([pattern, replacement]) => {
      if (pattern.test(sentence)) variants.push(sentence.replace(pattern, replacement));
    });
    // 쉼표 유무는 의미를 바꾸지 않는 최후의 무료 보완 수단이다. 의미를
    // 새로 만들어 내는 수식어나 활동을 덧붙이지 않는다.
    const commaIndexes = [...sentence.matchAll(/,\s*/g)].map((match) => match.index).filter((index): index is number => index !== undefined);
    commaIndexes.forEach((index) => variants.push(`${sentence.slice(0, index)} ${sentence.slice(index + 1).trimStart()}`));
  };
  seeds.forEach(addSingleReplacements);
  return [...new Set(variants.map((sentence) => sentence.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

/**
 * AI 후보가 안전 검수에서 과도하게 탈락했을 때 평가기준에서 직접 만든
 * 문장만 보수적으로 변형한다. 새로운 사실·수준 표현은 추가하지 않으며,
 * 전체 검수기를 다시 통과한 문장만 최소 재사용 수량까지 반환한다.
 */
export function buildValidatedMinimumPoolFallbacks(spec: CommentPoolSpec, existing: string[] = []) {
  const seen = new Set(existing.map(normalizedPoolSentence));
  const approved: string[] = [];
  for (const candidate of groundedFreeVariantCandidates(spec)) {
    if (seen.size >= COMMENT_POOL_MINIMUM) break;
    const result = validatePoolCandidate(candidate, spec);
    const key = normalizedPoolSentence(result.text);
    if (result.issues.length || !key || seen.has(key)) continue;
    seen.add(key);
    approved.push(result.text);
  }
  return approved;
}
