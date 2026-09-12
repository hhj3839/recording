import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trialAccess, POOL_TRIAL, claimAndRunTrial } from '../app/comment-pool-trial.ts';
import { trialResponse } from '../app/comment-pool-trial-response.ts';
const now = Date.parse('2026-09-12T00:00:00+09:00');
test('response respects Accept exclusions, weights and case', () => {
  for (const accept of ['application/json, text/html;q=0', 'text/html;q=0.5, application/json', '*/*', 'text/html;q=0, */*;q=1']) {
    assert.match(trialResponse({}, 200, accept).headers.get('content-type')!, /application\/json/);
  }
  for (const accept of ['TEXT/HTML', 'text/html;q=0.9, application/json;q=0.5', 'text/html, */*;q=0.8']) {
    assert.match(trialResponse({}, 200, accept).headers.get('content-type')!, /text\/html/);
  }
});
test('form results render safe HTML, while API results retain JSON', async () => {
  const payload = { candidates: ['<script>alert(1)</script>'], before: ['기존 문장임.'], elapsedMs: 8000 };
  const html = trialResponse(payload, 200, 'text/html,application/xhtml+xml');
  assert.match(html.headers.get('content-type')!, /text\/html/);
  const body = await html.text();
  assert.match(body, /생성 완료 · 1문장 · 8초/);
  assert.match(body, /&lt;script&gt;/);
  assert.doesNotMatch(body, /<script>|<form/);
  assert.deepEqual(await trialResponse(payload).json(), payload);
  const error = trialResponse({error: '이미 실행됨'}, 409, 'text/html');
  assert.equal(error.status, 409);
  assert.match(await error.text(), /role="alert"/);
});
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
