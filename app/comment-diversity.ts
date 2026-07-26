type CommentWithCandidates = {
  studentId: number;
  subject: string;
  comment: string;
  candidates: string[];
};

const similarityWords = (value: string) =>
  new Set(value.replace(/[.,!?()[\]{}]/g, " ").split(/\s+/).map((word) => word.trim()).filter((word) => word.length > 1));

const similarity = (left: string, right: string) => {
  const leftWords = similarityWords(left);
  const rightWords = similarityWords(right);
  if (leftWords.size < 5 || rightWords.size < 5) return 0;
  const commonCount = [...leftWords].filter((word) => rightWords.has(word)).length;
  const unionCount = new Set([...leftWords, ...rightWords]).size;
  return unionCount ? commonCount / unionCount : 0;
};

const highestSimilarity = (candidate: string, references: string[]) =>
  references.reduce((highest, reference) => Math.max(highest, similarity(candidate, reference)), 0);

export function selectMostDiverseComments<T extends CommentWithCandidates>(comments: T[], avoidComments: string[]): T[] {
  const references = avoidComments.filter(Boolean);
  return comments.map((item) => {
    const candidates = [...new Set(item.candidates.map((candidate) => candidate.trim()).filter(Boolean))];
    if (!candidates.length) return item;
    const ranked = candidates
      .map((candidate, index) => ({ candidate, index, score: highestSimilarity(candidate, references) }))
      .sort((left, right) => left.score - right.score || left.index - right.index);
    const selected = ranked[0].candidate;
    references.push(selected);
    return {
      ...item,
      comment: selected,
      candidates: [selected, ...candidates.filter((candidate) => candidate !== selected)],
    };
  });
}
