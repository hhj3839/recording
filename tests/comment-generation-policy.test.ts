import assert from "node:assert/strict";
import test from "node:test";
import { evidenceGroundingWarnings, hasCompleteEvidenceCoverage, openingRepetitionRate, validateGeneratedComment, validateGeneratedCommentPart } from "../app/comment-generation-policy.ts";
import { generationModel } from "../app/ai-model-policy.ts";
import { batchCommentsBySubject, COMMENT_BATCH_SIZE } from "../app/comment-batching.ts";
import { batchBehaviors, BEHAVIOR_BATCH_SIZE } from "../app/behavior-batching.ts";
import { estimateAiCostUsd } from "../app/ai-pricing.ts";

test("uses the same low-cost model for the initial request and retry", () => {
  assert.equal(generationModel(0, 2), "gpt-5.4-mini");
  assert.equal(generationModel(1, 2), "gpt-5.4-mini");
});

test("estimates token cost with cached input pricing", () => {
  const cost = estimateAiCostUsd({
    model: "gpt-5.4-mini",
    inputTokens: 1_000_000,
    cachedInputTokens: 500_000,
    outputTokens: 100_000,
  });
  assert.equal(cost, 0.8625);
  assert.equal(estimateAiCostUsd({ model: "unknown", inputTokens: 100 }), null);
});

test("batches at most five students without mixing subjects", () => {
  const inputs = [
    ...Array.from({ length: 12 }, (_, index) => ({ subject: "국어", studentId: index + 1 })),
    ...Array.from({ length: 6 }, (_, index) => ({ subject: "수학", studentId: index + 1 })),
  ];
  const batches = batchCommentsBySubject(inputs);
  assert.equal(COMMENT_BATCH_SIZE, 5);
  assert.deepEqual(batches.map((batch) => batch.length), [5, 5, 2, 5, 1]);
  assert.equal(batches.every((batch) => new Set(batch.map((item) => item.subject)).size === 1), true);
});

test("batches at most five behavior records", () => {
  const batches = batchBehaviors(Array.from({ length: 12 }, (_, index) => ({ studentId: index + 1 })));
  assert.equal(BEHAVIOR_BATCH_SIZE, 5);
  assert.deepEqual(batches.map((batch) => batch.length), [5, 5, 2]);
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

test("rejects mechanically duplicated nominal endings", () => {
  for (const ending of ["참여함함.", "표현하고함.", "나타내며함.", "마음을 담아함.", "내용을 익혀 감함."]) {
    const awkward = `수업에서 작품의 중심 내용을 정확하게 파악하고 중요한 근거를 찾아 발표 활동에 ${ending}`;
    const result = validateGeneratedComment(awkward, 1);
    assert.equal(result.naturalEndingsOk, false);
    assert.equal(result.valid, false);
  }
});

test("shows near-miss lengths while keeping them as teacher-review warnings", () => {
  const base = "글의 중심 생각을 정확하게 파악하고 중요한 내용을 근거와 함께 정리하여 발표 활동에 꾸준히 참여함.";
  const sentence49 = Array.from(base).slice(0, 46).join("").replace(/[.]*$/, "") + " 참여함.";
  const result = validateGeneratedCommentPart(sentence49);
  if (Array.from(sentence49).length >= 48 && Array.from(sentence49).length <= 62) {
    assert.equal(result.valid, true);
    assert.equal(result.warnings.length > 0, Array.from(sentence49).length < 50 || Array.from(sentence49).length > 60);
  }
});

test("warns about unsupported attitude claims without discarding the sentence", () => {
  assert.deepEqual(
    evidenceGroundingWarnings("자료를 친구와 협력하여 적극적으로 분류함.", "자료를 기준에 따라 분류할 수 있다."),
    ["평가 근거에 없는 ‘적극적으로’ 표현 확인 필요", "평가 근거에 없는 ‘친구와 협력’ 표현 확인 필요"],
  );
  assert.deepEqual(evidenceGroundingWarnings("자료를 적극적으로 분류함.", "자료를 적극적으로 분류할 수 있다."), []);
});

test("measures repeated opening phrases across a class", () => {
  assert.equal(openingRepetitionRate(["자료의 특징을 살펴봄.", "자료의 특징을 살펴봄.", "배운 원리를 적용함."]), 1 / 3);
  assert.equal(openingRepetitionRate(["한 문장뿐임."]), 0);
});

test("keeps behavior repair context serializable for minimal revision", () => {
  const repair = {
    studentId: 1,
    characteristic: "책임감: 맡은 역할을 끝까지 수행함",
    repairHint: "현재 495바이트 · 목표 515~535바이트",
    previousBehavior: "맡은 역할을 책임감 있게 수행함.",
  };
  const restored = JSON.parse(JSON.stringify(repair));
  assert.equal(restored.previousBehavior, repair.previousBehavior);
  assert.match(restored.repairHint, /515~535/);
});
