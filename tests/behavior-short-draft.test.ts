import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRecord } from '../app/record-validation.ts';
import { canPersistBehaviorDraft, assertStrictGeneratedBehaviors, selectBehaviorCandidate } from '../app/behavior-persistence-policy.ts';

test('generation asks for complete predicates and meaning-preserving self-review', () => {
  const source = readFileSync(new URL('../app/behavior-generation.ts', import.meta.url), 'utf8');
  assert.match(source, /각 문장이 행동이나 상태를 서술하는 완결된 문장인지 확인/);
  assert.match(source, /명사만 남은 종결과 의미가 겹치는 추상적 표현은 관찰 사실을 유지하며 자연스럽게 고친다/);
});

// Human quality-review fixtures: regex does not certify grammar or naturalness.
test('nominal-ending checks alone cannot certify natural complete sentences', () => {
  for (const text of ['이해를 스스로 다지려는 다짐.', '성장의 자람이 보임.']) {
    assert.equal(validateRecord(text, true).endingsOk, true);
  }
  assert.equal(validateRecord('책임 있게 생활하겠다고 다짐함.', true).endingsOk, true);
});

test('short draft saves without changing the visible length warning', () => {
  const behavior = '친구의 말을 경청하며 수업에 참여함.';
  const validation = validateRecord(behavior, true);
  assert.equal(validation.lengthOk, false);
  assert.equal(validation.valid, false);
  assert.equal(canPersistBehaviorDraft(validation), true);
  assert.doesNotThrow(() => assertStrictGeneratedBehaviors([{ studentId: 1, behavior }]));
});
test('shortness never bypasses other checks', () => {
  for (const behavior of ['', '친구와 대화한다.', '학원에서 배움을 익힘.', '항상 친구를 도움.', '역활을 수행함.', '수업에 참여함. 수업에 참여함.']) {
    assert.equal(canPersistBehaviorDraft(validateRecord(behavior, true)), false, behavior);
  }
  assert.equal(canPersistBehaviorDraft(validateRecord('가'.repeat(210) + '함.', true)), false);
});
test('saveable short candidate precedes a slightly overlong fallback', () => {
  const short = '친구와 협력함.';
  assert.equal(selectBehaviorCandidate(['가'.repeat(201) + '함.', short])?.behavior, short);
});
test('generation returns accepted short drafts instead of putting them in repair failures', () => {
  const source = readFileSync(new URL('../app/behavior-generation.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(canPersistBehaviorDraft\(validation\)\) return/);
  assert.match(source, /confirmed: false/);
});
