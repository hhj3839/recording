import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('active fresh jobs display their own versions without linked fallback', () => {
  const route = readFileSync(new URL('../app/api/comment-pools/route.ts', import.meta.url), 'utf8');
  const scope = route.slice(route.indexOf('const freshBatches ='), route.indexOf('const sentencesByVersion ='));
  assert.match(scope, /batch.freshOnly/);
  assert.match(scope, /versionById.clear\(\)/);
  assert.match(scope, /links.length = 0/);
  assert.match(scope, /created_by: eq\(user.id\)/);
  assert.match(scope, /spec.fingerprint === batch.spec.fingerprint/);
  assert.doesNotMatch(scope, /updateRows|upsertRows|DELETE/);
});
