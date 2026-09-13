import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
test('pool refill preserves accepted candidates and retries only the shortage', () => {
  const runner = read('../app/api/comment-pools/run/route.ts');
  assert.match(runner, /approvePoolCandidates\(rows.map/);
  assert.match(runner, /Math.min\(3, Number\(batch.maxAttempts\)\)/);
  assert.match(runner, /COMMENT_POOL_TARGET - approved.length/);
  assert.match(runner, /generateCandidates\(batch.spec, approved, requestCount\)/);
  assert.doesNotMatch(runner, /rejectedIssues.includes.*break/);
  assert.match(runner, /failed = !complete/);
});
test('new jobs get three calls while old jobs keep their saved limit', () => {
  const route = read('../app/api/comment-pools/route.ts');
  assert.doesNotMatch(route, /maxAttempts: 2/);
  assert.match(route, /maxAiCalls: batches.length \* 3/);
  assert.match(read('../app/api/comment-pools/run/route.ts'), /Number\(batch.maxAttempts\)\)\) : 2/);
});
