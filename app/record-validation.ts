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
const sentenceEnd = /(음|임|함|됨|보임|돋보임|있음|나타남|기대됨)[.!?]?$/;
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
];

export function validateRecord(text: string, behavior = false): ValidationResult {
  const normalized = text.trim();
  const bytes = new TextEncoder().encode(normalized).length;
  const sentences = normalized.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean);
  const forbidden = forbiddenTerms.filter((term) => normalized.includes(term));
  const counts = new Map<string, number>();
  sentences.forEach((sentence) => {
    const key = sentence.replace(/[.!?\s]/g, "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const repeated = [...counts.entries()].filter(([, count]) => count > 1).map(([sentence]) => sentence.slice(0, 30));
  const endingsOk = !!sentences.length && sentences.every((sentence) => sentenceEnd.test(sentence));
  const lengthOk = behavior ? bytes >= 500 && bytes <= 550 : bytes > 0 && bytes <= 1500;
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

export function recordSimilarity(left: string, right: string) {
  const words = (value: string) => value.replace(/[.,!?()[\]{}]/g, " ").split(/\s+/).filter((word) => word.length > 1);
  const leftWords = new Set(words(left));
  const rightWords = new Set(words(right));
  if (leftWords.size < 5 || rightWords.size < 5) return 0;
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  return union ? intersection / union : 0;
}
