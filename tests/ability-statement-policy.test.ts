import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasNaturalNominalEnding } from '../app/comment-generation-policy.ts';
import { POST as legacyPost } from '../app/api/generate-all-comments/route.ts';
import { hasAbilityStatement, ABILITY_STATEMENT_ISSUE } from '../app/ability-statement-policy.ts';
import { validateRecord } from '../app/record-validation.ts';
import { selectBehaviorCandidate, canPersistBehaviorDraft, assertStrictGeneratedBehaviors } from '../app/behavior-persistence-policy.ts';
import { approvePoolCandidates, buildCommentPoolSpecs, commentPoolQuality, commentPoolIsComplete } from '../app/comment-pool-library.ts';

test('comment and behavior share nominal conjugation checks without rewriting', () => {
  for (const text of ['자료를 만듦.', '방법을 앎.', '표현을 익힘.', '활동에 참여함.']) {
    assert.equal(hasNaturalNominalEnding(text), true);
    assert.equal(validateRecord(text, true).endingsOk, true);
    assert.equal(validateRecord(text).endingsOk, true);
  }
  for (const text of ['', '활동에 참여한다.']) {
    assert.equal(hasNaturalNominalEnding(text), false);
    assert.equal(validateRecord(text, true).endingsOk, false);
  }
  assert.equal(validateRecord('활동에 참여할 수 있음.', true).valid, false);
});

test('legacy generation endpoint returns gone without AI or persistence code', async () => {
  const response = await legacyPost();
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, 'LEGACY_GENERATION_RETIRED');
  const source = readFileSync(new URL('../app/api/generate-all-comments/route.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|upsertRows|archiveComment|OPENAI_API_KEY/);
});

test('particle variants use the same exclusion rule', () => {
  for (const text of ['해결할 수도 있음.', '해결할 수는 있음.', '성장할 가능성도 있음.', '성장할 가능성은 있음.']) assert.equal(hasAbilityStatement(text), true, text);
});

test('display count and completion exclude unusable stored candidates', () => {
  const bad = Array.from({ length: 20 }, (_, i) => `${i}번 문제를 해결할 수 있음.`);
  assert.equal(commentPoolQuality(bad).count, 0);
  assert.equal(commentPoolIsComplete(bad), false);
  const normal = Array.from({ length: 20 }, (_, i) => `${i}번 문제를 해결함.`);
  assert.equal(commentPoolIsComplete(normal), true);
  assert.equal(commentPoolQuality([...bad, ...normal.slice(0, 19)]).count, 19);
  assert.equal(commentPoolIsComplete([...bad, ...normal.slice(0, 19)]), false);
});

test('only ability and possibility families are excluded, including connected clauses', () => {
  for (const text of ['문제를 해결할 수 있음.', '글을 쓸수있음.', '도형을 그릴 수가 있음.', '성장할 가능성이 있음.', '참여할 수 있으며 의견을 표현함.']) assert.equal(hasAbilityStatement(text), true, text);
  for (const text of ['꾸준히 참여하려고 노력함.', '표현을 익힘.', '자신감이 있음.', '친구에게 박수 보냄.', '좋은 점수 있음.', '참여가 향상됨.', '가능성을 탐색함.']) assert.equal(hasAbilityStatement(text), false, text);
});

test('behavior chooses a valid alternative and never persists the excluded candidate', () => {
  const bad = '활동에 참여할 수 있음.';
  const good = '활동에 꾸준히 참여함.';
  assert.equal(selectBehaviorCandidate([bad, good])?.behavior, good);
  assert.equal(canPersistBehaviorDraft(validateRecord(bad, true)), false);
  assert.throws(() => assertStrictGeneratedBehaviors([{ studentId: 1, behavior: bad }]));
  assert.equal(canPersistBehaviorDraft(selectBehaviorCandidate([bad])!.validation), false);
});

test('pool excludes bad candidates without rewriting and retains normal alternatives', () => {
  const [spec] = buildCommentPoolSpecs([{ id: 1, subject: '국어', unit: '대화', goal: '표현', domain: '말하기', perspective: '대화', high: '대화를 표현함.', middle: '대화를 표현함.', low: '대화를 표현함.' }]);
  const bad = '인물의 대화를 표현할 수 있음.';
  const good = '인물의 대화를 실감 나게 표현함.';
  const review = approvePoolCandidates([bad, good], spec);
  assert.deepEqual(review.approved, [good]);
  assert.ok(review.rejectedIssues.includes(ABILITY_STATEMENT_ISSUE));
  assert.deepEqual(approvePoolCandidates([bad], spec).approved, []);
});

test('job routes stop paid retries for excluded candidates and allocation skips old candidates', () => {
  const read = (path: string) => readFileSync(new URL('../app/' + path, import.meta.url), 'utf8');
  assert.match(read('api/behavior-jobs/run/route.ts'), /!excludedIds.has\(item.studentId\)/);
  assert.match(read('api/comment-pools/run/route.ts'), /if \(review.rejectedIssues.includes\(ABILITY_STATEMENT_ISSUE\)\) break/);
  assert.match(read('api/comment-jobs/run/route.ts'), /hasAbilityStatement\(row.sentence/);
  assert.match(read('api/comment-jobs/run/route.ts'), /hasAbilityStatement\(saved.sentence/);
  assert.match(read('api/generate-comment/route.ts'), /hasAbilityStatement\(row.sentence/);
});
