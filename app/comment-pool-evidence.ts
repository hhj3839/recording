export type CommentPoolEvidenceInput = {
  goal: string;
  perspective: string;
  assessmentType?: string;
  caution?: string;
  criterion: string;
};

export type CommentPoolEvidenceItem = {
  id: string;
  role: "required" | "goal" | "perspective" | "activity" | "method";
  label: string;
  text: string;
  usable: boolean;
};

const splitEvidence = (value: string) => value
  .split(/(?:\s*\/\s*|[?？]\s*|\r?\n+|\s*[·ㆍ•]\s*)/)
  .map((item) => item.replace(/^[-–—]\s*/, "").trim())
  .filter((item) => item.length >= 4 && item !== "미입력");

const semanticKey = (value: string) => value.normalize("NFKC")
  .replace(/[^가-힣A-Za-z0-9]/g, "")
  .replace(/(?:할수있는가|할수있다|하는가|한다|하다|할수있음|할수있|함|됨|임|음)$/g, "");

export function compileCommentPoolEvidence(input: CommentPoolEvidenceInput) {
  const candidates: Array<Omit<CommentPoolEvidenceItem, "id">> = [
    { role: "required" as const, label: "선택 수준 수행", text: input.criterion.trim(), usable: true },
    ...splitEvidence(input.perspective).map((text) => ({ role: "perspective" as const, label: "평가관점", text, usable: true })),
    ...splitEvidence(input.caution ?? "").map((text) => ({ role: "activity" as const, label: "수업·평가 활동", text, usable: true })),
    ...splitEvidence(input.goal).map((text) => ({ role: "goal" as const, label: "평가목표", text, usable: false })),
    ...splitEvidence(input.assessmentType ?? "").map((text) => ({ role: "method" as const, label: "평가방법", text, usable: false })),
  ].filter((item) => item.text);
  const unique: Array<Omit<CommentPoolEvidenceItem, "id">> = [];
  for (const candidate of candidates) {
    const key = semanticKey(candidate.text);
    const duplicated = unique.some((item) => {
      const existing = semanticKey(item.text);
      return key === existing || (Math.min(key.length, existing.length) >= 12 && (key.includes(existing) || existing.includes(key)));
    });
    if (!duplicated || candidate.role === "required") unique.push(candidate);
  }
  const items = unique.map((item, index) => ({ ...item, id: `E${index + 1}` }));
  const usableItems = items.filter((item) => item.usable);
  return {
    items,
    requiredId: items.find((item) => item.role === "required")?.id ?? "E1",
    combinationTarget: usableItems.length >= 2 ? 2 : 1,
    planEvidence: usableItems.map((item) => `${item.label}: ${item.text}`).join(" | "),
    allowedActivityEvidence: usableItems.filter((item) => ["perspective", "activity"].includes(item.role))
      .map((item) => item.text).join(" | "),
  };
}

const evidenceStopwords = new Set(["학생", "평가", "수업", "활동", "내용", "결과", "자료", "알맞게", "적절하게"]);

function evidenceKeywords(value: string) {
  return [...new Set(value.normalize("NFKC").split(/[^가-힣A-Za-z0-9]+/)
    .map((word) => word.replace(/(?:할수있는가|할수있다|하는가|하여|하고|하며|하기|함|한다|하다|에서|으로|에게|까지|부터|은|는|이|가|을|를)$/g, ""))
    .filter((word) => word.length >= 2 && !evidenceStopwords.has(word)))];
}

export function commentReflectsPoolEvidence(comment: string, item: CommentPoolEvidenceItem) {
  if (item.role === "required") return true;
  const normalizedComment = comment.normalize("NFKC").replace(/[^가-힣A-Za-z0-9]/g, "");
  const keywords = evidenceKeywords(item.text);
  const requiredMatches = Math.min(2, keywords.length);
  return requiredMatches > 0 && keywords.filter((keyword) => normalizedComment.includes(keyword)).length >= requiredMatches;
}

export function validCommentPoolEvidenceIds(comment: string, evidenceIds: string[], compiled: ReturnType<typeof compileCommentPoolEvidence>) {
  const uniqueIds = [...new Set(evidenceIds)];
  const byId = new Map(compiled.items.map((item) => [item.id, item]));
  if (!uniqueIds.includes(compiled.requiredId) || uniqueIds.some((id) => !byId.get(id)?.usable)) return false;
  const roles = new Set(uniqueIds.map((id) => byId.get(id)?.role).filter(Boolean));
  return uniqueIds.length >= compiled.combinationTarget
    && roles.size >= compiled.combinationTarget
    && uniqueIds.every((id) => commentReflectsPoolEvidence(comment, byId.get(id)!));
}
