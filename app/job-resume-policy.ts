// Runners have a 300-second maximum; never steal a live worker's lease.
export function canResumeJob(job: { status?: unknown; updated_at?: unknown }, now = Date.now()) {
  const updated = typeof job.updated_at === "string" ? Date.parse(job.updated_at) : NaN;
  if (!Number.isFinite(updated)) return false;
  const age = now - updated;
  return job.status === "queued" ? age >= 30_000 : job.status === "running" && age >= 360_000;
}
