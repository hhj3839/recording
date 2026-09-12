import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
test('behavior review includes server style issues', () => {
  const review = page.slice(page.indexOf('const behaviorReviewIssues ='), page.indexOf('const behaviorReviewIssues =') + 1200);
  assert.match(review, /\.\.\.validation\.styleIssues/);
});
test('behavior review only reports length outside 500–600B', () => {
  assert.doesNotMatch(page, /preferredLengthAdvisory|권장 550B 초과/);
  assert.match(page, /validation\.bytes < 500/);
  assert.match(page, /validation\.bytes > 600/);
});
test('empty eligibility explains the required assessment input', () => {
  assert.match(page, /eligibleCount === 0 \? "평가수준을 먼저 입력하세요\."/);
});
