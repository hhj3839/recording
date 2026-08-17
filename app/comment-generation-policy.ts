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

export function commentLengthTarget(evidence: string) {
  const normalized = normalizeGeneratedCommentWhitespace(evidence);
  const criterion = normalized.split(/\|\s*기준:\s*/).at(-1) ?? normalized;
  const actionCount = (criterion.match(/(?:고|며|하고|하며|하여|해서|거나|및|·|\/)/g) ?? []).length + 1;
  if (Array.from(criterion).length < 38 && actionCount <= 1) return { min: 45, max: 65, label: "45~65자" };
  if (Array.from(criterion).length < 75 && actionCount <= 2) return { min: 55, max: 75, label: "55~75자" };
  return { min: 60, max: 85, label: "60~85자" };
}

export function commentEvidenceInstructions(evidence: string) {
  const normalized = normalizeGeneratedCommentWhitespace(evidence);
  const required = [
    ...(/교사.{0,8}도움|도움.{0,8}교사/.test(normalized) ? ["교사의 도움을 받아 수행함"] : []),
    ...(/일부/.test(normalized) ? ["수행 범위가 일부임"] : []),
    ...(/노력|익혀\s*가|과정/.test(normalized) ? ["노력하거나 익혀 가는 과정임"] : []),
  ];
  const guarded = [
    { label: "정확하게", pattern: /정확(?:하게|히)/ },
    { label: "실감 나게", pattern: /실감\s*나게/ },
    { label: "다양한 방법", pattern: /다양한\s*방법/ },
    { label: "이해하기 쉽게", pattern: /이해하기\s*쉽게/ },
  ].filter((item) => !item.pattern.test(normalized)).map((item) => item.label);
  return {
    required,
    forbiddenUnlessPresent: guarded,
    instruction: [
      required.length ? `반드시 보존할 의미: ${required.join(", ")}` : "별도 필수 과정 표현 없음",
      guarded.length ? `근거에 없으므로 쓰지 말 의미: ${guarded.join(", ")}` : "",
    ].filter(Boolean).join(" / "),
  };
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

export function hasNaturalNominalEnding(sentence: string) {
  const trimmed = sentence.trim();
  if (!trimmed.endsWith(".")) return false;
  const normalized = trimmed.replace(/[.!?]+$/, "");
  const last = normalized.at(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 16;
}

export function ensureGeneratedCommentPeriod(sentence: string) {
  const normalized = normalizeGeneratedCommentWhitespace(sentence);
  if (!normalized || /[.!?]$/.test(normalized)) return normalized;
  const last = normalized.at(-1);
  if (!last) return normalized;
  const code = last.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 16
    ? `${normalized}.`
    : normalized;
}

export function validateGeneratedComment(comment: string, expectedSentenceCount: number) {
  const normalized = comment.trim();
  const sentences = normalized
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const lengths = sentences.map((sentence) => Array.from(sentence).length);
  const forbidden = commentForbiddenExpressions.filter((expression) => normalized.includes(expression));
  const awkwardEndings = sentences.filter((sentence) =>
    /(?:고|며|아|어|감|함)\s*함\.$/.test(sentence)
    || /(?:보임|됨)함\.$/.test(sentence)
    || /(?:려는|하고자\s*하는)\s+노력함\.$/.test(sentence)
    || /(?:표현|설명|정리|이해|구별|활용|실천|수행)\s+(?:표현|설명|정리|이해|구별|활용|실천|수행)함\.$/.test(sentence)
    || /(?:모습을\s+보|힘을\s+(?:기|파)|글을\s+써|뜻을\s+담아\s+내)\s+(?:표현|설명|정리|이해|구별|활용|실천|수행)함\.$/.test(sentence)
    || /(?:글의\s+쓰는|글쓰는)\s+방법/.test(sentence)
    || /(?:표현|설명|정리|이해|파악|구별|활용|실천|수행)\s+(?:(?:결과|활동|과정)(?:을|를)?)?\s*(?:수행|표현|이해|파악)함\.$/.test(sentence)
    || /[가-힣]+(?:는|은)\s+(?:이해|표현|설명|정리|구별|활용|수행)함\.$/.test(sentence));
  return {
    sentences,
    lengths,
    sentenceCountOk: expectedSentenceCount > 0 && sentences.length === expectedSentenceCount,
    lengthsOk: lengths.length > 0 && lengths.every((length) => length >= 60 && length <= 80),
    endingsOk: sentences.length > 0 && sentences.every(hasNaturalNominalEnding),
    naturalEndingsOk: awkwardEndings.length === 0,
    awkwardEndings,
    forbidden,
    valid: expectedSentenceCount > 0
      && sentences.length === expectedSentenceCount
      && lengths.every((length) => length >= 60 && length <= 80)
      && sentences.every(hasNaturalNominalEnding)
      && awkwardEndings.length === 0
      && forbidden.length === 0,
  };
}

export function composeGeneratedCommentCandidate(body: string, ending: string) {
  const normalizedBody = body.trim().replace(/[.。]+$/, "");
  if (!normalizedBody || /(?:고|며|아|어|해|하여|감|함|보|보이|익혀|드러내|나타내|써|파|기|하|되|가)$/.test(normalizedBody)) return "";
  return `${normalizedBody} ${ending}`;
}

export function validateGeneratedCommentPart(comment: string, evidence = "") {
  void evidence;
  const strict = validateGeneratedComment(comment, 1);
  const length = strict.lengths[0] ?? 0;
  const acceptedLength = length >= 35 && length <= 90;
  const warnings: string[] = [];
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
  const normalized = normalizeGeneratedCommentWhitespace(candidate);
  return validateGeneratedCommentPart(normalized).valid ? normalized : "";
}

const unsupportedGroundingConcepts: Array<{
  label: string;
  pattern: RegExp;
  evidencePattern?: RegExp;
  exclude?: RegExp;
  blocking: boolean;
}> = [
  { label: "자신 있게", pattern: /자신(?:감)?있|자신감을?(?:가지|보이)/, blocking: false },
  { label: "적극적으로", pattern: /적극적/, blocking: false },
  { label: "자기주도적으로", pattern: /자기주도적/, blocking: false },
  { label: "모둠원과 협력", pattern: /모둠(?:원)?.{0,4}(?:협력|협동)/, blocking: false },
  { label: "친구와 협력", pattern: /친구.{0,4}(?:협력|협동)/, blocking: false },
  { label: "끝까지", pattern: /(?:끝|마지막)까지/, blocking: true },
  { label: "성실하게", pattern: /성실/, blocking: true },
  { label: "꾸준히 참여", pattern: /(?:꾸준|지속적).{0,4}참여/, blocking: false },
  { label: "의미를 파악", pattern: /의미(?:를)?(?:파악|이해)/, blocking: false },
  { label: "스스로", pattern: /(?:스스로|자발적)/, blocking: false },
  { label: "주도적으로", pattern: /주도적/, exclude: /자기주도적/, blocking: false },
  { label: "능동적으로", pattern: /능동적/, blocking: false },
  { label: "논리적으로", pattern: /논리적/, blocking: false },
  { label: "효과적으로", pattern: /효과적/, blocking: false },
  { label: "원활하게", pattern: /원활/, blocking: false },
  { label: "자료 관찰·탐색·분석", pattern: /자료.{0,12}(?:관찰|탐색|분석)/, blocking: true },
  { label: "평가 요소 이해", pattern: /평가요소.{0,8}(?:이해|파악)/, blocking: true },
  { label: "원리나 방법을 자신의 말로 설명", pattern: /(?:원리|방법).{0,12}자신의말.{0,8}설명/, blocking: true },
  { label: "과제 수행", pattern: /과제.{0,6}수행/, blocking: true },
  { label: "주어진 내용의 표현·구성·재구성", pattern: /주어진내용.{0,12}(?:표현|구성|재구성)/, blocking: true },
  { label: "여러 방법 비교·판단", pattern: /여러방법.{0,10}(?:비교|판단|선택)/, blocking: true },
  { label: "평가 메타 표현", pattern: /(?:평가활동|평가요소|평가근거|성취기준|수준기준)/, blocking: true },
  { label: "정확하게", pattern: /정확(?:하게|히)/, blocking: true },
  { label: "실감 나게", pattern: /실감나게/, blocking: true },
  { label: "다양한 방법", pattern: /다양한방법/, blocking: true },
  { label: "이해하기 쉽게", pattern: /이해하기쉽게/, blocking: true },
  { label: "입력에 없는 구체적 표현 방법", pattern: /(?:그림|시)(?:이나|나|와|과|으로|로)/, blocking: true },
  { label: "말하기·발표 활동", pattern: /(?:말로풀어|말로표현|말하기|발표|구술)/, evidencePattern: /(?:말|대화|목소리|말투|발표|구술|듣기)/, blocking: true },
  { label: "내용 간추리기·요약하기", pattern: /(?:간추|요약)/, evidencePattern: /(?:간추|요약)/, blocking: true },
  { label: "자료 내용을 나누거나 구분하기", pattern: /자료(?:의)?내용.{0,10}(?:나누|구분)/, evidencePattern: /자료(?:의)?내용.{0,10}(?:나누|구분)/, blocking: true },
  { label: "관찰되지 않은 태도 수식어", pattern: /(?:차분|안정적|알차|고르게|꾸준)/, evidencePattern: /(?:차분|안정적|알차|고르게|꾸준|지속|노력)/, blocking: true },
  { label: "입력에 없는 학습·성장 과정", pattern: /(?:익히|익혀|배우|배워)/, evidencePattern: /(?:익히|익혀|배우|배워)/, blocking: true },
  { label: "학습 태도", pattern: /태도/, evidencePattern: /태도|자세|적극적|성실|꾸준|자기주도|주도적|능동적|노력/, blocking: true },
];

function normalizeGroundingText(text: string) {
  return text.normalize("NFKC").replace(/[\s·ㆍ,，.。!?！？:：;；'"“”‘’()[\]{}]/g, "");
}

export function evidenceGroundingWarnings(comment: string, evidence: string) {
  const normalizedComment = normalizeGroundingText(comment);
  const normalizedEvidence = normalizeGroundingText(evidence);
  return unsupportedGroundingConcepts
    .filter(({ pattern, evidencePattern, exclude }) =>
      pattern.test(normalizedComment)
      && !(exclude?.test(normalizedComment))
      && !(evidencePattern ?? pattern).test(normalizedEvidence))
    .map(({ label }) => `평가 근거에 없는 ‘${label}’ 표현 확인 필요`);
}

export function evidenceBlockingIssues(comment: string, evidence: string, requiredEvidence = evidence) {
  const normalizedComment = normalizeGroundingText(comment);
  const normalizedEvidence = normalizeGroundingText(evidence);
  const normalizedRequiredEvidence = normalizeGroundingText(requiredEvidence);
  const unsupported = unsupportedGroundingConcepts
    .filter(({ pattern, evidencePattern, exclude, blocking }) => blocking
      && pattern.test(normalizedComment)
      && !(exclude?.test(normalizedComment))
      && !(evidencePattern ?? pattern).test(normalizedEvidence))
    .map(({ label }) => `평가 근거에 없는 ‘${label}’ 표현`);
  const required = [
    { evidence: /교사.{0,5}도움|도움.{0,5}교사/, comment: /교사|도움/, label: "교사의 도움" },
    { evidence: /일부/, comment: /일부|몇몇|한부분|부분적으로/, label: "일부 수행" },
    { evidence: /노력|익혀가|과정/, comment: /노력|애씀|힘씀|힘쓰|익혀가|배워가|과정|하려는|하고자(?:하는)?/, label: "노력·성장 과정" },
    { evidence: /짜임.{0,16}(?:나누|나눌|나눠|구분)/, comment: /짜임.{0,24}(?:나누|나눌|나눠|구분)/, label: "문장의 짜임에 따라 나누기" },
    { evidence: /자료.{0,16}표현/, comment: /자료.{0,20}(?:표현|나타내|옮겨적)/, label: "자료 내용 표현하기" },
    { evidence: /중심문장.{0,12}뒷받침문장.{0,16}파악/, comment: /중심문장.{0,20}뒷받침문장.{0,20}(?:파악|찾)/, label: "중심·뒷받침 문장 파악하기" },
    { evidence: /간추/, comment: /간추|요약|정리/, label: "내용 간추리기" },
    { evidence: /재미.{0,12}감동.{0,20}까닭/, comment: /재미.{0,20}감동.{0,24}(?:까닭|이유)/, label: "재미·감동과 까닭 쓰기" },
    { evidence: /방법.{0,12}알고/, comment: /방법.{0,18}(?:알고|앎|이해)/, label: "방법을 알고 있음" },
  ].filter((item) => item.evidence.test(normalizedRequiredEvidence) && !item.comment.test(normalizedComment))
    .map((item) => `평가 기준의 필수 조건 ‘${item.label}’ 누락`);
  return [...unsupported, ...required];
}

export function isCommentLengthReviewIssue(issue: string) {
  return /^권장 (?:45~65|50~60|55~75|60~80|60~85)자 범위를 벗어난 \d+자 문장$/.test(issue.trim());
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
