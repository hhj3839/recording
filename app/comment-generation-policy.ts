export function hasCompleteEvidenceCoverage(expectedIds: string[], coveredIds: unknown) {
  if (!Array.isArray(coveredIds)) return false;
  const normalized = coveredIds.filter((id): id is string => typeof id === "string");
  const covered = new Set(normalized);
  return expectedIds.length > 0
    && normalized.length === coveredIds.length
    && covered.size === normalized.length
    && covered.size === expectedIds.length
    && expectedIds.every((id) => covered.has(id));
}

export const commentForbiddenExpressions = [
  "부족함",
  "미흡함",
  "못함",
  "어려워함",
  "이해하지 못함",
  "소극적임",
  "불성실함",
];

export function validateGeneratedComment(comment: string, expectedSentenceCount: number) {
  const normalized = comment.trim();
  const sentences = normalized
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const lengths = sentences.map((sentence) => Array.from(sentence).length);
  const forbidden = commentForbiddenExpressions.filter((expression) => normalized.includes(expression));
  const awkwardEndings = sentences.filter((sentence) => /(?:고|며|아|어|감|함)함\.$/.test(sentence));
  return {
    sentences,
    lengths,
    sentenceCountOk: expectedSentenceCount > 0 && sentences.length === expectedSentenceCount,
    lengthsOk: lengths.length > 0 && lengths.every((length) => length >= 50 && length <= 60),
    endingsOk: sentences.length > 0 && sentences.every((sentence) => sentence.endsWith("함.")),
    naturalEndingsOk: awkwardEndings.length === 0,
    awkwardEndings,
    forbidden,
    valid: expectedSentenceCount > 0
      && sentences.length === expectedSentenceCount
      && lengths.every((length) => length >= 50 && length <= 60)
      && sentences.every((sentence) => sentence.endsWith("함."))
      && awkwardEndings.length === 0
      && forbidden.length === 0,
  };
}

export function validateGeneratedCommentPart(comment: string) {
  const strict = validateGeneratedComment(comment, 1);
  const length = strict.lengths[0] ?? 0;
  const acceptedLength = length >= 48 && length <= 62;
  const warnings = [
    ...(acceptedLength && !strict.lengthsOk ? [`권장 50~60자 범위를 벗어난 ${length}자 문장`] : []),
  ];
  return {
    ...strict,
    acceptedLength,
    warnings,
    valid: strict.sentenceCountOk
      && acceptedLength
      && strict.endingsOk
      && strict.naturalEndingsOk
      && strict.forbidden.length === 0,
  };
}

const unsupportedAttitudePatterns = [
  "자신 있게", "적극적으로", "자기주도적으로", "모둠원과 협력", "친구와 협력",
  "끝까지", "성실하게", "꾸준히 참여", "의미를 파악", "스스로",
  "주도적으로", "능동적으로", "논리적으로", "효과적으로", "원활하게",
];

export function evidenceGroundingWarnings(comment: string, evidence: string) {
  return unsupportedAttitudePatterns
    .filter((expression) => comment.includes(expression) && !evidence.includes(expression))
    .map((expression) => `평가 근거에 없는 ‘${expression}’ 표현 확인 필요`);
}

export function openingRepetitionRate(comments: string[], prefixLength = 12) {
  const prefixes = comments.map((comment) => Array.from(comment.trim()).slice(0, prefixLength).join("")).filter(Boolean);
  if (prefixes.length < 2) return 0;
  return (prefixes.length - new Set(prefixes).size) / prefixes.length;
}
