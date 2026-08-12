import assert from "node:assert/strict";
import test from "node:test";
import { commentAreaIssuesForDisplay, composeGeneratedCommentCandidate, evidenceGroundingWarnings, hasCompleteEvidenceCoverage, normalizeGeneratedCommentCandidate, openingRepetitionRate, replaceSelectedCommentText, validateGeneratedComment, validateGeneratedCommentPart } from "../app/comment-generation-policy.ts";
import { behaviorRepairInstruction, behaviorRepairPlan } from "../app/behavior-repair-policy.ts";
import { assertStrictGeneratedBehaviors } from "../app/behavior-persistence-policy.ts";
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

test("normalizes only candidates that meet the strict 50 to 60 character gate", () => {
  const strict = "글의 중심 생각을 정확하게 파악하고 중요한 내용을 근거와 함께 정리하여 발표 활동에 꾸준히 참여함.";
  assert.equal(normalizeGeneratedCommentCandidate(strict), strict);
  const short = Array.from(strict).slice(5).join("");
  const normalized = normalizeGeneratedCommentCandidate(short);
  assert.equal(Array.from(normalized).length >= 50 && Array.from(normalized).length <= 60, true);
  assert.equal(normalized.endsWith("함."), true);
});

test("rejects missing areas, invalid length, endings, and forbidden expressions", () => {
  assert.equal(validateGeneratedComment("평가 활동에 참여함.", 2).valid, false);
  const forbidden = "학습 내용의 이해가 부족함. 학습 활동에 참여하여 배운 내용을 꾸준하게 연습하고 적용하는 태도를 형성함.";
  assert.equal(validateGeneratedComment(forbidden, 2).valid, false);
});

test("rejects mechanically duplicated nominal endings", () => {
  for (const ending of ["참여함함.", "표현하고함.", "표현하고 함.", "나타내며함.", "나타내며 함.", "마음을 담아함.", "내용을 익혀 감함."]) {
    const awkward = `수업에서 작품의 중심 내용을 정확하게 파악하고 중요한 근거를 찾아 발표 활동에 ${ending}`;
    const result = validateGeneratedComment(awkward, 1);
    assert.equal(result.naturalEndingsOk, false);
    assert.equal(result.valid, false);
  }
});

test("rejects dangling connective bodies before composing a generated ending", () => {
  for (const body of ["자료를 정확하게 분류하고", "의견을 자연스럽게 나타내며", "작품에 마음을 담아", "배운 내용을 익혀 감", "활동에 참여함"]) {
    assert.equal(composeGeneratedCommentCandidate(body, "설명함."), "");
  }
  assert.equal(composeGeneratedCommentCandidate("자료의 특징을 기준에 따라 정확하게", "분류함."), "자료의 특징을 기준에 따라 정확하게 분류함.");
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
  assert.deepEqual(
    evidenceGroundingWarnings(
      "글의 의미를 파악하고 스스로 논리적으로 설명함.",
      "글에서 중요한 내용을 찾아 설명할 수 있다.",
    ),
    [
      "평가 근거에 없는 ‘의미를 파악’ 표현 확인 필요",
      "평가 근거에 없는 ‘스스로’ 표현 확인 필요",
      "평가 근거에 없는 ‘논리적으로’ 표현 확인 필요",
    ],
  );
  assert.deepEqual(
    evidenceGroundingWarnings(
      "글의 의미를 파악하고 모둠원과 협력하여 설명함.",
      "글의 의미를 파악하고 모둠원과 협력하여 설명할 수 있다.",
    ),
    [],
  );
});

test("grounds attitude concepts across common Korean spacing and inflection variants", () => {
  assert.deepEqual(
    evidenceGroundingWarnings(
      "자료를 자발적으로 살피고 친구들과 협동해 효과적으로 분류함.",
      "자료를 기준에 따라 분류할 수 있다.",
    ),
    [
      "평가 근거에 없는 ‘친구와 협력’ 표현 확인 필요",
      "평가 근거에 없는 ‘스스로’ 표현 확인 필요",
      "평가 근거에 없는 ‘효과적으로’ 표현 확인 필요",
    ],
  );
  assert.deepEqual(
    evidenceGroundingWarnings(
      "모둠원과 협력해 자료의 의미를 이해하고 적극적인 태도로 설명함.",
      "모둠 활동에서 협동하여 자료의 의미를 파악하고 적극적으로 설명할 수 있다.",
    ),
    [],
  );
  assert.deepEqual(
    evidenceGroundingWarnings(
      "자료를 자기 주도적으로 정리함.",
      "자료를 기준에 따라 정리할 수 있다.",
    ),
    ["평가 근거에 없는 ‘자기주도적으로’ 표현 확인 필요"],
  );
});

test("does not show sentence length as an area review issue", () => {
  assert.deepEqual(
    commentAreaIssuesForDisplay("warning", ["권장 50~60자 범위를 벗어난 49자 문장"]),
    [],
  );
  assert.deepEqual(
    commentAreaIssuesForDisplay("warning", [
      "권장 50~60자 범위를 벗어난 61자 문장",
      "평가 근거에 없는 ‘적극적으로’ 표현 확인 필요",
    ]),
    ["평가 근거에 없는 ‘적극적으로’ 표현 확인 필요"],
  );
  assert.deepEqual(
    commentAreaIssuesForDisplay("needs_review", ["AI 생성이 완료되지 않아 교사 확인이 필요함"]),
    ["AI 생성이 완료되지 않아 교사 확인이 필요함"],
  );
});

test("replaces the exact selected range even when the same phrase is repeated", () => {
  const current = "자료를 분류함. 자료를 분류함.";
  const secondStart = current.lastIndexOf("자료를 분류함.");
  assert.equal(
    replaceSelectedCommentText(current, "자료의 특징을 설명함.", secondStart, current.length),
    "자료를 분류함. 자료의 특징을 설명함.",
  );
  assert.equal(replaceSelectedCommentText(current, "교체", -1, 2), null);
  assert.equal(replaceSelectedCommentText(current, "교체", 3, 3), null);
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

test("turns behavior byte gaps into concrete Korean syllable repair instructions", () => {
  assert.deepEqual(behaviorRepairPlan(495), {
    bytes: 495, targetBytes: 515, byteDelta: 20, syllables: 7, direction: "add",
  });
  assert.deepEqual(behaviorRepairPlan(589), {
    bytes: 589, targetBytes: 535, byteDelta: -54, syllables: 18, direction: "remove",
  });
  assert.match(behaviorRepairInstruction(495), /약 7음절.*20바이트.*추가.*515바이트/);
  assert.match(behaviorRepairInstruction(589), /약 18음절.*54바이트.*삭제.*535바이트/);
  assert.match(behaviorRepairInstruction(525), /기준을 충족.*길이와 핵심 사실을 유지/);
});

test("keeps behavior repair targets stable across byte boundaries and large misses", () => {
  assert.deepEqual(
    [0, 430, 499, 500, 525, 550, 551, 625].map((bytes) => behaviorRepairPlan(bytes)),
    [
      { bytes: 0, targetBytes: 515, byteDelta: 515, syllables: 172, direction: "add" },
      { bytes: 430, targetBytes: 515, byteDelta: 85, syllables: 28, direction: "add" },
      { bytes: 499, targetBytes: 515, byteDelta: 16, syllables: 5, direction: "add" },
      { bytes: 500, targetBytes: 500, byteDelta: 0, syllables: 0, direction: "none" },
      { bytes: 525, targetBytes: 525, byteDelta: 0, syllables: 0, direction: "none" },
      { bytes: 550, targetBytes: 550, byteDelta: 0, syllables: 0, direction: "none" },
      { bytes: 551, targetBytes: 535, byteDelta: -16, syllables: 5, direction: "remove" },
      { bytes: 625, targetBytes: 535, byteDelta: -90, syllables: 30, direction: "remove" },
    ],
  );
});

test("limits behavior length repair to fact-preserving local edits", () => {
  const shortInstruction = behaviorRepairInstruction(495);
  assert.match(shortInstruction, /이미 언급된 행동의 방법·과정만 구체화/);
  assert.match(shortInstruction, /새 활동·인물·성과·태도는 만들지 않음/);
  assert.match(shortInstruction, /문장 전체를 다시 쓰거나 순서를 바꾸지 말고/);

  const longInstruction = behaviorRepairInstruction(589);
  assert.match(longInstruction, /중복 연결어·수식어만 줄이고/);
  assert.match(longInstruction, /관찰 사실·성장 표현·문장 수는 삭제하지 않음/);
});

test("blocks behavior candidates outside the strict byte range from persistence", () => {
  const behaviorAtLeast = (targetBytes: number) => {
    let text = "성장";
    while (new TextEncoder().encode(`${text}함.`).length < targetBytes) text += "가";
    return `${text}함.`;
  };
  const strict = { studentId: 17, characteristic: "성장 모습: 꾸준히 노력함", behavior: behaviorAtLeast(525) };
  const tooLong = { studentId: 21, characteristic: "성장 모습: 꾸준히 노력함", behavior: behaviorAtLeast(556) };

  assert.deepEqual(assertStrictGeneratedBehaviors([strict]), [strict]);
  assert.throws(
    () => assertStrictGeneratedBehaviors([strict, tooLong]),
    /엄격 검수를 통과하지 못한 행동특성은 저장할 수 없습니다: 21/,
  );
});
