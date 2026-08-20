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
    .replace(/쓸\s*수\s*있다\.$/, "씀.")
    .replace(/만들\s*수\s*있다\.$/, "만듦.")
    .replace(/나눌\s*수\s*있다\.$/, "나눔.")
    .replace(/간추릴\s*수\s*있다\.$/, "간추림.")
    .replace(/알\s*수\s*있다\.$/, "앎.")
    .replace(/읽을\s*수\s*있다\.$/, "읽음.")
    .replace(/적을\s*수\s*있다\.$/, "적음.")
    .replace(/찾을\s*수\s*있다\.$/, "찾음.")
    .replace(/들을\s*수\s*있다\.$/, "들음.")
    .replace(/([가-힣]+)볼\s*수\s*있다\.$/, "$1봄.")
    .replace(/([가-힣]+)할\s*수\s*있다\.$/, "$1함.")
    .replace(/될\s*수\s*있다\.$/, "됨.")
    .replace(/만든다\.$/, "만듦.")
    .replace(/한다\.$/, "함.")
    .replace(/간다\.$/, "감.")
    .replace(/된다\.$/, "됨.")
    .replace(/있다\.$/, "있음.")
    .replace(/이다\.$/, "임.");
}

export function buildCanonicalCommentSentence(criterion: string) {
  const normalized = normalizeGeneratedCommentWhitespace(criterion);
  if (!normalized) return "";
  return repairSafeNominalEnding(criterionToSafeNominalSentence(normalized));
}

export function criterionToSafeNominalCandidates(criterion: string) {
  const normalized = normalizeGeneratedCommentWhitespace(criterion);
  const candidates = [buildCanonicalCommentSentence(normalized)];
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
  if (!level) return [];
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
  // 일반 명사형 받침 ㅁ뿐 아니라 만들다→만듦, 알다→앎처럼
  // ㄹㅁ으로 활용되는 올바른 명사형도 허용한다.
  return code >= 0xac00 && code <= 0xd7a3 && [10, 16].includes((code - 0xac00) % 28);
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

const commentPerformanceActions = [
  { label: "오래된 물건의 쓰임 조사하기", pattern: /오래된\s*물건.{0,20}쓰임.{0,20}조사|조사.{0,20}오래된\s*물건.{0,20}쓰임/ },
  { label: "당시 생활 모습 조사하기", pattern: /당시.{0,12}생활\s*모습.{0,20}조사|조사.{0,20}당시.{0,12}생활\s*모습/ },
  { label: "표현하기", pattern: /표현|나타내/ },
  { label: "글 쓰기", pattern: /(?:글|까닭|이유).{0,18}(?:쓰|쓸|씀|적|작성)/ },
  { label: "이해하기", pattern: /이해/ },
  { label: "알기", pattern: /(?:알고|안다|알수|앎)/ },
  { label: "파악하기", pattern: /파악/ },
  { label: "간추리기", pattern: /간추|요약/ },
  { label: "나누기", pattern: /나누|나눌|나눔|구분/ },
  { label: "만들기", pattern: /만들|만든|만듦|제작/ },
  { label: "조사하기", pattern: /조사/ },
  { label: "정리하기", pattern: /정리/ },
  { label: "활용하기", pattern: /활용/ },
  { label: "실천하기", pattern: /실천/ },
  { label: "다짐하기", pattern: /다짐/ },
  { label: "참여하기", pattern: /참여/ },
] as const;

export function commentPredicatePolicy(criterion: string) {
  const normalized = normalizeGeneratedCommentWhitespace(criterion);
  const completionMode = /노력|애쓰|힘쓰|익혀\s*가|배워\s*가|성장|과정/.test(normalized)
    ? "process"
    : "completed";
  const requiredActions = commentPerformanceActions
    .filter((action) => action.pattern.test(normalized))
    .map((action) => action.label);
  return {
    completionMode,
    requiredActions,
    instruction: completionMode === "completed"
      ? `완료한 수행을 직접 명사형으로 종결함: ${requiredActions.join(", ") || "평가기준의 핵심 수행"}. 과정·모습·태도로 바꾸지 않음.`
      : `평가기준에 명시된 노력·성장 과정을 그대로 유지함: ${requiredActions.join(", ") || "평가기준의 핵심 수행"}. 완료한 수행으로 높이지 않음.`,
  } as const;
}

export function commentPredicateIssues(comment: string, criterion: string) {
  const policy = commentPredicatePolicy(criterion);
  if (policy.completionMode !== "completed" || policy.requiredActions.length === 0) return [];
  const ambiguousProcessEnding = /(?:해|하여|어|아)\s*감\.$/.test(comment)
    || /고\s*있음\.$/.test(comment)
    || /(?:한|된|만든|보인)\s+(?:모습|상태)임\.$/.test(comment)
    || /할\s*수\s*있음\.$/.test(comment)
    || /(?:하는|하려는)\s+(?:모습|과정|태도)(?:임|이\s*드러남)\.$/.test(comment)
    || /(?:수행|활동).{0,8}(?:모습|과정)임\.$/.test(comment)
    || /(?:하는|쓰는)\s+데서\s*드러남\.$/.test(comment)
    // 완료 수행을 결과물의 상태나 가벼운 시도로 바꾸면 실제 행동이
    // 사라지므로 과목명과 무관하게 직접 동사 종결을 요구한다.
    || /(?:한|된|만든|작성한|조사한|정리한|표현한)\s*(?:내용|결과|자료|작품)임\.$/.test(comment)
    || /(?:해|하여|만들어|정리해|조사해|표현해)\s*봄\.$/.test(comment);
  return ambiguousProcessEnding
    ? ["완료 수행을 과정·모습·태도로 바꾼 모호한 종결"]
    : [];
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
    || /마음을\s*전하는\s*글로\s*표현함\.$/.test(sentence)
    || /(?:글을\s*함|글로\s*활용함)\.$/.test(sentence)
    // 명사형 종결을 만들기 위해 활동명 뒤에 '함'을 기계적으로 붙이거나
    // 목적어 없이 '글 씀'으로 줄인 문장은 종결 글자가 맞아도 비문이다.
    || /(?:글\s*)?쓰기함\.$/.test(sentence)
    || /(?:^|\s)글\s+씀\.$/.test(sentence)
    || /(?:쓰며|써서|생각하며)\s+글\s*씀\.$/.test(sentence)
    || /(?:글|마음)을?\s*쓰는\s*데서\s*(?:마음|글|쓰기)/.test(sentence)
    || /전하고자\s*하는\s*마음의\s*글/.test(sentence)
    || /(?:까닭|부분).{0,16}(?:써|쓰며)\s*(?:감상을\s*)?글로\s*씀\.$/.test(sentence)
    || /마음을\s*전하는\s*글을\s*활용하여\s*씀\.$/.test(sentence)
    || /(?:부분|까닭).{0,16}읽고\s*써서/.test(sentence)
    || /쓰는\s*데서\s*드러남\.$/.test(sentence));
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
  const isCanonical = Boolean(evidence)
    && normalizeGeneratedCommentWhitespace(comment) === buildCanonicalCommentSentence(evidence);
  const acceptedMinimum = isCanonical ? 10 : evidence && evidenceLength < 38 ? 20 : 35;
  const acceptedLength = length >= acceptedMinimum && length <= 90;
  const predicateIssues = evidence ? commentPredicateIssues(comment, evidence) : [];
  const warnings: string[] = [];
  return {
    ...strict,
    acceptedLength,
    acceptedMinimum,
    predicateIssues,
    warnings,
    valid: strict.sentenceCountOk
      && acceptedLength
      && strict.endingsOk
      && strict.naturalEndingsOk
      && predicateIssues.length === 0
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
  { label: "입력보다 강한 수행 정도", pattern: /(?:깊이|충분히|완전히|매우)/, evidencePattern: /(?:깊이|충분히|완전히|매우)/, blocking: true },
  { label: "입력보다 강한 자세한 수행", pattern: /자세히/, evidencePattern: /자세히|구체적/, blocking: true },
  { label: "입력보다 강한 잘 수행", pattern: /잘(?:표현|정리|설명|파악|활용|수행)/, evidencePattern: /잘(?:표현|정리|설명|파악|활용|수행)|능숙|우수/, blocking: true },
  { label: "수행을 능력 보유로 변경", pattern: /할줄알/, evidencePattern: /할줄알/, blocking: true },
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
  { label: "조사하기", criterion: /조사/, comment: /조사(?:함|한|하여|하고|해|했|한뒤|한후|해서)/ },
  { label: "조사 결과 정리하기", criterion: /조사.{0,18}정리/, comment: /조사.{0,24}정리|정리.{0,24}조사/ },
  { label: "글로 표현하기", criterion: /글.{0,8}표현|표현.{0,8}글/, comment: /글.{0,10}(?:표현함|나타냄|작성함|씀)|(?:표현함|나타냄|작성함|씀).{0,10}글/ },
  { label: "자료 만들기", criterion: /자료.{0,10}(?:만들|만든|만드는|만듦|제작|구성)/, comment: /자료.{0,12}(?:만들|만든|만드는|만듦|제작|구성|마련)/ },
  { label: "소개하기", criterion: /소개/, comment: /소개/ },
  { label: "사례 탐색하기", criterion: /사례.{0,12}(?:탐색|살펴|찾아|조사|알아보)/, comment: /사례.{0,14}(?:탐색|살펴|찾아|조사|알아보)/ },
  { label: "실천 자세 다짐하기", criterion: /(?:자세|태도).{0,14}다짐|다짐.{0,14}(?:자세|태도)/, comment: /(?:자세|태도).{0,16}다짐|다짐.{0,16}(?:자세|태도)/ },
  { label: "의미 이해하기", criterion: /의미.{0,10}(?:이해|알)/, comment: /의미.{0,12}(?:이해|파악|앎|알고|알며)/ },
  { label: "마음 전하기", criterion: /마음.{0,10}(?:전하|전할|표현)/, comment: /마음.{0,12}(?:전하|전함|전하며|표현)/ },
  { label: "실천할 일 알기", criterion: /실천.{0,12}(?:일|것).{0,12}(?:알고|안다|알수)/, comment: /실천.{0,14}(?:일|것).{0,14}(?:알고|알며|앎|이해)/ },
  { label: "비교적인 수행 정도", criterion: /(?:비교적|대체로)/, comment: /(?:비교적|대체로)/ },
  { label: "상황에 알맞은 대화 표현하기", criterion: /(?:대화.{0,18}(?:표현|나타내)|(?:표현|나타내).{0,18}대화)/, comment: /(?:대화.{0,20}(?:표현|나타내)|(?:표현|나타내).{0,20}대화)/ },
  { label: "재미·감동을 느낀 부분과 까닭 쓰기", criterion: /(?:재미|감동).{0,28}(?:부분).{0,20}(?:까닭|이유).{0,12}(?:쓰|쓸|씀|써|적)|(?:부분).{0,20}(?:까닭|이유).{0,12}(?:쓰|쓸|씀|써|적)/, comment: /(?:재미|감동).{0,32}(?:부분).{0,24}(?:까닭|이유).{0,14}(?:씀|썼|써냄|적음|작성함)|(?:부분).{0,24}(?:까닭|이유).{0,14}(?:씀|썼|써냄|적음|작성함)/ },
  { label: "마음을 전하는 글 실제로 쓰기", criterion: /마음.{0,16}전하.{0,16}글.{0,48}(?:쓸수|쓰고|씀|써서|작성)/, comment: /마음.{0,18}전하.{0,18}글.{0,48}(?:씀|썼|써냄|작성함)/ },
  { label: "오래된 물건의 쓰임 조사하기", criterion: /오래된물건.{0,24}쓰임.{0,24}조사|조사.{0,24}오래된물건.{0,24}쓰임/, comment: /오래된물건.{0,28}쓰임.{0,28}조사(?:함|한|하여|하고|해|했)|조사(?:함|한|하여|하고|해|했).{0,28}오래된물건.{0,28}쓰임/ },
  { label: "당시 생활 모습 조사하기", criterion: /당시.{0,16}생활모습.{0,24}조사|조사.{0,24}당시.{0,16}생활모습/, comment: /당시.{0,18}(?:사람들의)?생활모습.{0,28}조사(?:함|한|하여|하고|해|했)|조사(?:함|한|하여|하고|해|했).{0,28}당시.{0,18}(?:사람들의)?생활모습/ },
];

// 교과별 명사에 의존하지 않고 평가기준의 독립 수행 동사를 보존한다.
// 같은 수행의 일반적인 활용·유의어만 허용하여 새 평가계획에도 적용한다.
const genericPerformanceAtoms = [
  { label: "관찰하기", criterion: /관찰/, comment: /관찰|살펴보|살핌/ },
  { label: "분류하기", criterion: /분류/, comment: /분류|갈래로나누|기준에따라나누/ },
  { label: "비교하기", criterion: /비교/, comment: /비교|공통점|차이점/ },
  { label: "계산하기", criterion: /계산|연산/, comment: /계산|연산|구함/ },
  { label: "해결하기", criterion: /해결/, comment: /해결|풀이/ },
  { label: "설명하기", criterion: /설명/, comment: /설명|풀어말|밝힘/ },
  { label: "기록하기", criterion: /기록/, comment: /기록|적음|작성|씀/ },
  { label: "조사하기", criterion: /조사/, comment: /조사|찾아보|살펴보/ },
  { label: "정리하기", criterion: /정리/, comment: /정리|갈무리/ },
  { label: "표현하기", criterion: /표현|나타내/, comment: /표현|나타냄|드러냄/ },
  { label: "글 쓰기", criterion: /(?:글|까닭|이유).{0,24}(?:쓰|작성)/, comment: /(?:글|까닭|이유).{0,28}(?:씀|작성|적음|쓰기(?:위해|에)\s*(?:노력함|힘씀))/ },
  { label: "만들기", criterion: /만들|제작/, comment: /만들|만듦|제작/ },
  { label: "소개하기", criterion: /소개/, comment: /소개/ },
  { label: "발표하기", criterion: /발표/, comment: /발표/ },
  { label: "토의하기", criterion: /토의/, comment: /토의/ },
  { label: "파악하기", criterion: /파악/, comment: /파악|찾아냄|알아냄/ },
  { label: "간추리기", criterion: /간추|요약/, comment: /간추|요약/ },
  { label: "적용하기", criterion: /적용/, comment: /적용/ },
  { label: "활용하기", criterion: /활용/, comment: /활용|이용/ },
  { label: "실천하기", criterion: /실천/, comment: /실천/ },
] as const;

export function buildCommonCommentGenerationGuide(criterion: string) {
  const normalized = normalizeGroundingText(criterion);
  const actions = genericPerformanceAtoms
    .filter((atom) => atom.criterion.test(normalized))
    .map((atom) => atom.label);
  const support = /(?:교사|친구|모둠원).{0,10}도움|도움.{0,10}(?:교사|친구|모둠원)/.test(normalized)
    ? "입력에 명시된 도움을 받아 수행"
    : "도움 여부를 추측하지 않음";
  const scope = [
    ...(/일부/.test(normalized) ? ["일부 수행"] : []),
    ...(/(?:비교적|대체로)/.test(normalized) ? ["입력에 명시된 보통 수행 정도"] : []),
    ...(/(?:한가지|하나의)/.test(normalized) ? ["한 가지 범위"] : []),
    ...(/(?:정확|능숙|구체적|다양한|이해하기쉽게|실감나게)/.test(normalized) ? ["입력에 명시된 높은 수행 정도"] : []),
  ];
  const predicate = commentPredicatePolicy(criterion);
  return {
    requiredActions: [...new Set(actions)],
    support,
    scope,
    completion: predicate.completionMode,
    rules: [
      "평가기준에 있는 모든 독립 수행을 한 문장에 보존함",
      "각 수행 대상과 동사를 원문의 관계대로 연결함",
      "입력에 없는 활동·태도·방법·수행 정도를 추가하지 않음",
      predicate.completionMode === "completed"
        ? "완료 수행을 내용임·결과임·모습임·해 봄으로 약화하지 않고 직접 동사로 종결함"
        : "입력에 명시된 노력·성장·과정 의미를 완료 수행으로 높이지 않음",
      "자연스러운 관찰 기반 명사형 문장과 마침표로 완결함",
    ],
  } as const;
}

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
  const genericRequired = genericPerformanceAtoms
    .filter((atom) => atom.criterion.test(selected) && !atom.comment.test(normalizedComment))
    .map((atom) => `평가 기준의 독립 수행 ‘${atom.label}’ 누락`);
  if (!levelCriteria) return [...new Set([...required, ...genericRequired])];
  const siblings = [levelCriteria.high, levelCriteria.middle, levelCriteria.low]
    .map(normalizeGroundingText)
    .filter((criterion) => criterion !== selected);
  const leaked = semanticAtoms
    .filter((atom) => !atom.criterion.test(selected)
      && atom.comment.test(normalizedComment)
      && siblings.some((criterion) => atom.criterion.test(criterion)))
    .map((atom) => `선택하지 않은 평가수준의 수행 ‘${atom.label}’ 포함`);
  return [...new Set([...required, ...genericRequired, ...leaked])];
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
