// One approved comparison, not a reusable generation API.
export const POOL_TRIAL = {
  id: "86fd1194-72b4-4529-967a-ceaa84a219cf",
  email: "dlddu3839@gmail.com",
  classId: 29,
  planId: 272,
  subject: "영어",
  domain: "이해",
  level: "중",
  count: 20,
  expiresAt: "2026-09-14T00:00:00+09:00",
} as const;

export function trialAccess(email: string | undefined, origin: string | null, now = Date.now()) {
  if (now >= Date.parse(POOL_TRIAL.expiresAt)) return 410;
  if (!email) return 401;
  if (email.toLowerCase() !== POOL_TRIAL.email) return 403;
  if (origin !== "https://giroksam-recording.vercel.app") return 403;
  return 200;
}

export async function claimAndRunTrial<T>(claim: () => Promise<void>, run: () => Promise<T>) {
  // A DB primary-key claim must succeed before any paid call. Never retry or release it,
  // even on timeout/unknown completion: the approved budget is ONE call globally.
  await claim();
  return run();
}
