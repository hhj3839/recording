import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const start = source.slice(source.indexOf('const startPoolProduction ='), source.indexOf('const resetPoolLinks ='));

test('fresh production uses page confirmation, not unsupported browser dialogs', () => {
  assert.doesNotMatch(start, /window\.(prompt|confirm)/);
  assert.match(source, /aria-label="전체 새로 제작 확인"/);
  assert.match(source, /유료 전체 새 제작 시작/);
  assert.match(start, /fullRefresh: true, sharedPlanName/);
});

test('start errors are visible in the AI panel and active jobs prevent new starts', () => {
  assert.match(start, /\["queued", "running"\]\.includes\(poolJob.status\)/);
  assert.match(start, /setPoolStartError\(error instanceof Error/);
  assert.match(source, /poolStartError && <div[^>]*role="alert"/);
});
