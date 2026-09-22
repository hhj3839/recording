import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchLinkedPools } from '../app/linked-comment-pools.ts';
import { hasNaturalNominalEnding } from '../app/comment-generation-policy.ts';
import { POST as legacyPost } from '../app/api/generate-all-comments/route.ts';
import { hasAbilityStatement, ABILITY_STATEMENT_ISSUE } from '../app/ability-statement-policy.ts';
import { validateRecord } from '../app/record-validation.ts';
import { selectBehaviorCandidate, canPersistBehaviorDraft, assertStrictGeneratedBehaviors } from '../app/behavior-persistence-policy.ts';
import { approvePoolCandidates, buildCommentPoolSpecs, commentPoolQuality, commentPoolIsComplete } from '../app/comment-pool-library.ts';

test('linked refresh version wins and mismatched criteria are not allocated', () => {
  const specs = buildCommentPoolSpecs([{ id: 7, subject: '국어', unit: '대화', goal: '표현', domain: '말하기', perspective: '대화', high: '대화를 표현함.', middle: '대화를 표현함.', low: '대화를 표현함.' }]);
  const spec = specs[0];
  const version = { ...spec, id: 99, fingerprint: 'fresh-nonce' };
  const links = [{ assessment_plan_id: 7, pool_version_id: 99 }];
  assert.equal(matchLinkedPools(specs, links, [version]).get(spec.fingerprint)?.id, 99);
  assert.equal(matchLinkedPools(specs, links, [{ ...version, criterion: '다른 기준' }]).size, 0);
  assert.equal(matchLinkedPools(specs, [{ ...links[0], assessment_plan_id: 8 }], [version]).size, 0);
});

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

test('pool UI separates usable sentences, review candidates and incomplete groups', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /개 사용 가능 문장/);
  assert.match(page, /재검토 필요 <b>\{poolSummary.reviewCount\}/);
  assert.match(page, /제작 부족 <b>\{poolSummary.needsGeneration\}/);
  assert.doesNotMatch(page, /검수 제외/);
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

test('only sentence-final ability and possibility statements are excluded', () => {
  for (const text of ['문제를 해결할 수 있음.', '글을 쓸수있음.', '도형을 그릴 수가 있음.', '성장할 가능성이 있음.', '해결할 수 있음. 의견을 표현함.', '성장할 가능성이 있음! 활동에 참여함.', '활동에 참여함. 해결할 수 있음', '해결할 수 있음。']) assert.equal(hasAbilityStatement(text), true, text);
  for (const text of ['꾸준히 참여하려고 노력함.', '표현을 익힘.', '자신감이 있음.', '친구에게 박수 보냄.', '좋은 점수 있음.', '참여가 향상됨.', '가능성을 탐색함.']) assert.equal(hasAbilityStatement(text), false, text);
});

test('modifiers and embedded content remain usable for both comments and behaviors', () => {
  const [spec] = buildCommentPoolSpecs([{ id: 1, subject: '국어', unit: '쓰기', goal: '설명', domain: '쓰기', perspective: '자료 조사', high: '자료를 조사하여 설명함.', middle: '자료를 조사함.', low: '조사에 참여함.' }]);
  const normal = [
    '신뢰할 수 있는 자료를 찾아 출처를 밝히고 설명하는 글을 작성함.',
    '생활에서 실천할 수 있는 방법을 찾아 제안함.',
    '생활 모습이 달라질 수 있음을 파악함.',
    '다른 사람도 비슷한 감정을 느낄 수 있음을 이해함.',
    '변화할 가능성이 있음을 설명함.',
    '참여할 수 있으며 의견을 표현함.',
    '독자가 이용할 수 있도록 순서를 설명함.',
  ];
  for (const text of normal) {
    assert.equal(hasAbilityStatement(text), false, text);
    assert.equal(validateRecord(text, true).styleIssues.includes(ABILITY_STATEMENT_ISSUE), false, text);
  }
  assert.deepEqual(approvePoolCandidates(normal, spec).approved, normal);
  assert.equal(commentPoolQuality(normal).count, normal.length);
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

test('behavior stops excluded retries while pools refill within bounds and allocation skips old candidates', () => {
  const read = (path: string) => readFileSync(new URL('../app/' + path, import.meta.url), 'utf8');
  assert.match(read('api/behavior-jobs/run/route.ts'), /!excludedIds.has\(item.studentId\)/);
  assert.doesNotMatch(read('api/comment-pools/run/route.ts'), /if \(review.rejectedIssues.includes\(ABILITY_STATEMENT_ISSUE\)\) break/);
  assert.match(read('api/comment-pools/run/route.ts'), /attempt < maxAttempts && approved.length < COMMENT_POOL_TARGET/);
  assert.match(read('api/comment-jobs/run/route.ts'), /hasAbilityStatement\(row.sentence/);
  assert.match(read('api/comment-jobs/run/route.ts'), /hasAbilityStatement\(saved.sentence/);
  assert.match(read('api/generate-comment/route.ts'), /hasAbilityStatement\(row.sentence/);
});
