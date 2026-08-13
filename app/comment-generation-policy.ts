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

export function resolveGeneratedEvidenceItemId(
  expectedIds: string[],
  returnedId: unknown,
  returnedSentenceCount: number,
) {
  if (typeof returnedId === "string") return expectedIds.includes(returnedId) ? returnedId : null;
  return expectedIds.length === 1 && returnedSentenceCount === 1 ? expectedIds[0] : null;
}

export function generatedCommentFailureMessage(input: {
  expectedIds: string[];
  returnedIds: string[];
  invalidSentenceCount: number;
}) {
  const returned = new Set(input.returnedIds);
  const missingCount = input.expectedIds.filter((id) => !returned.has(id)).length;
  if (missingCount > 0) {
    return `AI가 ${missingCount}개 평가 영역의 문장을 반환하지 않았습니다. 기존 결과는 유지하며 누락 영역만 다시 생성합니다.`;
  }
  if (input.invalidSentenceCount > 0) {
    return `AI가 반환한 ${input.invalidSentenceCount}개 문장이 작성 기준을 통과하지 못했습니다. 기존 결과는 유지하며 해당 영역만 다시 생성합니다.`;
  }
  return "AI 결과를 확인하지 못했습니다. 기존 결과는 유지하며 완료되지 않은 영역만 다시 생성합니다.";
}

export function normalizeGeneratedCommentWhitespace(comment: string) {
  return comment.replace(/\s+/g, " ").trim();
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
  const awkwardEndings = sentences.filter((sentence) => /(?:고|며|아|어|감|함)\s*함\.$/.test(sentence));
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

export function composeGeneratedCommentCandidate(body: string, ending: string) {
  const normalizedBody = body.trim().replace(/[.。]+$/, "");
  if (!normalizedBody || /(?:고|며|아|어|감|함)$/.test(normalizedBody)) return "";
  return `${normalizedBody} ${ending}`;
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

export function normalizeGeneratedCommentCandidate(candidate: string) {
  const isStrict = (value: string) => {
    const validation = validateGeneratedCommentPart(value);
    const length = Array.from(value).length;
    return validation.valid && length >= 50 && length <= 60;
  };
  if (isStrict(candidate)) return candidate;
  const length = Array.from(candidate).length;
  if (length >= 45 && length < 50 && !candidate.startsWith("수업에서 ")) {
    const contextualized = `수업에서 ${candidate}`;
    if (isStrict(contextualized)) return contextualized;
  }
  if (length > 60 && length <= 75) {
    const optionalModifiers = [
      "자기 주도적으로 ", "적극적으로 ", "구체적으로 ", "논리적으로 ",
      "자연스럽게 ", "효과적으로 ", "능동적으로 ", "정확하게 ",
      "성실하게 ", "꾸준하게 ", "꾸준히 ", "알맞게 ",
    ];
    let compacted = candidate;
    for (const modifier of optionalModifiers) {
      if (!compacted.includes(modifier)) continue;
      compacted = compacted.replace(modifier, "");
      if (isStrict(compacted)) return compacted;
    }
  }
  return "";
}

const unsupportedAttitudeConcepts = [
  { label: "자신 있게", pattern: /자신(?:감)?있|자신감을?(?:가지|보이)/ },
  { label: "적극적으로", pattern: /적극적/ },
  { label: "자기주도적으로", pattern: /자기주도적/ },
  { label: "모둠원과 협력", pattern: /모둠(?:원)?.{0,4}(?:협력|협동)/ },
  { label: "친구와 협력", pattern: /친구.{0,4}(?:협력|협동)/ },
  { label: "끝까지", pattern: /(?:끝|마지막)까지/ },
  { label: "성실하게", pattern: /성실/ },
  { label: "꾸준히 참여", pattern: /(?:꾸준|지속적).{0,4}참여/ },
  { label: "의미를 파악", pattern: /의미(?:를)?(?:파악|이해)/ },
  { label: "스스로", pattern: /(?:스스로|자발적)/ },
  { label: "주도적으로", pattern: /주도적/, exclude: /자기주도적/ },
  { label: "능동적으로", pattern: /능동적/ },
  { label: "논리적으로", pattern: /논리적/ },
  { label: "효과적으로", pattern: /효과적/ },
  { label: "원활하게", pattern: /원활/ },
];

function normalizeGroundingText(text: string) {
  return text.normalize("NFKC").replace(/[\s·ㆍ,，.。!?！？:：;；'"“”‘’()[\]{}]/g, "");
}

export function evidenceGroundingWarnings(comment: string, evidence: string) {
  const normalizedComment = normalizeGroundingText(comment);
  const normalizedEvidence = normalizeGroundingText(evidence);
  return unsupportedAttitudeConcepts
    .filter(({ pattern, exclude }) =>
      pattern.test(normalizedComment)
      && !(exclude?.test(normalizedComment))
      && !pattern.test(normalizedEvidence))
    .map(({ label }) => `평가 근거에 없는 ‘${label}’ 표현 확인 필요`);
}

export function isCommentLengthReviewIssue(issue: string) {
  return /^권장 50~60자 범위를 벗어난 \d+자 문장$/.test(issue.trim());
}

export function commentAreaIssuesForDisplay(status: string, issues: string[]) {
  const visible = issues.filter((issue) => !isCommentLengthReviewIssue(issue));
  return status === "needs_review" || visible.length ? visible : [];
}

export function replaceSelectedCommentText(
  currentComment: string,
  replacement: string,
  selectionStart: number,
  selectionEnd: number,
) {
  if (!Number.isInteger(selectionStart) || !Number.isInteger(selectionEnd)
    || selectionStart < 0 || selectionEnd <= selectionStart || selectionEnd > currentComment.length) {
    return null;
  }
  return `${currentComment.slice(0, selectionStart)}${replacement}${currentComment.slice(selectionEnd)}`;
}

export function openingRepetitionRate(comments: string[], prefixLength = 12) {
  const prefixes = comments.map((comment) => Array.from(comment.trim()).slice(0, prefixLength).join("")).filter(Boolean);
  if (prefixes.length < 2) return 0;
  return (prefixes.length - new Set(prefixes).size) / prefixes.length;
}
