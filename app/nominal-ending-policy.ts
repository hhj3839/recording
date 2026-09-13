// A form check, not a grammar or meaning judgment. Preserve ㄹㅁ conjugations.
export function hasNominalEnding(sentence: string) {
  const last = sentence.trim().replace(/[.!?]+$/, "").at(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && [10, 16].includes((code - 0xac00) % 28);
}
