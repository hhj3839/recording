export type ValidationResult = {
  bytes: number;
  lengthOk: boolean;
  endingsOk: boolean;
  forbidden: string[];
  repeated: string[];
  growthIncluded: boolean;
  spellingOk: boolean;
  spellingIssues: string[];
  valid: boolean;
};

const forbiddenTerms = ["수상", "대회 실적", "사교육", "학원", "공인시험", "부모 직업", "가정형편", "사회경제적"];
const behaviorSensitiveTerms = ["학교폭력", "징계", "질병", "진단명", "신체조건"];
const sensitiveInputPatterns: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b\d{6}-?[1-4]\d{6}\b/, label: "주민등록번호 형식" },
  { pattern: /\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/, label: "휴대전화 번호" },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, label: "이메일 주소" },
  { pattern: /(어머니|아버지|부모님?|보호자).{0,12}(직업|근무|소득|재산|경제)/, label: "가정·보호자 정보" },
];
const sentenceEnd = /(음|임|함|됨|보임|돋보임|있음|나타남|기대됨)[.!?]?$/;
function hasNominalMieumEnding(sentence: string) {
  const normalized = sentence.trim().replace(/[.!?]+$/, "");
  const last = normalized.at(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 16;
}
const spellingRules: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /[^\S\r\n]{2,}/, message: "띄어쓰기가 두 칸 이상 연속된 부분이 있음" },
  { pattern: /\s+[,.!?]/, message: "문장부호 앞에 불필요한 공백이 있음" },
  { pattern: /[.!?]{2,}/, message: "문장부호가 연속으로 반복됨" },
  { pattern: /되여/, message: "'되여'를 '되어'로 고쳐 쓰는 것이 적절함" },
  { pattern: /돼어/, message: "'돼어'를 '되어'로 고쳐 쓰는 것이 적절함" },
  { pattern: /않됨/, message: "'않됨'을 문맥에 따라 '안 됨' 또는 '되지 않음'으로 고쳐야 함" },
  { pattern: /않함/, message: "'않함'을 문맥에 따라 '안 함' 또는 '하지 않음'으로 고쳐야 함" },
  { pattern: /(할|될|볼|알|쓸|갈|올)수(?=[가-힣\s,.!?]|$)/, message: "의존 명사 '수'는 앞말과 띄어 써야 함" },
  { pattern: /몇일/, message: "'몇일'을 '며칠'로 고쳐야 함" },
  { pattern: /역활/, message: "'역활'을 '역할'로 고쳐야 함" },
  { pattern: /어떻해/, message: "'어떻해'를 문맥에 따라 '어떻게' 또는 '어떡해'로 고쳐야 함" },
  { pattern: /금새/, message: "'금새'를 시간의 뜻으로 썼다면 '금세'로 고쳐야 함" },
  { pattern: /웬지/, message: "'웬지'를 '왠지'로 고쳐야 함" },
  { pattern: /깨끗히/, message: "'깨끗히'를 '깨끗이'로 고쳐야 함" },
  { pattern: /곰곰히/, message: "'곰곰히'를 '곰곰이'로 고쳐야 함" },
  { pattern: /일일히/, message: "'일일히'를 '일일이'로 고쳐야 함" },
  { pattern: /틈틈히/, message: "'틈틈히'를 '틈틈이'로 고쳐야 함" },
  { pattern: /할려고/, message: "'할려고'를 '하려고'로 고쳐야 함" },
  { pattern: /바램/, message: "소망의 뜻이라면 '바램'을 '바람'으로 고쳐야 함" },
  { pattern: /[가-힣]데로/, message: "의존 명사 표현의 '데로'를 문맥에 따라 '대로'로 확인해야 함" },
];

export function validateRecord(text: string, behavior = false): ValidationResult {
  const normalized = text.trim();
  const bytes = new TextEncoder().encode(normalized).length;
  const sentences = normalized.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean);
  const forbidden = [...forbiddenTerms, ...(behavior ? behaviorSensitiveTerms : [])]
    .filter((term) => normalized.includes(term));
  const counts = new Map<string, number>();
  sentences.forEach((sentence) => {
    const key = sentence.replace(/[.!?\s]/g, "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const repeated = [...counts.entries()].filter(([, count]) => count > 1).map(([sentence]) => sentence.slice(0, 30));
  const endingsOk = !!sentences.length && sentences.every((sentence) =>
    behavior ? hasNominalMieumEnding(sentence) : sentenceEnd.test(sentence));
  const lengthOk = behavior ? bytes >= 500 && bytes <= 600 : bytes > 0 && bytes <= 1500;
  const growthIncluded = !behavior || /(성장|변화|발전|향상|노력|기르|익히|꾸준|가능성|나아)/.test(normalized);
  const spellingIssues = spellingRules.filter((rule) => rule.pattern.test(normalized)).map((rule) => rule.message);
  if ((normalized.match(/\(/g) ?? []).length !== (normalized.match(/\)/g) ?? []).length) {
    spellingIssues.push("여는 괄호와 닫는 괄호의 개수가 다름");
  }
  const spellingOk = spellingIssues.length === 0;
  return {
    bytes,
    lengthOk,
    endingsOk,
    forbidden,
    repeated,
    growthIncluded,
    spellingOk,
    spellingIssues,
    valid: lengthOk && endingsOk && !forbidden.length && !repeated.length && growthIncluded && spellingOk,
  };
}

export function validateBehaviorSource(text: string) {
  const normalized = text.trim();
  const forbidden = forbiddenTerms.filter((term) => normalized.includes(term));
  const sensitive = [
    ...sensitiveInputPatterns.filter((item) => item.pattern.test(normalized)).map((item) => item.label),
    ...behaviorSensitiveTerms.filter((term) => normalized.includes(term)).map((term) => `민감 내용: ${term}`),
  ];
  return { valid: Boolean(normalized) && !forbidden.length && !sensitive.length, forbidden, sensitive };
}

export function countBehaviorCharacteristics(text: string) {
  const normalized = text.trim();
  if (!normalized) return 0;
  const labeled = normalized.split(/\r?\n|·/).filter((item) => /^[^:\n]{2,20}:\s*\S/.test(item.trim()));
  if (labeled.length) return labeled.length;
  return normalized.split(/\r?\n|·/).map((item) => item.trim()).filter(Boolean).length;
}

const similarityWords = (value: string) =>
  value.replace(/[.,!?()[\]{}]/g, " ").split(/\s+/).map((word) => word.trim()).filter((word) => word.length > 1);

export function recordSimilarityDetails(left: string, right: string) {
  const leftWordList = similarityWords(left);
  const rightWordList = similarityWords(right);
  const leftWords = new Set(leftWordList);
  const rightWords = new Set(rightWordList);
  if (leftWords.size < 5 || rightWords.size < 5) return { score: 0, overlaps: [] as string[] };
  const commonWords = [...leftWords].filter((word) => rightWords.has(word));
  const union = new Set([...leftWords, ...rightWords]).size;
  const phrases = new Set<string>();
  for (let size = 4; size >= 2; size -= 1) {
    for (let index = 0; index <= leftWordList.length - size; index += 1) {
      const phraseWords = leftWordList.slice(index, index + size);
      const phrase = phraseWords.join(" ");
      if (rightWordList.join(" ").includes(phrase)) phrases.add(phrase);
    }
  }
  const overlaps = [...phrases]
    .sort((leftPhrase, rightPhrase) => rightPhrase.length - leftPhrase.length)
    .filter((phrase, index, all) => !all.slice(0, index).some((existing) => existing.includes(phrase)))
    .slice(0, 3);
  if (!overlaps.length) overlaps.push(...commonWords.sort((a, b) => b.length - a.length).slice(0, 5));
  return { score: union ? commonWords.length / union : 0, overlaps };
}

export function recordSimilarity(left: string, right: string) {
  const { score } = recordSimilarityDetails(left, right);
  return score;
}
