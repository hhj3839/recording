import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRecord } from '../app/record-validation.ts';
import { canPersistBehaviorDraft, assertStrictGeneratedBehaviors, selectBehaviorCandidate } from '../app/behavior-persistence-policy.ts';

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
