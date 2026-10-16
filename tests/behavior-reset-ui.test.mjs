import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('behavior reset requires an explicit scope before any deletion request', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const reset = page.slice(page.indexOf('const clearBehaviors ='), page.indexOf('const copyBehaviors ='));
  assert.match(reset, /await ui\.choose/);
  const guard = reset.indexOf('if (scope !== "results" && scope !== "all") return;');
  assert.ok(guard >= 0 && guard < reset.indexOf('await fetch('));
  assert.match(reset, /const removeSources = scope === "all"/);
  assert.match(reset, /scope: removeSources \? "all" : "results"/);
  assert.doesNotMatch(reset, /await ui\.confirm/);
});
