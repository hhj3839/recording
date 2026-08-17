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
    ...(/정확(?:하게|히)/.test(normalized) ? ["정확한 수행 정도가 드러남"] : []),
    ...(/실감\s*나게/.test(normalized) ? ["실감 나거나 생생한 표현 수준이 드러남"] : []),
    ...(/다양한\s*방법/.test(normalized) ? ["다양한 방법으로 수행함"] : []),
    ...(/이해하기\s*쉽게/.test(normalized) ? ["이해하기 쉽게 수행함"] : []),
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
  "어려움을 겪음",
  "어려움을 나타냄",
  "협력을 하지 않음",
  "협력하지 않음",
  "표현하지 못",
  "알고도",
  "수준임",
];

export function positiveGrowthCriterion(level: string | undefined, criterion: string) {
  const normalized = normalizeGeneratedCommentWhitespace(criterion);
  if (level !== "하") return normalized;
  return normalized
    .replace(/(.+?)하는 데 어려움을 겪는다\.?$/, "$1하는 활동에 참여하며 수행 방법을 익혀 간다.")
    .replace(/(?:모둠에서\s*)?(.+?)하는 데 협력을 하지 않는다\.?$/, "모둠에서 $1하는 활동에 참여하며 협력하는 경험을 쌓아 간다.")
    .replace(/(.+?)하였으나,?\s*(.+?)하지 못한다\.?$/, "$1하고, $2하는 활동에 참여한다.");
}

export function criterionToSafeNominalSentence(criterion: string) {
  return normalizeGeneratedCommentWhitespace(criterion)
    .replace(/만든다\.$/, "만듦.")
    .replace(/한다\.$/, "함.")
    .replace(/간다\.$/, "감.")
    .replace(/된다\.$/, "됨.")
    .replace(/있다\.$/, "있음.")
    .replace(/이다\.$/, "임.");
}

export function criterionToSafeNominalCandidates(criterion: string) {
  const normalized = normalizeGeneratedCommentWhitespace(criterion);
  const candidates = [criterionToSafeNominalSentence(normalized)];
  const discussion = normalized.match(/^(.+?)의 조건과 그 이유를 한 가지 말하고,?\s*친구들의 생각을 들으며 바른 자세로 토의에 임한다\.$/);
  if (discussion) {
    const subject = discussion[1].trim();
    candidates.push(
      `친구들의 생각을 들으며 바른 자세로 토의에 임하고, ${subject}의 조건과 그 이유를 한 가지 말함.`,
      `바른 자세로 토의에 임하며 친구들의 생각을 듣고, ${subject}의 조건 한 가지와 그 이유를 말함.`,
    );
  }
  if (/^지역 이름의 유래와 옛이야기를 조사하여 정리하고 글로 표현한다\.$/.test(normalized)) {
    candidates.push(
      "옛이야기와 지역 이름의 유래를 조사해 정리하고 글로 표현함.",
      "지역 이름의 유래와 옛이야기를 조사하고, 정리한 내용을 글로 표현함.",
    );
  }
  const together = normalized.match(/^모둠\s*친구들과\s*함께\s+(.+?)한다\.$/);
  if (together) {
    const action = together[1].trim();
    candidates.push(
      `${action}하며 모둠 친구들과 함께 활동함.`,
      `${action}하는 과정에 모둠 친구들과 함께 참여함.`,
    );
  }
  return [...new Set(candidates.filter(Boolean))];
}

export function levelAppropriatenessIssues(comment: string, level: string | undefined, criterion = "") {
  if (!level || level === "상") return [];
  const strongPraise = /(?:능력이\s*)?뛰어남|돋보임|인상적임/;
  const criterionAllowsPraise = /뛰어|돋보|인상적|탁월|우수/.test(criterion);
  return strongPraise.test(comment) && !criterionAllowsPraise
    ? ["평가수준보다 과도한 우수 표현"]
    : [];
}

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

// AI가 뜻은 맞게 작성했지만 명사형 종결을 겹쳐 쓴 경우에만 안전하게
// 교정한다. 동사 활용을 추측해야 하는 문형은 손대지 않아 의미 변형을 막는다.
export function repairSafeNominalEnding(sentence: string) {
  return ensureGeneratedCommentPeriod(sentence)
    .replace(/써냄\.$/, "써 냄.")
    .replace(/([가-힣]+)하는\s+함\.$/, "$1함.")
    .replace(/([가-힣]+)하는\s+(?:수행|활동|과정|모습)임\.$/, "$1함.")
    .replace(/만드는\s+(?:모습|과정)임\.$/, "만듦.")
    .replace(/조사하는\s+(?:모습|과정)임\.$/, "조사함.")
    .replace(/표현하는\s+(?:모습|과정)임\.$/, "표현함.")
    .replace(/소개하는\s+(?:모습|과정)임\.$/, "소개함.")
    .replace(/참여하는\s+(?:모습|과정)임\.$/, "참여함.");
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
    || /[가-힣]+(?:는|은)\s+(?:이해|표현|설명|정리|구별|활용|수행)함\.$/.test(sentence)
    || /(?:만드는|조사하는|표현하는|소개하는|참여하는)\s+(?:모습|과정)임\.$/.test(sentence)
    || /도움\s*없이가\s*아니라/.test(sentence)
    || /(?:조사하여\s*정리하여|들으며\s*토의하며)/.test(sentence)
    || /함\s*,/.test(sentence)
    || /장소를\s+소개\s+자료로/.test(sentence)
    || /(?:까닭|이유)(?:을|를)\s+작품을\s+읽고/.test(sentence)
    || /방법을\s+알고,?\s*활용하여/.test(sentence)
    || /대화\s*표현에\s*(?:힘씀|애씀)/.test(sentence)
    || /마음을\s*전하는\s*글로\s*표현함\.$/.test(sentence));
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
  const strict = validateGeneratedComment(comment, 1);
  const length = strict.lengths[0] ?? 0;
  // 정보량이 짧은 평가기준은 근거 없는 수식어로 35자를 채우게 하지 않는다.
  // 기준을 직접 자연스럽게 명사형으로 바꾼 짧은 문장은 보존한다.
  const evidenceLength = Array.from(normalizeGeneratedCommentWhitespace(evidence)).length;
  const acceptedMinimum = evidence && evidenceLength < 38 ? 20 : 35;
  const acceptedLength = length >= acceptedMinimum && length <= 90;
  const warnings: string[] = [];
  return {
    ...strict,
    acceptedLength,
    acceptedMinimum,
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
  { label: "모둠원과 협력", pattern: /모둠(?:원)?.{0,12}(?:협력|협동)/, evidencePattern: /모둠|협력|협동/, blocking: false },
  { label: "친구와 협력", pattern: /친구.{0,8}(?:함께|협력|협동)/, evidencePattern: /친구.{0,8}함께|협력|협동/, blocking: false },
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
  { label: "입력에 없는 구체적 표현 방법", pattern: /(?:그림|시|노래|만화)(?:이나|나|와|과|으로|로)/, blocking: true },
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
  const concreteMethodLeak = ["그림", "시", "노래", "만화"]
    .filter((method) => normalizedComment.includes(method)
      && normalizedEvidence.includes(method)
      && !normalizedRequiredEvidence.includes(method)
      && !normalizedRequiredEvidence.includes("다양한방법"))
    .map((method) => `선택한 평가수준에 없는 구체적 표현 방법 ‘${method}’ 포함`);
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
    { evidence: /정확(?:하게|히)/, comment: /정확|바르게/, label: "정확한 수행 정도" },
    { evidence: /실감나게/, comment: /실감|생생/, label: "실감 나거나 생생한 표현 수준" },
    { evidence: /다양한방법/, comment: /다양한방법|여러방법|(?:그림|시|노래|만화)(?:이나|나|와|과|으로|로)/, label: "다양한 방법으로 수행하기" },
    { evidence: /이해하기쉽게/, comment: /이해하기쉽게|알기쉽게/, label: "이해하기 쉽게 수행하기" },
  ].filter((item) => item.evidence.test(normalizedRequiredEvidence) && !item.comment.test(normalizedComment))
    .map((item) => `평가 기준의 필수 조건 ‘${item.label}’ 누락`);
  return [...new Set([...unsupported, ...concreteMethodLeak, ...required])];
}

export type CommentLevelCriteria = { high: string; middle: string; low: string };

type SemanticAtom = { label: string; criterion: RegExp; comment: RegExp };

// 평가기준에서 직접 확인할 수 있는 수행요소만 검사한다. 목표·관점은 문맥
// 자료일 뿐 필수 수행이나 학생의 실제 행동으로 승격하지 않는다.
const semanticAtoms: SemanticAtom[] = [
  { label: "도움을 받아 수행하기", criterion: /(?:교사|친구|모둠원).{0,10}도움|도움.{0,10}(?:교사|친구|모둠원)/, comment: /(?:교사|친구|모둠원).{0,12}도움|도움.{0,12}(?:교사|친구|모둠원)/ },
  { label: "한 가지 방법 선택하기", criterion: /(?:한가지|하나의).{0,12}방법|방법.{0,12}(?:한가지|하나를).{0,8}(?:선택|골라)/, comment: /(?:한가지|하나의).{0,12}방법|방법.{0,12}(?:한가지|하나를).{0,8}(?:선택|골라)/ },
  { label: "바른 자세로 토의하기", criterion: /바른자세.{0,12}토의|토의.{0,12}바른자세/, comment: /바른자세.{0,12}토의|토의.{0,12}바른자세/ },
  { label: "조건과 이유 말하기", criterion: /조건.{0,12}(?:이유|까닭).{0,12}(?:말|발표)|(?:말|발표).{0,18}조건.{0,12}(?:이유|까닭)/, comment: /조건.{0,12}(?:이유|까닭).{0,12}(?:말|밝|설명)|(?:말|밝|설명).{0,18}조건.{0,12}(?:이유|까닭)/ },
  { label: "친구의 생각 듣기", criterion: /친구.{0,10}생각.{0,8}(?:듣|경청)/, comment: /친구.{0,10}생각.{0,8}(?:듣|경청)/ },
  { label: "토의에 참여하기", criterion: /토의/, comment: /토의/ },
  { label: "다양한 조사 방법 알기", criterion: /(?:다양한|여러).{0,8}조사방법|조사.{0,8}(?:다양한|여러).{0,8}방법/, comment: /(?:다양한|여러).{0,8}조사방법|조사.{0,8}(?:다양한|여러).{0,8}방법/ },
  { label: "조사하기", criterion: /조사/, comment: /조사/ },
  { label: "조사 결과 정리하기", criterion: /조사.{0,18}정리/, comment: /조사.{0,24}정리|정리.{0,24}조사/ },
  { label: "글로 표현하기", criterion: /글.{0,8}표현|표현.{0,8}글/, comment: /글.{0,10}(?:표현함|나타냄|작성함|씀)|(?:표현함|나타냄|작성함|씀).{0,10}글/ },
  { label: "자료 만들기", criterion: /자료.{0,10}(?:만들|만든|만드는|만듦|제작|구성)/, comment: /자료.{0,12}(?:만들|만든|만드는|만듦|제작|구성|마련)/ },
  { label: "소개하기", criterion: /소개/, comment: /소개/ },
];

export function criterionSemanticIssues(
  comment: string,
  selectedCriterion: string,
  levelCriteria?: CommentLevelCriteria,
) {
  const normalizedComment = normalizeGroundingText(comment);
  const selected = normalizeGroundingText(selectedCriterion);
  const required = semanticAtoms
    .filter((atom) => atom.criterion.test(selected) && !atom.comment.test(normalizedComment))
    .map((atom) => `평가 기준의 필수 수행 ‘${atom.label}’ 누락`);
  if (!levelCriteria) return required;
  const siblings = [levelCriteria.high, levelCriteria.middle, levelCriteria.low]
    .map(normalizeGroundingText)
    .filter((criterion) => criterion !== selected);
  const leaked = semanticAtoms
    .filter((atom) => !atom.criterion.test(selected)
      && atom.comment.test(normalizedComment)
      && siblings.some((criterion) => atom.criterion.test(criterion)))
    .map((atom) => `선택하지 않은 평가수준의 수행 ‘${atom.label}’ 포함`);
  return [...new Set([...required, ...leaked])];
}

export function isCommentLengthReviewIssue(issue: string) {
  return /^권장 (?:45~65|50~60|55~75|60~80|60~85)자 범위를 벗어난 \d+자 문장$/.test(issue.trim());
}

export function isCommentSimilarityReviewIssue(issue: string) {
  return /(?:유사 표현|표현 유사도)/.test(issue.trim());
}

export function commentAreaIssuesForDisplay(status: string, issues: string[]) {
  const visible = issues.filter((issue) =>
    !isCommentLengthReviewIssue(issue) && !isCommentSimilarityReviewIssue(issue));
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
