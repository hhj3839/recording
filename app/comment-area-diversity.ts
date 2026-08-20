export type CommentAreaPart = {
  studentId: number;
  subject: string;
  assessmentIndex: number;
  evidence: string;
  text: string;
};

export type CommentAreaOverlap = {
  key: string;
  referenceKey: string;
  reasons: string[];
  similarity: number;
};

const words = (value: string) => value.normalize("NFKC")
  .replace(/[^가-힣A-Za-z0-9\s]/g, " ")
  .split(/\s+/).map((word) => word.trim()).filter((word) => word.length > 1);

const stem = (word: string) => word
  .replace(/(?:으로|에서|에게|까지|부터|처럼|보다|하고|하며|하여|해서|하는|하며|할|함|됨|임|을|를|이|가|은|는|의|에|와|과)$/u, "")
  .slice(0, 8);

function reorderedCoreTokenSignature(text: string) {
  const tokens = words(text).map(stem).filter((item) => item.length > 1).sort();
  return tokens.length >= 6 ? tokens.join("|") : "";
}

function styleWords(text: string, evidence: string) {
  const evidenceStems = new Set(words(evidence).map(stem).filter((item) => item.length > 1));
  return words(text).map(stem).filter((item) => item.length > 1 && !evidenceStems.has(item));
}

function fourWordPhrases(tokens: string[]) {
  return new Set(Array.from({ length: Math.max(0, tokens.length - 3) }, (_, index) =>
    tokens.slice(index, index + 4).join(" ")));
}

export function commentAreaGroupKey(part: CommentAreaPart) {
  const level = part.evidence.match(/(?:^|\|)\s*수준:\s*(상|중|하)(?:\s*\||$)/)?.[1] ?? "";
  return `${part.subject}|${part.assessmentIndex}|${level}`;
}

export function commentAreaSimilarity(left: CommentAreaPart, right: CommentAreaPart) {
  const leftTokens = styleWords(left.text, left.evidence);
  const rightTokens = styleWords(right.text, right.evidence);
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const common = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union && Math.min(leftSet.size, rightSet.size) >= 3 ? common / union : 0;
}

export function commentAreaOverlapReasons(left: CommentAreaPart, right: CommentAreaPart) {
  if (commentAreaGroupKey(left) !== commentAreaGroupKey(right)) return [];
  const reasons: string[] = [];
  const normalizedLeft = left.text.normalize("NFKC").replace(/\s+/g, "").replace(/[.!?。！？]/g, "");
  const normalizedRight = right.text.normalize("NFKC").replace(/\s+/g, "").replace(/[.!?。！？]/g, "");
  if (normalizedLeft && normalizedLeft === normalizedRight) reasons.push("동일 문장 중복");
  const leftReordered = reorderedCoreTokenSignature(left.text);
  const rightReordered = reorderedCoreTokenSignature(right.text);
  if (normalizedLeft !== normalizedRight && leftReordered && leftReordered === rightReordered) {
    reasons.push("핵심어 어순 변경 중복");
  }
  const leftPhrases = fourWordPhrases(styleWords(left.text, left.evidence));
  const rightPhrases = fourWordPhrases(styleWords(right.text, right.evidence));
  if ([...leftPhrases].some((phrase) => rightPhrases.has(phrase))) reasons.push("4단어 연속 중복");
  const similarity = commentAreaSimilarity(left, right);
  if (similarity >= 0.75) reasons.push(`표현 유사도 ${Math.round(similarity * 100)}%`);
  return reasons;
}

export function findCommentAreaOverlaps(input: {
  candidates: CommentAreaPart[];
  references: CommentAreaPart[];
}) {
  const accepted = [...input.references.filter((item) => item.text.trim())];
  const overlaps: CommentAreaOverlap[] = [];
  for (const candidate of input.candidates) {
    const comparable = accepted.filter((reference) => commentAreaGroupKey(reference) === commentAreaGroupKey(candidate));
    const ranked = comparable.map((reference) => ({
      reference,
      reasons: commentAreaOverlapReasons(candidate, reference),
      similarity: commentAreaSimilarity(candidate, reference),
    })).filter((item) => item.reasons.length)
      .sort((left, right) => right.similarity - left.similarity || right.reasons.length - left.reasons.length);
    if (ranked[0]) {
      overlaps.push({
        key: `${candidate.studentId}|${candidate.subject}|${candidate.assessmentIndex}`,
        referenceKey: `${ranked[0].reference.studentId}|${ranked[0].reference.subject}|${ranked[0].reference.assessmentIndex}`,
        reasons: ranked[0].reasons,
        similarity: ranked[0].similarity,
      });
    } else {
      accepted.push(candidate);
    }
  }
  return overlaps;
}
