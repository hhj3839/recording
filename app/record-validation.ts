export type ValidationResult = {
  bytes: number;
  lengthOk: boolean;
  endingsOk: boolean;
  forbidden: string[];
  repeated: string[];
  growthIncluded: boolean;
  valid: boolean;
};

const forbiddenTerms = ["수상", "대회 실적", "사교육", "학원", "공인시험", "부모 직업", "가정형편", "사회경제적"];
const sentenceEnd = /(음|임|함|됨|보임|돋보임|있음|나타남|기대됨)[.!?]?$/;

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
  return {
    bytes,
    lengthOk,
    endingsOk,
    forbidden,
    repeated,
    growthIncluded,
    valid: lengthOk && endingsOk && !forbidden.length && !repeated.length && growthIncluded,
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
