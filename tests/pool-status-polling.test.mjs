import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('pool summary and job polling share a latest-request guard', () => {
  assert.match(source, /const requestRef = fingerprint \? poolSentenceRequestRef : poolStatusRequestRef/);
  assert.match(source, /if \(requestId !== requestRef.current\) return/);
  assert.match(source, /if \(!fingerprint && requestId === requestRef.current\) \{\s+poolStatusPendingRef.current = false;\s+setPoolStatusLoading\(false\)/);
  assert.match(source, /disposed \|\| requestId !== poolStatusRequestRef.current/);
});

test('pool polling prevents overlap and aborts on effect cleanup', () => {
  const poll = source.slice(source.indexOf('let disposed = false;'), source.indexOf('const changePlan ='));
  assert.match(poll, /if \(inFlight \|\| poolStatusPendingRef.current\) return;\s+inFlight = true/);
  assert.match(poll, /signal: controller.signal/);
  assert.match(poll, /finally\(\(\) => \{ inFlight = false; \}\)/);
  assert.match(poll, /disposed = true;\s+controller.abort\(\);\s+window.clearInterval\(timer\)/);
});
