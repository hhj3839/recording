import assert from "node:assert/strict";
import test from "node:test";
import { commentAreaIssuesForDisplay, commentEvidenceInstructions, commentLengthTarget, composeGeneratedCommentCandidate, criterionToSafeNominalCandidates, criterionToSafeNominalSentence, ensureGeneratedCommentPeriod, evidenceBlockingIssues, evidenceGroundingWarnings, generatedCommentFailureMessage, hasCompleteEvidenceCoverage, hasNaturalNominalEnding, levelAppropriatenessIssues, normalizeGeneratedCommentCandidate, normalizeGeneratedCommentWhitespace, openingRepetitionRate, positiveGrowthCriterion, repairSafeNominalEnding, replaceSelectedCommentText, resolveGeneratedEvidenceItemId, validateGeneratedComment, validateGeneratedCommentPart } from "../app/comment-generation-policy.ts";
import { behaviorRepairInstruction, behaviorRepairPlan, behaviorRepairTargets } from "../app/behavior-repair-policy.ts";
import { assertStrictGeneratedBehaviors, selectBehaviorCandidate } from "../app/behavior-persistence-policy.ts";
import { validateRecord } from "../app/record-validation.ts";
import { generationModel } from "../app/ai-model-policy.ts";
import { batchCommentRepairs, batchCommentsByAssessmentArea, COMMENT_BATCH_SIZE, COMMENT_REPAIR_EVIDENCE_BATCH_SIZE, MAX_COMMENT_AI_CALLS_PER_BATCH, MAX_COMMENT_DIVERSITY_CALLS_PER_BATCH } from "../app/comment-batching.ts";
import { batchBehaviors, BEHAVIOR_BATCH_SIZE } from "../app/behavior-batching.ts";
import { estimateAiCostUsd } from "../app/ai-pricing.ts";
import { assignUniquePoolCandidates, buildCommentPoolGroups, buildPublicCommentPoolRequests, commentPoolCandidateCount } from "../app/comment-pool-generation.ts";

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

test("batches up to 25 students by subject and assessment area", () => {
  const inputs = [
    ...Array.from({ length: 30 }, (_, index) => ({ subject: "국어", studentId: index + 1, items: [{ assessmentIndex: 0 }, { assessmentIndex: 1 }] })),
    ...Array.from({ length: 6 }, (_, index) => ({ subject: "수학", studentId: index + 1, items: [{ assessmentIndex: 0 }] })),
  ];
  const batches = batchCommentsByAssessmentArea(inputs);
  assert.equal(COMMENT_BATCH_SIZE, 25);
  assert.deepEqual(batches.map((batch) => batch.length), [25, 5, 25, 5, 6]);
  assert.equal(batches.every((batch) => new Set(batch.map((item) => item.subject)).size === 1), true);
  assert.equal(batches.every((batch) => new Set(batch.flatMap((item) => item.items.map((entry) => entry.assessmentIndex))).size === 1), true);
  assert.equal(batches.every((batch) => batch.every((item) => item.subjectItems.length >= item.items.length)), true);
});

test("preserves the full subject evidence while batching a missing-area repair", () => {
  const fullSubjectItems = Array.from({ length: 5 }, (_, assessmentIndex) => ({ assessmentIndex }));
  const [batch] = batchCommentsByAssessmentArea([{
    subject: "국어",
    studentId: 1,
    items: [fullSubjectItems[4]],
    subjectItems: fullSubjectItems,
  }]);
  assert.deepEqual(batch[0].items.map((item) => item.assessmentIndex), [4]);
  assert.deepEqual(batch[0].subjectItems.map((item) => item.assessmentIndex), [0, 1, 2, 3, 4]);
});

test("builds level pools without putting student identifiers in the AI pool request", () => {
  const evidence = [1, 2, 3].map((studentId) => ({
    studentId,
    subject: "국어",
    items: [{ assessmentIndex: 0, level: "중" as const, criterion: "자료의 내용을 표현할 수 있다.", text: "1단원 | 문법 | 수준: 중 | 기준: 자료의 내용을 표현할 수 있다." }],
  }));
  const groups = buildCommentPoolGroups(evidence);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 3);
  const publicPools = buildPublicCommentPoolRequests(groups);
  assert.equal(JSON.stringify(publicPools).includes("studentId"), false);
  assert.equal(publicPools[0].requiredCount, 3);
  assert.equal(publicPools[0].candidateCount, 5);
  assert.equal(new Set(publicPools[0].variantPlans.map((plan) => JSON.stringify(plan))).size, 5);
});

test("requests a forty percent reserve candidate pool to avoid paid retries", () => {
  assert.equal(commentPoolCandidateCount(1), 2);
  assert.equal(commentPoolCandidateCount(5), 7);
  assert.equal(commentPoolCandidateCount(10), 14);
  assert.equal(commentPoolCandidateCount(25), 35);
  assert.equal(commentPoolCandidateCount(0), 0);
});

test("isolates each student and area during the final individual retries", () => {
  const evidence = [1, 2, 3].map((studentId) => ({
    studentId,
    subject: "국어",
    items: [{ assessmentIndex: 0, level: "중" as const, criterion: "자료의 내용을 표현할 수 있다.", text: "문법 | 수준: 중 | 기준: 자료의 내용을 표현할 수 있다." }],
  }));
  assert.equal(buildCommentPoolGroups(evidence).length, 1);
  assert.equal(buildCommentPoolGroups(evidence, true).length, 3);
});

test("safely repairs duplicated nominal endings without guessing irregular verbs", () => {
  assert.equal(repairSafeNominalEnding("선을 구별하는 함."), "선을 구별함.");
  assert.equal(repairSafeNominalEnding("식을 계산하는 수행임."), "식을 계산함.");
  assert.equal(repairSafeNominalEnding("생각을 표현하는 모습임."), "생각을 표현함.");
  assert.equal(repairSafeNominalEnding("길이를 재는 함."), "길이를 재는 함.");
});

test("reframes directly negative low criteria without changing the stored source", () => {
  assert.equal(
    positiveGrowthCriterion("하", "용수철저울을 사용해 물체의 무게를 비교하는 데 어려움을 겪는다."),
    "용수철저울을 사용해 물체의 무게를 비교하는 활동에 참여하며 수행 방법을 익혀 간다.",
  );
  assert.equal(
    positiveGrowthCriterion("하", "모둠에서 동물의 특징을 이용해 생활용품을 설계하는 데 협력을 하지 않는다."),
    "모둠에서 동물의 특징을 이용해 생활용품을 설계하는 활동에 참여하며 협력하는 경험을 쌓아 간다.",
  );
  assert.equal(
    positiveGrowthCriterion("하", "배추흰나비의 한살이를 관찰하였으나, 글과 그림으로 표현하지 못한다."),
    "배추흰나비의 한살이를 관찰하고, 글과 그림으로 표현하는 활동에 참여한다.",
  );
  assert.equal(positiveGrowthCriterion("중", "협력을 하지 않는다."), "협력을 하지 않는다.");
});

test("creates a grounded nominal fallback from a declarative criterion", () => {
  assert.equal(
    criterionToSafeNominalSentence("모둠 친구들과 함께 동물의 특징을 이용해 생활용품을 설계한다."),
    "모둠 친구들과 함께 동물의 특징을 이용해 생활용품을 설계함.",
  );
});

test("creates distinct grounded fallbacks for a group collaboration criterion", () => {
  assert.deepEqual(
    criterionToSafeNominalCandidates("모둠 친구들과 함께 동물의 특징을 이용해 생활용품을 설계한다."),
    [
      "모둠 친구들과 함께 동물의 특징을 이용해 생활용품을 설계함.",
      "동물의 특징을 이용해 생활용품을 설계하며 모둠 친구들과 함께 활동함.",
      "동물의 특징을 이용해 생활용품을 설계하는 과정에 모둠 친구들과 함께 참여함.",
    ],
  );
});

test("blocks unsupported strong praise for middle and low levels", () => {
  assert.deepEqual(levelAppropriatenessIssues("생활용품을 설계하는 수행이 돋보임.", "중"), ["평가수준보다 과도한 우수 표현"]);
  assert.deepEqual(levelAppropriatenessIssues("생활용품 설계 활동에 참여하는 모습이 인상적임.", "하"), ["평가수준보다 과도한 우수 표현"]);
  assert.deepEqual(levelAppropriatenessIssues("생활용품을 창의적으로 설계하는 능력이 뛰어남.", "상"), []);
});

test("rejects direct negative science-record expressions", () => {
  for (const sentence of [
    "용수철저울로 무게를 비교하는 데 어려움을 겪음.",
    "모둠 활동에서 협력을 하지 않음.",
    "관찰하였으나 글과 그림으로 표현하지 못하는 수준임.",
  ]) assert.equal(validateGeneratedCommentPart(sentence).valid, false);
});

test("recognizes collaboration when the criterion explicitly contains group evidence", () => {
  assert.deepEqual(
    evidenceGroundingWarnings(
      "모둠 활동에서 친구와 협력하여 동물의 특징을 이용한 생활용품을 설계함.",
      "모둠 친구들과 함께 동물의 특징을 이용해 생활용품을 설계한다.",
    ).filter((issue) => issue.includes("협력")),
    [],
  );
});

test("assigns only validated unique pool candidates and reports a shortage", () => {
  const [group] = buildCommentPoolGroups([1, 2, 3].map((studentId) => ({
    studentId,
    subject: "국어",
    items: [{ assessmentIndex: 0, level: "중" as const, criterion: "자료의 내용을 문장의 짜임에 맞게 일부 표현할 수 있다.", text: "1단원 | 문법 | 수준: 중 | 기준: 자료의 내용을 문장의 짜임에 맞게 일부 표현할 수 있다." }],
  })));
  const repeated = "자료의 내용을 문장의 짜임에 맞게 일부 표현하여 학습한 내용을 적용함.";
  const result = assignUniquePoolCandidates(group, [
    repeated,
    repeated,
    "문장의 짜임을 고려하여 자료에 담긴 내용을 일부 알맞게 표현함.",
  ]);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.issues.includes("완전히 같은 문장 후보 중복"), true);
});

test("does not replace a unique stored sentence with a candidate matching a fixed reference", () => {
  const [group] = buildCommentPoolGroups([{
    studentId: 1,
    subject: "국어",
    items: [{ assessmentIndex: 0, level: "중" as const, criterion: "자료의 내용을 문장의 짜임에 맞게 일부 표현할 수 있다.", text: "문법 | 수준: 중 | 기준: 자료의 내용을 문장의 짜임에 맞게 일부 표현할 수 있다." }],
  }]);
  const sentence = "자료의 내용을 문장의 짜임에 맞게 일부 표현하여 학습한 내용을 적용함.";
  const result = assignUniquePoolCandidates(group, [sentence], [sentence]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.issues.includes("완전히 같은 문장 후보 중복"), true);
});

test("uses a grounded reference duplicate only when the final fallback is explicitly enabled", () => {
  const [group] = buildCommentPoolGroups([{
    studentId: 1,
    subject: "국어",
    items: [{ assessmentIndex: 0, level: "중" as const, criterion: "마음을 전하는 글을 쓰는 방법을 알고, 마음을 전하는 글을 쓰기 위해 노력한다.", text: "쓰기 | 수준: 중 | 기준: 마음을 전하는 글을 쓰는 방법을 알고, 마음을 전하는 글을 쓰기 위해 노력한다." }],
  }]);
  const sentence = "마음을 전하는 글을 쓰는 방법을 알고, 마음을 전하는 글을 쓰기 위해 노력함.";
  const blocked = assignUniquePoolCandidates(group, [sentence], [sentence]);
  const fallback = assignUniquePoolCandidates(group, [sentence], [sentence], true);
  assert.equal(blocked.candidates.length, 0);
  assert.deepEqual(fallback.candidates, [sentence]);
  assert.equal(fallback.fallbackKeys.size, 1);
});

test("keeps grounded candidates even when their structures are similar", () => {
  const [group] = buildCommentPoolGroups([1, 2].map((studentId) => ({
    studentId,
    subject: "국어",
    items: [{ assessmentIndex: 0, level: "중" as const, criterion: "마음을 전하는 글을 쓰는 방법을 알고, 마음을 전하는 글을 쓰기 위해 노력한다.", text: "쓰기 | 수준: 중 | 기준: 마음을 전하는 글을 쓰는 방법을 알고, 마음을 전하는 글을 쓰기 위해 노력한다." }],
  })));
  const result = assignUniquePoolCandidates(group, [
    "마음을 전하는 글을 쓰는 방법을 알고, 글을 쓰기 위해 노력함.",
    "마음을 전하는 글의 작성 방법을 알고, 마음을 담아 글을 쓰기 위해 힘씀.",
  ]);
  assert.equal(result.candidates.length, 2);
});

test("groups missing comment evidence into at most ten areas per repair call", () => {
  const pending = Array.from({ length: 5 }, (_, index) => ({
    studentId: index + 1,
    subject: "국어",
    items: [{ assessmentIndex: 0 }, { assessmentIndex: 1 }],
  }));
  const groups = batchCommentRepairs(pending);
  assert.equal(COMMENT_REPAIR_EVIDENCE_BATCH_SIZE, 10);
  assert.equal(MAX_COMMENT_AI_CALLS_PER_BATCH, 5);
  assert.equal(MAX_COMMENT_DIVERSITY_CALLS_PER_BATCH, 1);
  assert.deepEqual(groups.map((group) => group.reduce((count, entry) => count + entry.items.length, 0)), [10]);
  assert.equal(groups.flatMap((group) => group).flatMap((entry) => entry.items).length, 10);
  assert.equal(groups.every((group) => new Set(group.map((entry) => `${entry.studentId}|${entry.subject}`)).size === group.length), true);
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

test("recovers a missing item id only for one unambiguous generated sentence", () => {
  assert.equal(resolveGeneratedEvidenceItemId(["e1"], undefined, 1), "e1");
  assert.equal(resolveGeneratedEvidenceItemId(["e1"], "unknown", 1), null);
  assert.equal(resolveGeneratedEvidenceItemId(["e1", "e2"], undefined, 1), null);
  assert.equal(resolveGeneratedEvidenceItemId(["e1"], undefined, 2), null);
  assert.equal(resolveGeneratedEvidenceItemId(["e1", "e2"], "e2", 2), "e2");
});

test("explains missing areas separately without exposing internal diagnostics", () => {
  const missing = generatedCommentFailureMessage({
    expectedIds: ["e1"], returnedIds: [], invalidSentenceCount: 1,
  });
  assert.match(missing, /1개 평가 영역의 문장을 반환하지 않았습니다/);
  assert.match(missing, /기존 결과는 유지/);
  assert.doesNotMatch(missing, /expectedIds|50~60자|함 종결/);

  const invalid = generatedCommentFailureMessage({
    expectedIds: ["e1"], returnedIds: ["e1"], invalidSentenceCount: 1,
  });
  assert.match(invalid, /1개 문장이 작성 기준을 통과하지 못했습니다/);
});

test("flattens AI line breaks when a complete comment is regenerated", () => {
  assert.equal(
    normalizeGeneratedCommentWhitespace("첫 번째 영역을 평가함.\n\n두 번째 영역을 평가함.\r\n세 번째 영역을 평가함."),
    "첫 번째 영역을 평가함. 두 번째 영역을 평가함. 세 번째 영역을 평가함.",
  );
});

test("accepts one 60 to 80 character sentence per assessment area with a nominal ending", () => {
  const sentence = "작품 속 인물의 상황을 살펴 알맞은 표정과 몸짓, 목소리와 말투를 선택하고 대화의 흐름에 맞추어 인물의 마음이 드러나도록 표현함.";
  assert.equal(Array.from(sentence).length >= 60 && Array.from(sentence).length <= 80, true);
  const result = validateGeneratedComment(`${sentence} ${sentence}`, 2);
  assert.equal(result.valid, true);
});

test("accepts natural school-record nominal endings instead of literal 함 only", () => {
  for (const sentence of ["문제를 해결하는 능력이 뛰어남.", "학습 내용을 적용하는 태도가 돋보임.", "꾸준히 성장하는 모습이 인상적임."]) {
    assert.equal(hasNaturalNominalEnding(sentence), true);
  }
  for (const sentence of ["문제를 해결하였다.", "학습 태도가 좋습니다.", "학습 내용을 적용할 수 있다."]) {
    assert.equal(hasNaturalNominalEnding(sentence), false);
  }
  assert.equal(hasNaturalNominalEnding("문제를 해결하는 능력이 뛰어남"), false);
  assert.equal(ensureGeneratedCommentPeriod("문제를 해결하는 능력이 뛰어남"), "문제를 해결하는 능력이 뛰어남.");
});

test("keeps natural comments in the broad display range without inventing prefixes", () => {
  const strict = "글의 중심 생각을 정확하게 파악하고 중요한 내용을 근거와 함께 정리하여 발표 활동에 꾸준히 참여함.";
  assert.equal(normalizeGeneratedCommentCandidate(strict), strict);
  const nearMiss = Array.from(strict).slice(2).join("");
  if (Array.from(nearMiss.trim()).length >= 55) assert.equal(normalizeGeneratedCommentCandidate(nearMiss), nearMiss.trim());
  const tooShort = "평가함.";
  assert.equal(normalizeGeneratedCommentCandidate(tooShort), "");
  assert.equal(normalizeGeneratedCommentCandidate(tooShort).startsWith("수업에서 "), false);
});

test("stores a natural long subject comment without turning target length into a warning", () => {
  const long = "작품 속 인물의 상황을 살펴 알맞은 표정과 몸짓, 목소리와 말투를 선택하고 대화의 흐름과 장면의 분위기에 맞추어 인물의 마음이 분명하게 드러나도록 표현함.";
  const result = validateGeneratedCommentPart(long);
  assert.equal(Array.from(long).length > 80, true);
  assert.equal(result.acceptedLength, true);
  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, []);
});

test("adapts the target length to the amount of criterion information", () => {
  assert.deepEqual(commentLengthTarget("자료를 분류할 수 있다."), { min: 45, max: 65, label: "45~65자" });
  assert.deepEqual(commentLengthTarget("문장의 짜임에 따라 문장을 나누고 자료 내용을 표현할 수 있다."), { min: 55, max: 75, label: "55~75자" });
  assert.deepEqual(commentLengthTarget("인물의 상황을 파악하고 표정과 몸짓을 선택하며 목소리와 말투를 활용하여 대화를 실감 나게 표현할 수 있다."), { min: 60, max: 85, label: "60~85자" });
});

test("rejects missing areas, invalid length, endings, and forbidden expressions", () => {
  assert.equal(validateGeneratedComment("평가 활동에 참여함.", 2).valid, false);
  const forbidden = "학습 내용의 이해가 부족함. 학습 활동에 참여하여 배운 내용을 꾸준하게 연습하고 적용하는 태도를 형성함.";
  assert.equal(validateGeneratedComment(forbidden, 2).valid, false);
});

test("rejects mechanically duplicated nominal endings", () => {
  for (const ending of ["참여함함.", "표현하고함.", "표현하고 함.", "나타내며함.", "나타내며 함.", "마음을 담아함.", "내용을 익혀 감함.", "표현하려는 노력함."]) {
    const awkward = `수업에서 작품의 중심 내용을 정확하게 파악하고 중요한 근거를 찾아 발표 활동에 ${ending}`;
    const result = validateGeneratedComment(awkward, 1);
    assert.equal(result.naturalEndingsOk, false);
    assert.equal(result.valid, false);
  }
});

test("rejects duplicated nominal endings such as 보임함", () => {
  assert.equal(validateGeneratedCommentPart("중심 문장과 뒷받침 문장을 찾아 글의 내용을 알맞게 간추리는 모습을 보임함.").valid, false);
});

test("rejects unnatural predicate combinations found in the paid sample", () => {
  for (const sentence of [
    "문장의 짜임을 살펴 자료의 내용을 일부 나누고 문장 구조에 맞게 표현하는 모습을 보 이해함.",
    "자료의 내용을 문장의 짜임에 맞게 표현 수행함.",
    "마음을 전하는 글쓰는 방법을 알고 내용을 정리하여 작성함.",
    "자료의 내용을 문장 구조에 맞게 표현 결과를 수행함.",
  ]) {
    assert.equal(validateGeneratedCommentPart(sentence).naturalEndingsOk, false);
    assert.equal(validateGeneratedCommentPart(sentence).valid, false);
  }
});

test("blocks evaluative or negatively framed behavior expressions", () => {
  const fourSentences = (last: string) => [
    "수업에서 궁금한 내용을 질문하며 배움을 꾸준히 이어 가는 모습이 나타남.",
    "친구의 이야기를 끝까지 듣고 서로의 생각을 존중하며 대화에 참여함.",
    "맡은 역할을 책임감 있게 마무리하고 준비물을 스스로 점검하는 습관을 기름.",
    last,
  ].join(" ");
  const padded = (last: string) => {
    let value = fourSentences(last);
    while (new TextEncoder().encode(value).length < 500) value = value.replace("배움을 ", "배움을 차분히 ");
    return value;
  };
  for (const phrase of ["앞으로 발전할 가능성이 크다고 보임.", "공동의 흐름을 해치지 않음.", "문제 행동을 보이지 않음."]) {
    const result = validateRecord(padded(phrase), true);
    assert.equal(result.styleIssues.length > 0, true);
    assert.equal(result.valid, false);
  }
});

test("accepts a natural behavior paragraph without fixing the sentence count", () => {
  let three = "학습에 꾸준히 참여함. 친구의 말을 경청하며 협력함. 맡은 역할을 책임감 있게 수행하며 성장함.";
  while (new TextEncoder().encode(three).length < 500) three = three.replace("학습에 ", "학습에 차분하고 성실한 태도로 ");
  const result = validateRecord(three, true);
  assert.equal(result.sentenceCountOk, true);
  assert.equal(result.valid, true);
});

test("rejects dangling connective bodies before composing a generated ending", () => {
  for (const body of ["자료를 정확하게 분류하고", "의견을 자연스럽게 나타내며", "작품에 마음을 담아", "배운 내용을 익혀 감", "활동에 참여함"]) {
    assert.equal(composeGeneratedCommentCandidate(body, "설명함."), "");
  }
  assert.equal(composeGeneratedCommentCandidate("자료의 특징을 기준에 따라 정확하게", "분류함."), "자료의 특징을 기준에 따라 정확하게 분류함.");
});

test("keeps target length as a generation metric instead of a teacher warning", () => {
  const base = "글의 중심 생각을 정확하게 파악하고 중요한 내용을 근거와 함께 정리하여 발표 활동에 꾸준히 참여함.";
  const sentence49 = Array.from(base).slice(0, 46).join("").replace(/[.]*$/, "") + " 참여함.";
  const result = validateGeneratedCommentPart(sentence49);
  if (Array.from(sentence49).length >= 55 && Array.from(sentence49).length <= 90) {
    assert.equal(result.valid, true);
    assert.deepEqual(result.warnings, []);
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

test("accepts directly equivalent effort and posture wording from the criterion", () => {
  assert.deepEqual(
    evidenceBlockingIssues("생활 속에서 바른 자세를 꾸준히 실천하려는 태도가 돋보임.", "바른 자세를 생활 속에서 실천하려고 노력할 수 있다."),
    [],
  );
  assert.equal(
    evidenceBlockingIssues("자료를 정확하게 정리함.", "자료를 정리할 수 있다.").length > 0,
    true,
  );
});

test("blocks invented methods and attitudes that are absent from the criterion", () => {
  assert.deepEqual(
    evidenceBlockingIssues("재미와 감동을 느낀 부분을 그림이나 시로 표현함.", "재미와 감동을 느낀 부분을 다양한 방법으로 표현할 수 있다."),
    ["평가 근거에 없는 ‘입력에 없는 구체적 표현 방법’ 표현"],
  );
  assert.deepEqual(
    evidenceBlockingIssues("자료 내용을 문장의 짜임에 맞게 일부 표현하는 태도가 돋보임.", "자료 내용을 문장의 짜임에 맞게 일부 표현할 수 있다."),
    ["평가 근거에 없는 ‘학습 태도’ 표현"],
  );
});

test("blocks an invented speaking activity when the evidence only supports writing", () => {
  const comment = "작품에서 느낀 재미와 감동을 말로 풀어 내고, 그런 느낌을 가지게 된 까닭을 함께 적는 모습임.";
  const writingEvidence = "작품을 읽고 재미나 감동을 느낀 부분과 그 까닭이 무엇인지 쓸 수 있다.";
  assert.deepEqual(evidenceBlockingIssues(comment, writingEvidence), ["평가 근거에 없는 ‘말하기·발표 활동’ 표현"]);
  const speakingEvidence = "자신의 생각을 말로 표현하고 친구들 앞에서 발표할 수 있다.";
  assert.deepEqual(evidenceBlockingIssues(comment, speakingEvidence), []);
});

test("blocks changing sentence division into dividing the source material", () => {
  const evidence = "문장을 문장의 짜임에 따라 일부 나눌 수 있고, 자료에 대한 내용을 문장의 짜임에 맞게 일부 표현할 수 있다.";
  assert.equal(
    evidenceBlockingIssues("문장의 짜임을 살펴 자료 내용을 일부 나누어 표현함.", evidence).some((issue) => issue.includes("자료 내용을 나누거나 구분하기")),
    true,
  );
  assert.equal(
    evidenceBlockingIssues("자료 내용을 일부 표현하고 문장을 짜임에 따라 나누어 봄.", evidence).some((issue) => issue.includes("자료 내용을 나누거나 구분하기")),
    false,
  );
});

test("blocks invented summarizing activities and demeanor fillers", () => {
  const writingEvidence = "작품에서 느낀 재미나 감동의 부분과 그 까닭을 쓸 수 있다.";
  assert.deepEqual(
    evidenceBlockingIssues("재미와 감동의 까닭을 쓰고 내용의 흐름을 간추려 표현하는 모습이 돋보임.", writingEvidence),
    ["평가 근거에 없는 ‘내용 간추리기·요약하기’ 표현"],
  );
  assert.deepEqual(
    evidenceBlockingIssues("작품에서 느낀 재미와 감동의 까닭을 차분하게 쓰는 모습임.", writingEvidence),
    ["평가 근거에 없는 ‘관찰되지 않은 태도 수식어’ 표현"],
  );
  assert.deepEqual(
    evidenceBlockingIssues("작품에서 느낀 재미와 감동의 까닭을 쓰고 이를 간추려 표현함.", writingEvidence),
    ["평가 근거에 없는 ‘내용 간추리기·요약하기’ 표현"],
  );
  assert.deepEqual(
    evidenceBlockingIssues("마음을 전하는 글의 방법을 알고 성실히 힘쓰는 모습임.", "마음을 전하는 글을 쓰기 위해 노력한다."),
    ["평가 근거에 없는 ‘성실하게’ 표현"],
  );
  assert.deepEqual(
    evidenceBlockingIssues("교사의 도움을 받아 작품에서 느낀 부분과 까닭을 쓰는 과정을 끝까지 이어 감.", "교사의 도움을 받아 느낀 부분과 까닭을 쓸 수 있다."),
    ["평가 근거에 없는 ‘끝까지’ 표현"],
  );
});

test("requires every independent performance element from the selected criterion", () => {
  const criterion = "문장을 문장의 짜임에 따라 일부 나눌 수 있고, 자료에 대한 내용을 문장의 짜임에 맞게 일부 표현할 수 있다.";
  assert.deepEqual(
    evidenceBlockingIssues(
      "자료의 내용을 문장의 짜임에 맞추어 일부 표현하며 문장 구성의 기본을 익혀 가는 모습이 드러남.",
      criterion,
    ),
    [
      "평가 근거에 없는 ‘입력에 없는 학습·성장 과정’ 표현",
      "평가 기준의 필수 조건 ‘문장의 짜임에 따라 나누기’ 누락",
    ],
  );
  assert.deepEqual(
    evidenceBlockingIssues(
      "문장을 문장의 짜임에 따라 일부 나누고 자료 내용을 그 짜임에 맞게 부분적으로 표현하는 모습임.",
      criterion,
    ),
    [],
  );
});

test("blocks invented stock openings and required assistance omissions", () => {
  assert.deepEqual(
    evidenceBlockingIssues(
      "자료를 관찰하고 분석하며 작품 속 인물의 대화를 알맞게 표현함.",
      "인물의 상황에 맞는 표정과 몸짓으로 대화를 표현할 수 있다.",
    ),
    ["평가 근거에 없는 ‘자료 관찰·탐색·분석’ 표현"],
  );
  assert.deepEqual(
    evidenceBlockingIssues(
      "설명하는 글의 중심 문장과 뒷받침 문장을 찾아 내용을 정리함.",
      "교사의 도움을 받아 중심 문장과 뒷받침 문장을 찾아 간추릴 수 있다.",
    ),
    ["평가 기준의 필수 조건 ‘교사의 도움’ 누락"],
  );
  assert.deepEqual(
    evidenceBlockingIssues(
      "교사의 도움을 받아 중심 문장과 뒷받침 문장을 찾아 내용을 정리함.",
      "교사의 도움을 받아 중심 문장과 뒷받침 문장을 찾아 간추릴 수 있다.",
    ),
    [],
  );
  assert.deepEqual(
    evidenceBlockingIssues(
      "평가 활동의 대상과 수행 내용을 바탕으로 문장의 짜임을 구별함.",
      "문장을 문장의 짜임에 따라 일부 나눌 수 있다.",
    ),
    [
      "평가 근거에 없는 ‘평가 메타 표현’ 표현",
      "평가 기준의 필수 조건 ‘일부 수행’ 누락",
      "평가 기준의 필수 조건 ‘문장의 짜임에 따라 나누기’ 누락",
    ],
  );
  assert.deepEqual(
    evidenceBlockingIssues(
      "상황에 알맞은 표정과 몸짓으로 작품 속 대화를 실감 나게 표현함.",
      "상황에 알맞은 표정과 몸짓을 알고 작품 속 대화를 표현하기 위해 노력한다.",
    ),
    ["평가 근거에 없는 ‘실감 나게’ 표현", "평가 기준의 필수 조건 ‘노력·성장 과정’ 누락"],
  );
});

test("blocks an invented learning process when the criterion already states the attained knowledge", () => {
  const evidence = "마음을 전하는 글을 쓰는 방법을 알고, 마음을 전하는 글을 쓰기 위해 노력한다.";
  assert.deepEqual(
    evidenceBlockingIssues("마음을 전하는 글을 쓰는 방법을 알고, 그 방법을 익혀 가며 글을 쓰기 위해 노력함.", evidence),
    ["평가 근거에 없는 ‘입력에 없는 학습·성장 과정’ 표현"],
  );
  assert.deepEqual(
    evidenceBlockingIssues("교사의 도움을 받아 글 쓰는 방법을 익혀 가는 과정임.", "교사의 도움을 받아 글 쓰는 방법을 익혀 가는 과정이다."),
    [],
  );
  assert.deepEqual(
    evidenceBlockingIssues("마음을 전하는 글을 쓰는 방법을 살피며 글을 쓰기 위해 힘씀.", evidence),
    ["평가 기준의 필수 조건 ‘방법을 알고 있음’ 누락"],
  );
});

test("builds explicit level instructions and blocks omitted low-level meaning", () => {
  assert.deepEqual(
    commentEvidenceInstructions("교사의 도움을 받아 글의 중요한 내용을 일부 찾으며 표현하기 위해 노력한다."),
    {
      required: ["교사의 도움을 받아 수행함", "수행 범위가 일부임", "노력하거나 익혀 가는 과정임"],
      forbiddenUnlessPresent: ["정확하게", "실감 나게", "다양한 방법", "이해하기 쉽게"],
      instruction: "반드시 보존할 의미: 교사의 도움을 받아 수행함, 수행 범위가 일부임, 노력하거나 익혀 가는 과정임 / 근거에 없으므로 쓰지 말 의미: 정확하게, 실감 나게, 다양한 방법, 이해하기 쉽게",
    },
  );
  assert.deepEqual(
    evidenceBlockingIssues(
      "글의 중요한 내용을 찾아 자신의 생각으로 표현함.",
      "교사의 도움을 받아 글의 중요한 내용을 일부 찾으며 표현하기 위해 노력한다.",
    ),
    [
      "평가 기준의 필수 조건 ‘교사의 도움’ 누락",
      "평가 기준의 필수 조건 ‘일부 수행’ 누락",
      "평가 기준의 필수 조건 ‘노력·성장 과정’ 누락",
    ],
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
    commentAreaIssuesForDisplay("warning", ["권장 60~80자 범위를 벗어난 59자 문장"]),
    [],
  );
  assert.deepEqual(
    commentAreaIssuesForDisplay("warning", [
      "권장 60~80자 범위를 벗어난 81자 문장",
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
    repairHint: "현재 495바이트 · 목표 515~540바이트",
    previousBehavior: "맡은 역할을 책임감 있게 수행함.",
  };
  const restored = JSON.parse(JSON.stringify(repair));
  assert.equal(restored.previousBehavior, repair.previousBehavior);
  assert.match(restored.repairHint, /515~540/);
});

test("turns behavior byte gaps into concrete Korean syllable repair instructions", () => {
  assert.deepEqual(behaviorRepairPlan(495), {
    bytes: 495, targetBytes: 530, byteDelta: 35, syllables: 12, direction: "add",
  });
  assert.deepEqual(behaviorRepairPlan(625), {
    bytes: 625, targetBytes: 570, byteDelta: -55, syllables: 18, direction: "remove",
  });
  assert.match(behaviorRepairInstruction(495), /후보 1은 515바이트, 후보 2는 540바이트.*약 12음절.*35바이트.*추가/);
  assert.match(behaviorRepairInstruction(625), /후보 1은 585바이트, 후보 2는 560바이트.*약 18음절.*55바이트.*삭제/);
  assert.match(behaviorRepairInstruction(525), /기준을 충족.*길이와 핵심 사실을 유지/);
});

test("uses asymmetric in-range targets for the smallest behavior repair", () => {
  assert.deepEqual(behaviorRepairTargets(479), [515, 540]);
  assert.deepEqual(behaviorRepairTargets(499), [515, 540]);
  assert.deepEqual(behaviorRepairTargets(500), [500, 500]);
  assert.deepEqual(behaviorRepairTargets(535), [535, 535]);
  assert.deepEqual(behaviorRepairTargets(551), [551, 551]);
  assert.deepEqual(behaviorRepairTargets(601), [585, 560]);
  assert.deepEqual(behaviorRepairTargets(639), [585, 560]);
});

test("keeps behavior repair targets stable across byte boundaries and large misses", () => {
  assert.deepEqual(
    [0, 430, 499, 500, 550, 600, 601, 625].map((bytes) => behaviorRepairPlan(bytes)),
    [
      { bytes: 0, targetBytes: 530, byteDelta: 530, syllables: 177, direction: "add" },
      { bytes: 430, targetBytes: 530, byteDelta: 100, syllables: 33, direction: "add" },
      { bytes: 499, targetBytes: 530, byteDelta: 31, syllables: 10, direction: "add" },
      { bytes: 500, targetBytes: 500, byteDelta: 0, syllables: 0, direction: "none" },
      { bytes: 550, targetBytes: 550, byteDelta: 0, syllables: 0, direction: "none" },
      { bytes: 600, targetBytes: 600, byteDelta: 0, syllables: 0, direction: "none" },
      { bytes: 601, targetBytes: 570, byteDelta: -31, syllables: 10, direction: "remove" },
      { bytes: 625, targetBytes: 570, byteDelta: -55, syllables: 18, direction: "remove" },
    ],
  );
});

test("limits behavior length repair to fact-preserving local edits", () => {
  const shortInstruction = behaviorRepairInstruction(495);
  assert.match(shortInstruction, /이미 언급된 행동의 방법·과정만 구체화/);
  assert.match(shortInstruction, /새 활동·인물·성과·태도는 만들지 않음/);
  assert.match(shortInstruction, /문장 전체를 다시 쓰거나 순서를 바꾸지 말고/);

  const longInstruction = behaviorRepairInstruction(625);
  assert.match(longInstruction, /중복 연결어·수식어만 줄이고/);
  assert.match(longInstruction, /관찰 사실·성장 표현·문장 수는 삭제하지 않음/);
});

test("blocks behavior candidates outside the strict byte range from persistence", () => {
  const behaviorAtLeast = (targetBytes: number) => {
    let first = "학습에서 꾸준히 성장";
    const tail = " 친구와 협력하며 참여함. 맡은 역할을 책임감 있게 수행함. 스스로 점검하며 발전함.";
    while (new TextEncoder().encode(`${first}함.${tail}`).length < targetBytes) first += "가";
    return `${first}함.${tail}`;
  };
  const strict = { studentId: 17, characteristic: "성장 모습: 꾸준히 노력함", behavior: behaviorAtLeast(525) };
  const tooLong = { studentId: 21, characteristic: "성장 모습: 꾸준히 노력함", behavior: behaviorAtLeast(606) };

  assert.deepEqual(assertStrictGeneratedBehaviors([strict]), [strict]);
  assert.throws(
    () => assertStrictGeneratedBehaviors([strict, tooLong]),
    /엄격 검수를 통과하지 못한 행동특성은 저장할 수 없습니다: 21/,
  );
});

test("selects a strict behavior candidate before the closest repair fallback", () => {
  const behaviorAtLeast = (targetBytes: number) => {
    let first = "학습에서 꾸준히 성장";
    const tail = " 친구와 협력하며 참여함. 맡은 역할을 책임감 있게 수행함. 스스로 점검하며 발전함.";
    while (new TextEncoder().encode(`${first}함.${tail}`).length < targetBytes) first += "가";
    return `${first}함.${tail}`;
  };
  const short = behaviorAtLeast(493);
  const strict = behaviorAtLeast(525);
  const long = behaviorAtLeast(610);
  assert.equal(selectBehaviorCandidate([short, strict, long])?.behavior, strict);
  assert.equal(selectBehaviorCandidate([short, long])?.behavior, short);
  assert.equal(selectBehaviorCandidate(["", null, undefined]), null);
});
