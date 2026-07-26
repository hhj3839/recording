import assert from "node:assert/strict";
import test from "node:test";
import { hasCompleteEvidenceCoverage, validateGeneratedComment } from "../app/comment-generation-policy.ts";
import { generationModel } from "../app/ai-model-policy.ts";

test("uses GPT-5.4 mini first and Terra only for the final retry", () => {
  assert.equal(generationModel(0, 3), "gpt-5.4-mini");
  assert.equal(generationModel(1, 3), "gpt-5.4-mini");
  assert.equal(generationModel(2, 3), "gpt-5.6-terra");
});

test("accepts coverage only when every expected assessment item is present", () => {
  assert.equal(hasCompleteEvidenceCoverage(["e1", "e2", "e3"], ["e3", "e1", "e2"]), true);
});

test("rejects a generated comment when any assessment item is omitted", () => {
  assert.equal(hasCompleteEvidenceCoverage(["e1", "e2", "e3"], ["e1", "e3"]), false);
});

test("rejects unknown or duplicated coverage identifiers", () => {
  assert.equal(hasCompleteEvidenceCoverage(["e1", "e2"], ["e1", "e2", "e3"]), false);
  assert.equal(hasCompleteEvidenceCoverage(["e1", "e2"], ["e1", "e1", "e2"]), false);
});

test("accepts one 50 to 60 character sentence per assessment area ending in 함", () => {
  const sentence = "글의 중심 생각을 정확하게 파악하고 중요한 내용을 근거와 함께 정리하여 발표 활동에 꾸준히 참여함.";
  assert.equal(Array.from(sentence).length >= 50 && Array.from(sentence).length <= 60, true);
  const result = validateGeneratedComment(`${sentence} ${sentence}`, 2);
  assert.equal(result.valid, true);
});

test("rejects missing areas, invalid length, endings, and forbidden expressions", () => {
  assert.equal(validateGeneratedComment("평가 활동에 참여함.", 2).valid, false);
  const forbidden = "학습 내용의 이해가 부족함. 학습 활동에 참여하여 배운 내용을 꾸준하게 연습하고 적용하는 태도를 형성함.";
  assert.equal(validateGeneratedComment(forbidden, 2).valid, false);
});
