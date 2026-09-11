import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trialAccess, POOL_TRIAL, claimAndRunTrial } from '../app/comment-pool-trial.ts';
const now = Date.parse('2026-09-12T00:00:00+09:00');
test('trial rejects unauthenticated, other users, cross-origin and expired requests', () => {
  assert.equal(trialAccess(undefined, null, now), 401);
  assert.equal(trialAccess('other@example.com', 'https://giroksam-recording.vercel.app', now), 403);
  assert.equal(trialAccess(POOL_TRIAL.email, null, now), 403);
  assert.equal(trialAccess(POOL_TRIAL.email, 'https://evil.example', now), 403);
  assert.equal(trialAccess(POOL_TRIAL.email, 'https://giroksam-recording.vercel.app', now), 200);
  assert.equal(trialAccess(POOL_TRIAL.email, 'https://giroksam-recording.vercel.app', Date.parse(POOL_TRIAL.expiresAt)), 410);
});
test('failed or concurrent claims cannot run a second paid call', async () => {
  let claimed = false; let calls = 0;
  const claim = async () => { if (claimed) throw new Error('duplicate'); claimed = true; };
  await Promise.allSettled(Array.from({ length: 8 }, () => claimAndRunTrial(claim, async () => { calls++; throw new Error('timeout'); })));
  assert.equal(calls, 1);
});
test('trial route cannot write candidates or student data, accepts no caller prompt', () => {
  const route = readFileSync(new URL('../app/api/comment-pools/trial/route.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /upsertRows|updateRows|request\.json|waitUntil/);
  assert.match(route, /insertRows\("generation_jobs"/);
  assert.match(route, /status: "cancelled", batches: \[\]/);
  assert.match(route, /store: false/);
  assert.match(route, /buildCommentPoolCandidatePrompt\(spec, \[\], POOL_TRIAL.count\)/);
  assert.equal((route.match(/fetch\("https:\/\/api.openai.com/g) || []).length, 1);
});
