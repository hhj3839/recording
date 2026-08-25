import { createHash } from "node:crypto";
import { buildCanonicalCommentSentence, criterionSemanticIssues, evidenceBlockingIssues, evidenceGroundingWarnings, levelAppropriatenessIssues, positiveGrowthCriterion, repairSafeNominalEnding, validateGeneratedCommentPart } from "./comment-generation-policy.ts";

export const COMMENT_POOL_TARGET = 12;
export const COMMENT_POOL_MINIMUM = 8;
export const COMMENT_POOL_SIMILARITY_LIMIT = 0.9;
export const COMMENT_POOL_CLUSTER_THRESHOLD = 0.75;
export const COMMENT_POOL_CLUSTER_LIMIT = 2;
export const COMMENT_POOL_OPENING_LIMIT = 2;
export const COMMENT_POOL_REUSE_MINIMUM_OPENING_RATIO = 0.5;
export const COMMENT_POOL_REUSE_MAX_CLUSTER_RATIO = 0.2;
export const COMMENT_POOL_REUSE_MAX_NEAREST_SIMILARITY = 0.82;
export const COMMENT_POOL_GENERATOR_VERSION = "pool-v2-quality-gated";
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
    ...(unique.length < COMMENT_POOL_MINIMUM ? ["승인 문장 수 부족"] : []),
    ...(unique.length !== normalized.length ? ["완전히 같은 승인 문장 중복"] : []),
    ...(openingRatio < COMMENT_POOL_REUSE_MINIMUM_OPENING_RATIO ? ["문장 첫머리 다양성 부족"] : []),
    ...(clusterRatio > COMMENT_POOL_REUSE_MAX_CLUSTER_RATIO ? ["유사 문장 군집 과다"] : []),
    ...(averageNearestSimilarity > COMMENT_POOL_REUSE_MAX_NEAREST_SIMILARITY ? ["문장 구조 다양성 부족"] : []),
    ...(minimumAverageLength > 0 && averageLength < minimumAverageLength ? ["평가기준 정보량 보존 부족"] : []),
  ];
  return {
    reusable: issues.length === 0,
    issues,
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
  // 활동·관찰 장면은 평가계획 전체에서 근거를 찾되, 수행 수준과 필수
  // 성취는 선택 수준 평가기준에만 묶어 다른 수준의 의미 유입을 막는다.
  const planEvidence = [
    `단원: ${spec.unit}`,
    `영역: ${spec.domain}`,
    `평가목표: ${spec.goal}`,
    `평가관점: ${spec.perspective}`,
    `평가유형: ${spec.assessmentType ?? ""}`,
    `평가상의 유의점: ${spec.caution ?? ""}`,
    `선택 수준 기준: ${spec.criterion}`,
  ].filter(Boolean).join(" | ");
  const allowedActivityEvidence = [spec.perspective, spec.caution ?? ""].filter(Boolean).join(" | ");
  const format = validateGeneratedCommentPart(text, spec.criterion);
  const structuralFormatValid = format.sentenceCountOk && format.endingsOk && format.naturalEndingsOk
    && format.predicateIssues.length === 0 && format.forbidden.length === 0;
  const issues = [
    ...(!structuralFormatValid ? ["문장 형식 또는 명사형 종결 검수 미통과"] : []),
    ...levelAppropriatenessIssues(text, spec.level, spec.criterion),
    ...evidenceBlockingIssues(text, planEvidence, spec.criterion, allowedActivityEvidence),
    ...evidenceGroundingWarnings(text, planEvidence).map((issue) => issue.replace(/ 확인 필요$/, "")),
    ...criterionSemanticIssues(text, spec.criterion, spec.levelCriteria),
  ];
  const qualityWarnings = [
    ...(format.lengths[0] < 50 || format.lengths[0] > 80 ? ["권장 길이 50~80자 이탈"] : []),
  ];
  return { text, issues: [...new Set(issues)], qualityWarnings, qualityScore: poolCandidateQualityScore(text, spec) };
}

export function poolCandidateQualityScore(candidate: string, spec: CommentPoolSpec) {
  const text = repairSafeNominalEnding(candidate);
  const length = Array.from(normalizedPoolSentence(text)).length;
  const lengthScore = length >= 50 && length <= 80
    ? 30
    : Math.max(0, 30 - Math.min(Math.abs(length - 50), Math.abs(length - 80)) * 2);
  const evidenceText = `${spec.goal} ${spec.perspective} ${spec.caution ?? ""}`.normalize("NFKC");
  const groundedActivityWords = ["관찰", "조사", "토의", "발표", "역할", "그림", "실험", "만들", "표현", "설명", "정리", "비교", "분류"]
    .filter((word) => evidenceText.includes(word) && text.includes(word)).length;
  const connectiveVariety = new Set(text.match(/(?:하며|하여|하고|뒤|후|통해|바탕으로|살펴|활용해)/g) ?? []).size;
  return lengthScore + Math.min(30, groundedActivityWords * 10) + Math.min(10, connectiveVariety * 5);
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
      qualityScore: poolCandidateQualityScore(candidate.text, spec),
      similarity: references.reduce((highest, reference) => Math.max(highest, poolSentenceSimilarity(candidate.text, reference)), 0),
      clusterSize: references.filter((reference) => poolSentenceSimilarity(candidate.text, reference) >= COMMENT_POOL_CLUSTER_THRESHOLD).length,
    })).sort((left, right) =>
      left.clusterSize - right.clusterSize
      || (openingCounts.get(left.opening) ?? 0) - (openingCounts.get(right.opening) ?? 0)
      || right.qualityScore - left.qualityScore
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
