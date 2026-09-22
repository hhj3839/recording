export const ABILITY_STATEMENT_ISSUE = "가능·능력 표현 후보 제외";

// Check sentence endings only; preserve modifiers and embedded learning content.
export function hasAbilityStatement(text: string) {
  const normalized = text.normalize("NFKC");
  if (/가능성\s*(?:이|은|도)?\s*있음\s*(?=[.!?。！？]|$)/u.test(normalized)) return true;
  return [...normalized.matchAll(/([가-힣])\s*수\s*(?:가|는|도)?\s*있음\s*(?=[.!?。！？]|$)/gu)]
    .some((match) => (match[1].charCodeAt(0) - 0xac00) % 28 === 8);
}
