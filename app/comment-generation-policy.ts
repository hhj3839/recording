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
