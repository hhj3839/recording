import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
test('recovery notice keeps technical details collapsed and offers one clear action', () => {
  const notice = read('../app/pool-recovery-notice.tsx');
  assert.match(notice, /<details><summary>오류 상세/);
  assert.doesNotMatch(notice, /<details open/);
  assert.match(notice, /확인 후 이어서 제작/);
  assert.match(notice, /저장 응답이 지연돼 완료 여부를 확인하지 못했어요/);
  const page = read('../app/page.tsx');
  assert.match(page, /poolSummary.needsGeneration > 0 && !showPoolRecovery/);
  assert.match(page, /poolJob.freshOnly && poolJob.status === "completed_with_errors"/);
});
test('retry checks saved rows before scheduling paid generation', () => {
  const route = read('../app/api/comment-pools/route.ts');
  const retry = route.slice(route.indexOf('if (body.retryFailed === true)'), route.indexOf('if (fullRefresh && body.labOnly'));
  assert.ok(retry.indexOf('await approvedPoolRows(ids)') < retry.indexOf('insertRows'));
  assert.match(retry, /!commentPoolIsComplete/);
});
