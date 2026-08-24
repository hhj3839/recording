import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalCommentSentence, buildCommonCommentGenerationGuide, commentAreaIssuesForDisplay, commentEvidenceInstructions, commentLengthTarget, commentPredicateIssues, commentPredicatePolicy, composeGeneratedCommentCandidate, criterionSemanticIssues, criterionToSafeNominalCandidates, criterionToSafeNominalSentence, ensureGeneratedCommentPeriod, evidenceBlockingIssues, evidenceGroundingWarnings, generatedCommentFailureMessage, hasCompleteEvidenceCoverage, hasNaturalNominalEnding, levelAppropriatenessIssues, normalizeGeneratedCommentCandidate, normalizeGeneratedCommentWhitespace, openingRepetitionRate, positiveGrowthCriterion, repairSafeNominalEnding, replaceSelectedCommentText, resolveGeneratedEvidenceItemId, validateGeneratedComment, validateGeneratedCommentPart } from "../app/comment-generation-policy.ts";
import { behaviorRepairInstruction, behaviorRepairPlan, behaviorRepairTargets } from "../app/behavior-repair-policy.ts";
import { assertStrictGeneratedBehaviors, selectBehaviorCandidate } from "../app/behavior-persistence-policy.ts";
import { validateRecord } from "../app/record-validation.ts";
import { generationModel } from "../app/ai-model-policy.ts";
import { batchCommentRepairs, batchCommentsByAssessmentArea, COMMENT_BATCH_SIZE, COMMENT_REPAIR_EVIDENCE_BATCH_SIZE, MAX_COMMENT_AI_CALLS_PER_BATCH, MAX_COMMENT_DIVERSITY_CALLS_PER_BATCH } from "../app/comment-batching.ts";
import { batchBehaviors, BEHAVIOR_BATCH_SIZE } from "../app/behavior-batching.ts";
import { estimateAiCostUsd } from "../app/ai-pricing.ts";
import { commentAreaOverlapReasons } from "../app/comment-area-diversity.ts";
import { assignApprovedCommentPools, assignUniquePoolCandidates, buildApprovedCommentPool, buildCanonicalBaselinePart, buildCommentPoolGroups, buildPublicCommentPoolRequests, commentPoolCandidateCount, spreadCandidatesByOpening } from "../app/comment-pool-generation.ts";
import { assembleRotatedComment } from "../app/comment-assembly.ts";
import { readApiJson } from "../app/api-response.ts";
import { approvePoolCandidates, buildCommentPoolSpecs, COMMENT_POOL_CLUSTER_LIMIT, COMMENT_POOL_CLUSTER_THRESHOLD, COMMENT_POOL_MINIMUM, COMMENT_POOL_OPENING_LIMIT, COMMENT_POOL_SIMILARITY_LIMIT, COMMENT_POOL_TARGET, poolSentenceOpening, poolSentenceSimilarity, repairLegacyPoolCandidate } from "../app/comment-pool-library.ts";

const poolPlan = (overrides: Partial<{ id: number; subject: string; unit: string; goal: string; domain: string; perspective: string; high: string; middle: string; low: string }> = {}) => ({
  id: 1, subject: "사회", unit: "우리 고장", goal: "지역의 모습을 이해한다.", domain: "지리 인식",
  perspective: "지역 자료를 조사하고 정리하는가?", high: "지역 자료를 다양한 방법으로 조사하여 체계적으로 정리함.",
  middle: "지역 자료를 조사하여 정리함.", low: "교사의 도움을 받아 지역 자료를 조사하여 정리함.", ...overrides,
});

test("creates three reusable pool identities without student data", () => {
  const first = buildCommentPoolSpecs([poolPlan()]);
  const copied = buildCommentPoolSpecs([poolPlan({ id: 99 })]);
  assert.equal(first.length, 3);
  assert.deepEqual(first.map((item) => item.fingerprint), copied.map((item) => item.fingerprint));
  assert.notEqual(first[0].fingerprint, first[1].fingerprint);
  assert.equal(JSON.stringify(first).includes("student"), false);
});

test("changes the reusable pool identity when its semantic criterion changes", () => {
  const before = buildCommentPoolSpecs([poolPlan()]);
  const after = buildCommentPoolSpecs([poolPlan({ high: "지역 자료를 조사하고 발표함." })]);
  assert.notEqual(before[0].fingerprint, after[0].fingerprint);
});

test("recognizes conjugated 나타내다 as the same expression performance across subjects", () => {
  const [spec] = buildCommentPoolSpecs([poolPlan({
    subject: "수학",
    high: "나눗셈 상황을 이해하여 정확하게 나눗셈식으로 나타내어 몫을 구한 후 과정을 알맞게 설명한다.",
  })]);
  assert.deepEqual(approvePoolCandidates([spec.canonicalSentence], spec).approved, [spec.canonicalSentence]);
});

test("does not infer a broader recording duty from a criterion that only requires writing", () => {
  const issues = criterionSemanticIssues(
    "알파벳 대·소문자를 정확하게 구별하여 씀.",
    "알파벳 대·소문자를 정확하게 구별하여 쓴다.",
  );
  assert.doesNotMatch(issues.join(" "), /기록하기/);
});

test("repairs unsupported generic modifiers only when the complete sentence revalidates", () => {
  const [spec] = buildCommentPoolSpecs([poolPlan()]);
  for (const modifier of ["적극적으로 ", "효과적으로 ", "꾸준히 "]) {
    const repaired = repairLegacyPoolCandidate(spec.canonicalSentence.replace("지역 자료를", `${modifier}지역 자료를`), spec);
    assert.equal(repaired?.repaired, spec.canonicalSentence);
  }
});

test("approves validated pool candidates up to the natural twelve sentence target", () => {
  const spec = buildCommentPoolSpecs([poolPlan()])[1];
  const candidate = spec.canonicalSentence;
  const approved = approvePoolCandidates(Array.from({ length: 25 }, (_, index) => index ? `${candidate.slice(0, -1)} ${index}함.` : candidate), spec);
  assert.ok(approved.approved.length <= COMMENT_POOL_TARGET);
  assert.ok(approved.approved.includes(candidate));
});

test("measures near-identical pool sentences and groups their openings", () => {
  const first = "지역 자료를 살펴 지역의 특징을 정확하게 설명함.";
  const nearDuplicate = "지역 자료를 살펴, 지역의 특징을 정확하게 설명함.";
  const distinct = "여러 자료에서 찾은 내용을 바탕으로 지역의 특징을 설명함.";
  assert.ok(poolSentenceSimilarity(first, nearDuplicate) >= COMMENT_POOL_SIMILARITY_LIMIT);
  assert.ok(poolSentenceSimilarity(first, distinct) < COMMENT_POOL_SIMILARITY_LIMIT);
  assert.equal(poolSentenceOpening(first), poolSentenceOpening(nearDuplicate));
  assert.equal(COMMENT_POOL_TARGET, 12);
  assert.equal(COMMENT_POOL_MINIMUM, 8);
  assert.equal(COMMENT_POOL_CLUSTER_THRESHOLD, 0.75);
  assert.equal(COMMENT_POOL_CLUSTER_LIMIT, 2);
  assert.equal(COMMENT_POOL_OPENING_LIMIT, 2);
});

test("uses the same low-cost model for the initial request and retry", () => {
  assert.equal(generationModel(0, 2), "gpt-5.4-mini");
  assert.equal(generationModel(1, 2), "gpt-5.4-mini");
});

test("turns an HTML gateway response into a safe Korean API error", async () => {
  const result = await readApiJson<{ job?: unknown }>(
    new Response("<!DOCTYPE html><html><body>Gateway Timeout</body></html>", { status: 504, headers: { "Content-Type": "text/html" } }),
    "교과 평어 생성을 시작하지 못했습니다.",
  );
  assert.match(result.error ?? "", /서버 응답 시간이 초과/);
  assert.doesNotMatch(result.error ?? "", /DOCTYPE|Unexpected token/);
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
  assert.equal(publicPools[0].canonicalSentence, "자료의 내용을 표현함.");
  assert.deepEqual(publicPools[0].commonGuide.requiredActions, ["표현하기"]);
  assert.equal(publicPools[0].commonGuide.completion, "completed");
  assert.equal(new Set(publicPools[0].variantPlans.map((plan) => JSON.stringify(plan))).size, 5);
});

test("builds a canonical sentence before asking AI for limited variants", () => {
  const cases = [
    ["작품을 읽고 재미나 감동을 느낀 부분과 그 까닭을 쓸 수 있다.", "작품을 읽고 재미나 감동을 느낀 부분과 그 까닭을 씀."],
    ["중심 문장과 뒷받침 문장을 파악하여 내용을 간추릴 수 있다.", "중심 문장과 뒷받침 문장을 파악하여 내용을 간추림."],
    ["자료를 한 가지 방법으로 만들 수 있다.", "자료를 한 가지 방법으로 만듦."],
    ["관찰한 결과를 기록할 수 있다.", "관찰한 결과를 기록함."],
    ["문장을 짜임에 따라 나눌 수 있다.", "문장을 짜임에 따라 나눔."],
  ];
  for (const [criterion, expected] of cases) {
    assert.equal(buildCanonicalCommentSentence(criterion), expected);
    assert.equal(validateGeneratedCommentPart(expected, criterion).valid, true, criterion);
    assert.deepEqual(criterionSemanticIssues(expected, criterion), []);
  }
});

test("uses the canonical sentence when AI pool candidates fail validation", () => {
  const [group] = buildCommentPoolGroups([{
    studentId: 1,
    subject: "과학",
    items: [{
      assessmentIndex: 0,
      level: "중" as const,
      criterion: "관찰한 결과를 기록할 수 있다.",
      text: "관찰 | 수준: 중 | 기준: 관찰한 결과를 기록할 수 있다.",
    }],
  }]);
  const result = assignUniquePoolCandidates(group, ["관찰함."]);
  assert.deepEqual(result.candidates, ["관찰한 결과를 기록함."]);
});

test("prepares a complete 105-area canonical baseline before optional AI replacement", () => {
  const criteria = [
    "작품 속 인물들의 상황에 알맞은 표정과 몸짓으로 대화를 표현할 수 있다.",
    "문장을 문장의 짜임에 따라 나누고 자료의 내용을 그 짜임에 맞게 표현할 수 있다.",
    "작품을 읽고 재미나 감동을 느낀 부분과 그 까닭을 쓸 수 있다.",
    "중심 문장과 뒷받침 문장을 파악하여 내용을 간추릴 수 있다.",
    "마음을 전하는 글을 쓰는 방법을 알고 글을 쓰기 위해 노력한다.",
  ];
  const baselines = Array.from({ length: 21 }, (_, studentIndex) => criteria.map((criterion, assessmentIndex) =>
    buildCanonicalBaselinePart(studentIndex + 1, "국어", {
      assessmentIndex,
      level: "중",
      criterion,
      text: `영역 ${assessmentIndex + 1} | 수준: 중 | 기준: ${criterion}`,
    }))).flat();
  assert.equal(baselines.length, 105);
  assert.equal(baselines.every(Boolean), true);
  assert.equal(new Set(baselines.filter(Boolean).map((part) => `${part.studentId}|${part.assessmentIndex}`)).size, 105);
  assert.equal(baselines.filter(Boolean).every((part) => part.warnings.length === 0), true);
});

test("assigns only revalidated deterministic candidates from an approved level pool", () => {
  const criterion = "효와 우애의 의미를 이해하고 실천할 수 있는 일을 비교적 알고 있으며 가족을 소중히 여기는 마음을 전한다.";
  const evidence = Array.from({ length: 21 }, (_, index) => ({
    studentId: index + 1,
    subject: "도덕",
    items: [{
      assessmentIndex: 1,
      level: "중" as const,
      criterion,
      text: `가족 | 수준: 중 | 기준: ${criterion}`,
    }],
  }));
  const [group] = buildCommentPoolGroups(evidence);
  const pool = buildApprovedCommentPool(group);
  assert.equal(pool.approvedCandidates.length >= 2, true);
  assert.equal(pool.approvedCandidates.includes(pool.canonicalSentence), true);
  const assigned = assignApprovedCommentPools(evidence);
  assert.equal(assigned.length, 21);
  assert.equal(new Set(assigned.map((part) => part.text)).size >= 2, true);
  assert.equal(assigned.every((part) => pool.approvedCandidates.includes(part.text)), true);
  assert.equal(assigned.every((part) => part.warnings.length === 0), true);
});

test("separates approved pools when the level or assessment criterion changes", () => {
  const makeGroup = (level: "상" | "중", criterion: string) => buildCommentPoolGroups([{
    studentId: 1,
    subject: "수학",
    items: [{ assessmentIndex: 0, level, criterion, text: `수와 연산 | 수준: ${level} | 기준: ${criterion}` }],
  }])[0];
  const middle = buildApprovedCommentPool(makeGroup("중", "계산 원리를 알고 문제를 해결할 수 있다."));
  const high = buildApprovedCommentPool(makeGroup("상", "계산 원리를 정확히 설명하고 문제를 해결할 수 있다."));
  assert.notEqual(middle.poolKey, high.poolKey);
  assert.notDeepEqual(middle.approvedCandidates, high.approvedCandidates);
});

test("reuses the canonical sentence instead of leaving a failed pool blank", () => {
  const assigned = assignApprovedCommentPools([1, 2, 3].map((studentId) => ({
    studentId,
    subject: "국어",
    items: [{
      assessmentIndex: 0,
      level: "상",
      criterion: "문장을 작성한다.",
      text: "쓰기 | 수준: 상 | 기준: 문장을 작성한다.",
    }],
  })));
  assert.equal(assigned.length, 3);
  assert.deepEqual(assigned.map((part) => part.text), [
    "문장을 작성함.",
    "문장을 작성함.",
    "문장을 작성함.",
  ]);
});

test("derives the same common generation guide from any subject criterion", () => {
  assert.deepEqual(
    buildCommonCommentGenerationGuide("교사의 도움을 받아 식물을 관찰하고 특징을 일부 분류하여 기록할 수 있다."),
    {
      requiredActions: ["관찰하기", "분류하기", "기록하기"],
      support: "입력에 명시된 도움을 받아 수행",
      scope: ["일부 수행"],
      completion: "completed",
      rules: [
        "평가기준에 있는 모든 독립 수행을 한 문장에 보존함",
        "각 수행 대상과 동사를 원문의 관계대로 연결함",
        "입력에 없는 활동·태도·방법·수행 정도를 추가하지 않음",
        "완료 수행을 내용임·결과임·모습임·해 봄으로 약화하지 않고 직접 동사로 종결함",
        "자연스러운 관찰 기반 명사형 문장과 마침표로 완결함",
      ],
    },
  );
  const process = buildCommonCommentGenerationGuide("자료를 비교하여 설명하기 위해 노력한다.");
  assert.deepEqual(process.requiredActions, ["비교하기", "설명하기"]);
  assert.equal(process.completion, "process");
  assert.equal(process.rules.some((rule) => rule.includes("완료 수행으로 높이지 않음")), true);
});

test("builds a bounded shared pool and cycles it for larger classes", () => {
  assert.equal(commentPoolCandidateCount(1), 5);
  assert.equal(commentPoolCandidateCount(5), 5);
  assert.equal(commentPoolCandidateCount(6), 6);
  assert.equal(commentPoolCandidateCount(10), 10);
  assert.equal(commentPoolCandidateCount(11), 11);
  assert.equal(commentPoolCandidateCount(20), 20);
  assert.equal(commentPoolCandidateCount(25), 20);
  assert.equal(commentPoolCandidateCount(0), 0);
});

test("spreads approved candidates with different openings before assignment", () => {
  assert.deepEqual(spreadCandidatesByOpening([
    "작품 속 인물의 대화를 표현함.",
    "작품 속 인물의 말투를 살려 표현함.",
    "문장의 짜임을 파악함.",
    "설명하는 글을 간추림.",
  ]), [
    "작품 속 인물의 대화를 표현함.",
    "문장의 짜임을 파악함.",
    "설명하는 글을 간추림.",
    "작품 속 인물의 말투를 살려 표현함.",
  ]);
});

test("rotates the first assessment area evenly across a class", () => {
  const parts = Array.from({ length: 5 }, (_, assessmentIndex) => ({ assessmentIndex, text: `영역 ${assessmentIndex + 1}.` }));
  const comments = Array.from({ length: 21 }, (_, index) => assembleRotatedComment(parts, index + 1));
  const starts = comments.map((comment) => comment.split(".")[0]);
  const counts = new Map(starts.map((start) => [start, starts.filter((item) => item === start).length]));
  assert.equal(counts.size, 5);
  assert.equal(Math.max(...counts.values()), 5);
  assert.equal(comments[1], "영역 2. 영역 3. 영역 4. 영역 5. 영역 1.");
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

test("converts 만들다 irregular inflection without treating it as sibling-level leakage", () => {
  const low = "모둠원의 도움을 받아 우리가 사는 곳의 장소 소개 자료를 만든다.";
  const levels = {
    high: "한 가지 방법을 골라 장소 소개 자료를 만들고 소개한다.",
    middle: "모둠원의 도움을 받아 장소 소개 자료를 만들고 소개한다.",
    low,
  };
  assert.equal(criterionToSafeNominalSentence(low), "모둠원의 도움을 받아 우리가 사는 곳의 장소 소개 자료를 만듦.");
  assert.deepEqual(criterionSemanticIssues("모둠원의 도움을 받아 우리가 사는 곳의 장소 소개 자료를 만듦.", low, levels), []);
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

test("creates fact-preserving free variants for repeated social-study criteria", () => {
  const discussion = "내가 생각하는 살기 좋은 곳의 조건과 그 이유를 한 가지 말하고, 친구들의 생각을 들으며 바른 자세로 토의에 임한다.";
  const discussionCandidates = criterionToSafeNominalCandidates(discussion);
  assert.equal(discussionCandidates.length, 3);
  discussionCandidates.forEach((candidate) => {
    assert.equal(validateGeneratedCommentPart(candidate, discussion).valid, true);
    assert.deepEqual(criterionSemanticIssues(candidate, discussion), []);
  });

  const localHistory = "지역 이름의 유래와 옛이야기를 조사하여 정리하고 글로 표현한다.";
  const historyCandidates = criterionToSafeNominalCandidates(localHistory);
  assert.equal(historyCandidates.length, 3);
  historyCandidates.forEach((candidate) => {
    assert.equal(validateGeneratedCommentPart(candidate, localHistory).valid, true);
    assert.deepEqual(criterionSemanticIssues(candidate, localHistory), []);
  });
});

test("blocks unsupported strong praise at every level unless the criterion supports it", () => {
  assert.deepEqual(levelAppropriatenessIssues("생활용품을 설계하는 수행이 돋보임.", "중"), ["평가수준보다 과도한 우수 표현"]);
  assert.deepEqual(levelAppropriatenessIssues("생활용품 설계 활동에 참여하는 모습이 인상적임.", "하"), ["평가수준보다 과도한 우수 표현"]);
  assert.deepEqual(levelAppropriatenessIssues("생활용품을 창의적으로 설계하는 능력이 뛰어남.", "상"), ["평가수준보다 과도한 우수 표현"]);
  assert.deepEqual(levelAppropriatenessIssues("생활용품을 창의적으로 설계하는 능력이 뛰어남.", "상", "창의적인 설계 능력이 뛰어나다."), []);
});

test("preserves generic criterion actions and performance degree across subjects and grades", () => {
  const fixtures = [
    {
      label: "도덕 다짐",
      criterion: "성실한 생활의 사례를 탐색하고 성실하게 살아가기 위한 자세와 태도를 다짐할 수 있다.",
      valid: "성실한 생활의 사례를 탐색하고 성실하게 살아가기 위한 자세와 태도를 다짐함.",
      invalid: "성실한 생활의 사례를 탐색하고 성실하게 살아가기 위한 자세와 태도가 돋보임.",
    },
    {
      label: "도덕 비교적 앎",
      criterion: "효와 우애의 의미를 이해하고 가족을 소중히 여기는 마음을 전하며 실천할 수 있는 일을 비교적 알고 있다.",
      valid: "효와 우애의 의미를 이해하고 가족을 소중히 여기는 마음을 전하며 실천할 수 있는 일을 비교적 알고 있음.",
      invalid: "효와 우애의 의미를 이해하고 가족을 소중히 여기는 마음을 전하며 실천할 수 있는 일을 깨달음.",
    },
    {
      label: "사회 조사",
      criterion: "지역의 생활 모습을 보여 주는 사례를 조사하고 그 특징을 비교적 알고 있다.",
      valid: "지역의 생활 모습을 보여 주는 사례를 조사하고 그 특징을 비교적 알고 있음.",
      invalid: "지역의 생활 모습을 보여 주는 사례를 조사하고 그 특징을 완전히 이해함.",
    },
    {
      label: "과학 탐색",
      criterion: "주변 생물의 특징을 사례를 통해 살펴보고 공통점을 대체로 이해할 수 있다.",
      valid: "주변 생물의 특징을 사례를 통해 살펴보고 공통점을 대체로 이해함.",
      invalid: "주변 생물의 특징을 사례를 통해 살펴보는 태도가 돋보임.",
    },
  ];
  for (const fixture of fixtures) {
    assert.deepEqual(criterionSemanticIssues(fixture.valid, fixture.criterion), [], fixture.label);
    assert.equal(
      criterionSemanticIssues(fixture.invalid, fixture.criterion).length
        + evidenceBlockingIssues(fixture.invalid, fixture.criterion, fixture.criterion).length
        + levelAppropriatenessIssues(fixture.invalid, "상", fixture.criterion).length > 0,
      true,
      fixture.label,
    );
  }
});

test("does not count a pure core-word reorder as genuine sentence diversity", () => {
  const evidence = "도덕 | 수준: 중 | 기준: 효와 우애의 의미를 이해하고 가족을 소중히 여기는 마음을 전한다.";
  const reasons = commentAreaOverlapReasons(
    { studentId: 1, subject: "도덕", assessmentIndex: 0, evidence, text: "효와 우애의 의미를 이해하고 가족을 소중히 여기는 마음을 전함." },
    { studentId: 2, subject: "도덕", assessmentIndex: 0, evidence, text: "가족을 소중히 여기는 마음을 전하고 효와 우애의 의미를 이해함." },
  );
  assert.equal(reasons.includes("핵심어 어순 변경 중복"), true);
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

test("accepts a short direct sentence when the selected criterion has little information", () => {
  const criterion = "모둠원의 도움을 받아 오래된 물건을 조사한다.";
  const result = validateGeneratedCommentPart("모둠원의 도움을 받아 오래된 물건을 조사함.", criterion);
  assert.equal(result.acceptedMinimum, 10);
  assert.equal(result.valid, true);
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

test("blocks every unsupported grounding warning from reusable comment pools", async () => {
  const { validatePoolCandidate } = await import("../app/comment-pool-library.ts");
  const spec = {
    fingerprint: "grounding", assessmentPlanId: 1, assessmentIndex: 0,
    subject: "국어", unit: "대화", goal: "상황에 맞게 표현하기", domain: "듣기·말하기",
    perspective: "상황에 맞게 표현하는가", level: "중" as const,
    criterion: "작품 속 인물들의 상황에 알맞은 표정, 몸짓, 목소리, 말투를 알고 대화를 표현함.",
    levelCriteria: {
      high: "작품 속 인물들의 상황에 알맞은 표정, 몸짓, 목소리, 말투를 알고 대화를 실감 나게 표현함.",
      middle: "작품 속 인물들의 상황에 알맞은 표정, 몸짓, 목소리, 말투를 알고 대화를 표현함.",
      low: "작품 속 인물들의 상황에 알맞은 표정, 몸짓, 목소리, 말투를 알고 대화를 표현하기 위해 노력함.",
    },
    canonicalSentence: "작품 속 인물들의 상황에 알맞은 표정, 몸짓, 목소리, 말투를 알고 대화를 표현함.",
  };
  assert.deepEqual(validatePoolCandidate(spec.canonicalSentence, spec).issues, []);
  for (const modifier of ["자신 있게", "스스로", "또박또박", "분명하게", "자연스럽게"]) {
    const result = validatePoolCandidate(
      `작품 속 인물들의 상황에 알맞은 표정, 몸짓, 목소리, 말투를 알고 대화를 ${modifier} 표현함.`,
      spec,
    );
    assert.equal(result.issues.some((issue) => issue.includes("평가 근거에 없는")), true, modifier);
  }
});

test("allows a manner modifier in a reusable pool when the selected criterion contains it", async () => {
  const { validatePoolCandidate } = await import("../app/comment-pool-library.ts");
  const criterion = "설명하는 글을 읽고 중심 문장과 뒷받침 문장을 파악하여 내용을 자연스럽게 간추림.";
  const spec = {
    fingerprint: "grounded-manner", assessmentPlanId: 1, assessmentIndex: 0,
    subject: "국어", unit: "간추리기", goal: "내용 간추리기", domain: "읽기",
    perspective: "내용을 간추리는가", level: "상" as const, criterion,
    levelCriteria: { high: criterion, middle: "내용을 간추림.", low: "도움을 받아 내용을 간추림." },
    canonicalSentence: criterion,
  };
  assert.deepEqual(validatePoolCandidate(criterion, spec).issues, []);
});

test("normalizes Korean declarative endings without subject-specific verb rules", () => {
  assert.equal(criterionToSafeNominalSentence("마음을 전하는 글을 쓴다."), "마음을 전하는 글을 씀.");
  assert.equal(criterionToSafeNominalSentence("소개 자료를 만든다."), "소개 자료를 만듦.");
  assert.equal(criterionToSafeNominalSentence("목적지까지 간다."), "목적지까지 감.");
  assert.equal(criterionToSafeNominalSentence("설명하는 글을 읽는다."), "설명하는 글을 읽음.");
});

test("validates connected and nominalized performances consistently across pool levels", async () => {
  const { validatePoolCandidate } = await import("../app/comment-pool-library.ts");
  const literature = buildCommentPoolSpecs([poolPlan({
    subject: "국어", domain: "문학",
    high: "작품을 읽고 재미나 감동을 느낀 부분과 그 까닭이 무엇인지 쓰고, 재미나 감동을 느낀 부분이 잘 드러나도록 다양한 방법으로 표현할 수 있다.",
    middle: "작품을 읽고 재미나 감동을 느낀 부분과 그 까닭이 무엇인지 쓸 수 있다.",
    low: "교사의 도움을 받아 작품을 읽고 재미나 감동을 느낀 부분과 그 까닭이 무엇인지 쓸 수 있다.",
  })]).find((spec) => spec.level === "상")!;
  assert.deepEqual(validatePoolCandidate(literature.canonicalSentence, literature).issues, []);

  const writing = buildCommentPoolSpecs([poolPlan({
    subject: "국어", domain: "쓰기",
    high: "마음을 전하는 글을 쓰는 방법을 알고, 활용하여 전하고자 하는 마음이 잘 드러나도록 글을 쓸 수 있다.",
    middle: "마음을 전하는 글을 쓰는 방법을 알고, 마음을 전하는 글을 쓰기 위해 노력한다.",
    low: "교사의 도움을 받아 마음을 전하는 글을 쓰는 방법을 알고, 마음을 전하는 글을 쓴다.",
  })]).find((spec) => spec.level === "하")!;
  assert.equal(writing.canonicalSentence.endsWith("글을 씀."), true);
  assert.deepEqual(validatePoolCandidate(writing.canonicalSentence, writing).issues, []);

  const crossSubject = buildCommentPoolSpecs([poolPlan({
    subject: "과학", domain: "탐구",
    high: "관찰한 결과를 기록하고 특징을 설명한다.",
    middle: "관찰한 결과를 기록한다.",
    low: "교사의 도움을 받아 관찰한 결과를 기록한다.",
  })]).find((spec) => spec.level === "상")!;
  assert.deepEqual(validatePoolCandidate(crossSubject.canonicalSentence, crossSubject).issues, []);
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

test("allows concrete literature methods only when the selected level supports diverse expression", () => {
  const context = "평가 관점: 작품에서 느낀 재미나 감동을 그림이나 시 등으로 표현할 수 있는가?";
  const middle = "작품을 읽고 재미나 감동을 느낀 부분과 그 까닭이 무엇인지 쓸 수 있다.";
  const high = "작품을 읽고 재미나 감동을 느낀 부분과 그 까닭을 쓰고 다양한 방법으로 표현할 수 있다.";
  assert.deepEqual(
    evidenceBlockingIssues("작품을 읽고 재미나 감동을 느낀 부분과 그 까닭을 시로 표현함.", `${context} | ${middle}`, middle),
    ["선택한 평가수준에 없는 구체적 표현 방법 ‘시’ 포함"],
  );
  assert.deepEqual(
    evidenceBlockingIssues("작품을 읽고 재미나 감동을 느낀 부분과 그 까닭을 시로 표현함.", `${context} | ${high}`, high),
    [],
  );
});

test("requires the selected high-level performance degree", () => {
  assert.deepEqual(
    evidenceBlockingIssues(
      "작품 속 인물의 상황에 알맞은 표정과 몸짓, 목소리, 말투를 알고 대화를 표현함.",
      "작품 속 인물의 상황에 알맞은 표정과 몸짓, 목소리, 말투를 알고 대화를 실감 나게 표현할 수 있다.",
    ),
    ["평가 기준의 필수 조건 ‘실감 나거나 생생한 표현 수준’ 누락"],
  );
});

test("blocks awkward Korean comment constructions found in stored results", () => {
  for (const sentence of [
    "작품에서 재미나 감동을 느낀 부분과 그 까닭을 작품을 읽고 씀.",
    "마음을 전하는 글을 쓰는 방법을 알고, 활용하여 마음이 잘 드러나는 글을 씀.",
    "작품 속 인물의 대화 표현에 힘씀.",
    "교사의 도움을 받아 마음을 전하는 글로 표현함.",
  ]) {
    assert.equal(validateGeneratedCommentPart(sentence, sentence).naturalEndingsOk, false);
  }
  assert.equal(repairSafeNominalEnding("마음이 잘 드러나도록 글을 써냄."), "마음이 잘 드러나도록 글을 써 냄.");
});

test("recognizes spaced nominal writing as a completed performance across subjects", async () => {
  const { validatePoolCandidate } = await import("../app/comment-pool-library.ts");
  const spec = buildCommentPoolSpecs([poolPlan({
    subject: "국어", domain: "문학",
    high: "작품을 읽고 재미나 감동을 느낀 부분과 그 까닭을 쓰고 다양한 방법으로 표현할 수 있다.",
    middle: "작품을 읽고 재미나 감동을 느낀 부분과 그 까닭을 쓸 수 있다.",
    low: "교사의 도움을 받아 작품을 읽고 재미나 감동을 느낀 부분과 그 까닭을 쓸 수 있다.",
  })]).find((item) => item.level === "하")!;
  assert.deepEqual(
    validatePoolCandidate("교사의 도움을 받아 작품을 읽고 재미나 감동을 느낀 부분과 그 까닭을 써 냄.", spec).issues,
    [],
  );
});

test("repairs only legacy unsupported modifiers into a fully revalidated pool sentence", () => {
  const spec = buildCommentPoolSpecs([poolPlan({
    high: "지역 자료를 다양한 방법으로 조사하여 체계적으로 정리함.",
    middle: "지역 자료를 조사하여 정리함.",
    low: "교사의 도움을 받아 지역 자료를 조사하여 정리함.",
  })]).find((item) => item.level === "중")!;
  assert.equal(
    repairLegacyPoolCandidate("지역 자료를 스스로 조사하여 자연스럽게 정리함.", spec)?.repaired,
    "지역 자료를 조사하여 정리함.",
  );
  assert.equal(repairLegacyPoolCandidate("지역 자료를 조사하여 정리함.", spec), null);
  assert.equal(repairLegacyPoolCandidate("지역 자료를 설명함.", spec), null);
});

test("blocks malformed predicates found in the full Korean comment sample", () => {
  for (const sentence of [
    "마음을 전하는 글을 쓸 때 쓰는 방법을 알고 이를 활용하여 전하고자 하는 마음이 잘 드러나도록 글을 함.",
    "마음을 전하는 글을 쓰는 방법을 알고 전하고자 하는 마음이 잘 드러나는 글로 활용함.",
    "작품에서 재미와 감동을 느낀 부분과 그 까닭을 읽고 써서 표현함.",
    "재미와 감동을 느낀 작품의 부분과 그 까닭을 쓰는 데서 드러남.",
    "작품 속 인물들의 상황에 알맞게 대화를 표현해 감.",
  ]) {
    const result = validateGeneratedCommentPart(sentence, sentence);
    assert.equal(result.valid, false, sentence);
    assert.equal(!result.naturalEndingsOk || result.predicateIssues.length > 0, true, sentence);
  }
});

test("blocks structurally malformed Korean writing predicates", () => {
  for (const sentence of [
    "작품을 읽고 재미나 감동을 느낀 부분과 그 까닭을 쓰며 글 씀.",
    "교사의 도움을 받아 마음을 전하는 글 쓰기함.",
    "마음을 전하는 글을 쓰는 데서 마음 쓰기함.",
    "교사의 도움을 받아 마음을 전하는 글을 쓰는 데서 마음을 전함.",
    "마음을 전하는 글을 쓰는 방법을 알고 전하고자 하는 마음의 글을 씀.",
    "작품의 재미나 감동을 느낀 부분과 그 까닭을 써 감상을 글로 씀.",
    "마음을 전하는 글을 쓰는 방법을 알고 마음을 전하는 글을 활용하여 씀.",
  ]) {
    const result = validateGeneratedCommentPart(sentence, sentence);
    assert.equal(result.valid, false, sentence);
    assert.equal(result.naturalEndingsOk, false, sentence);
  }

  for (const sentence of [
    "작품을 읽고 재미나 감동을 느낀 부분과 그 까닭을 글로 씀.",
    "교사의 도움을 받아 마음을 전하는 글을 씀.",
    "마음을 전하는 글을 쓰는 방법을 알고 전하고자 하는 마음이 드러나도록 글을 씀.",
  ]) {
    assert.equal(validateGeneratedCommentPart(sentence, sentence).naturalEndingsOk, true, sentence);
  }
});

test("derives completion policy from the criterion instead of patching individual phrases", () => {
  const completed = commentPredicatePolicy("상황에 알맞은 표정과 몸짓으로 작품 속 인물의 대화를 표현할 수 있다.");
  assert.equal(completed.completionMode, "completed");
  assert.equal(completed.requiredActions.includes("표현하기"), true);
  assert.deepEqual(
    commentPredicateIssues("상황에 알맞은 표정과 몸짓으로 작품 속 인물의 대화를 표현해 감.", "상황에 알맞게 대화를 표현할 수 있다."),
    ["완료 수행을 과정·모습·태도로 바꾼 모호한 종결"],
  );
  assert.deepEqual(
    commentPredicateIssues("상황에 알맞은 표정과 몸짓으로 작품 속 인물의 대화를 표현함.", "상황에 알맞게 대화를 표현할 수 있다."),
    [],
  );

  const process = commentPredicatePolicy("교사의 도움을 받아 대화를 표현하기 위해 노력한다.");
  assert.equal(process.completionMode, "process");
  assert.deepEqual(commentPredicateIssues("교사의 도움을 받아 대화를 표현하려고 노력함.", "교사의 도움을 받아 대화를 표현하기 위해 노력한다."), []);
});

test("requires each independent social-studies investigation action", () => {
  const criterion = "오래된 물건을 조사하는 다양한 방법을 알고 오래된 물건의 쓰임과 당시 생활 모습을 조사한 뒤 정리할 수 있다.";
  const valid = "오래된 물건을 조사하는 다양한 방법을 알고 물건의 쓰임과 당시 생활 모습을 조사한 뒤 정리함.";
  assert.deepEqual(criterionSemanticIssues(valid, criterion), []);

  const missingLife = criterionSemanticIssues("오래된 물건을 조사하는 다양한 방법을 알고 물건의 쓰임을 조사한 뒤 정리함.", criterion);
  assert.equal(missingLife.some((issue) => issue.includes("당시 생활 모습 조사하기")), true);

  const noInvestigation = criterionSemanticIssues("오래된 물건을 조사하는 다양한 방법을 알고 물건의 쓰임과 당시 생활 모습을 정리함.", criterion);
  assert.equal(noInvestigation.some((issue) => issue.includes("조사하기")), true);
});

test("blocks completed social-studies work weakened into state or ability endings", () => {
  const criterion = "모둠원의 도움을 받아 우리가 사는 곳의 장소 소개 자료를 만들고 소개할 수 있다.";
  for (const sentence of [
    "모둠원의 도움을 받아 우리가 사는 곳의 장소 소개 자료를 만들고 있음.",
    "모둠원의 도움을 받아 우리가 사는 곳의 장소 소개 자료를 만든 모습임.",
    "모둠원의 도움을 받아 우리가 사는 곳의 장소 소개 자료를 정리할 수 있음.",
  ]) {
    assert.equal(commentPredicateIssues(sentence, criterion).length > 0, true, sentence);
  }
});

test("blocks unsupported vague praise in social-studies writing", () => {
  const evidence = "지역 이름의 유래와 옛이야기를 조사하여 정리하고 글로 표현한다.";
  assert.equal(evidenceBlockingIssues("지역 이름의 유래와 옛이야기를 조사하여 정리하고 자세히 글로 표현함.", evidence).length > 0, true);
  assert.equal(evidenceBlockingIssues("지역 이름의 유래와 옛이야기를 조사하여 정리하고 글로 잘 표현함.", evidence).length > 0, true);
});

test("requires the original Korean performance instead of knowledge or effort substitutes", () => {
  const dialogue = "작품 속 인물들의 상황에 알맞은 표정, 몸짓, 목소리, 말투를 알고 대화를 실감 나게 표현할 수 있다.";
  const reaction = "작품을 읽고 재미와 감동을 느낀 부분과 그 까닭을 쓸 수 있다.";
  const letter = "마음을 전하는 글을 쓰는 방법을 알고 전하고자 하는 마음이 잘 드러나도록 글을 쓸 수 있다.";

  assert.equal(criterionSemanticIssues("작품 속 인물들의 상황에 알맞은 표정과 몸짓을 알고 있음.", dialogue).some((issue) => issue.includes("대화 표현하기")), true);
  assert.equal(criterionSemanticIssues("작품에서 재미와 감동을 느낀 부분을 읽고 정리함.", reaction).some((issue) => issue.includes("부분과 까닭 쓰기")), true);
  assert.equal(criterionSemanticIssues("마음을 전하는 글을 쓰는 방법을 알고 글을 쓰기 위해 노력함.", letter).some((issue) => issue.includes("실제로 쓰기")), true);

  assert.deepEqual(criterionSemanticIssues("작품 속 인물들의 상황에 알맞은 표정과 몸짓으로 대화를 실감 나게 표현함.", dialogue), []);
  assert.deepEqual(criterionSemanticIssues("작품을 읽고 재미와 감동을 느낀 부분과 그 까닭을 씀.", reaction), []);
  assert.deepEqual(criterionSemanticIssues("마음을 전하는 글을 쓰는 방법을 알고 전하고자 하는 마음이 드러나도록 글을 씀.", letter), []);
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

test("preserves independent performance actions across subjects and grades", () => {
  const cases = [
    {
      criterion: "식물의 생김새를 관찰하고 특징에 따라 분류하여 결과를 기록할 수 있다.",
      incomplete: "식물의 생김새를 관찰하고 특징에 따라 분류함.",
      missing: "기록하기",
      complete: "식물의 생김새를 관찰하고 특징에 따라 분류하여 결과를 기록함.",
    },
    {
      criterion: "두 해결 방법을 비교하고 알맞은 방법을 적용하여 문제를 해결할 수 있다.",
      incomplete: "두 해결 방법을 비교하고 알맞은 방법으로 문제를 해결함.",
      missing: "적용하기",
      complete: "두 해결 방법을 비교하고 알맞은 방법을 적용하여 문제를 해결함.",
    },
    {
      criterion: "작품의 특징을 조사하여 정리하고 글로 표현할 수 있다.",
      incomplete: "작품의 특징을 조사하여 글로 표현함.",
      missing: "정리하기",
      complete: "작품의 특징을 조사하여 정리하고 글로 표현함.",
    },
  ];
  for (const item of cases) {
    assert.equal(
      criterionSemanticIssues(item.incomplete, item.criterion).some((issue) => issue.includes(item.missing)),
      true,
      item.incomplete,
    );
    assert.deepEqual(criterionSemanticIssues(item.complete, item.criterion), []);
  }
});

test("blocks completed performance weakened into a generic result or trial", () => {
  const criterion = "자료를 조사하여 정리할 수 있다.";
  for (const sentence of [
    "자료를 조사하여 정리한 내용임.",
    "자료를 조사하여 정리한 결과임.",
    "자료를 조사하여 정리해 봄.",
  ]) {
    assert.equal(commentPredicateIssues(sentence, criterion).length > 0, true, sentence);
  }
  assert.deepEqual(commentPredicateIssues("자료를 조사하여 정리함.", criterion), []);
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

test("repairs or rejects indirect and malformed nominal endings", () => {
  assert.equal(repairSafeNominalEnding("모둠원의 도움을 받아 장소 소개 자료를 만드는 모습임."), "모둠원의 도움을 받아 장소 소개 자료를 만듦.");
  for (const sentence of [
    "모둠원의 도움 없이가 아니라 한 가지 방법으로 자료를 만듦.",
    "오래된 물건을 조사하여 정리하여 글로 표현함.",
    "친구의 생각을 들으며 토의하며 조건을 말함.",
    "오래된 물건을 조사함, 다양한 조사 방법을 알고 있음.",
  ]) assert.equal(validateGeneratedCommentPart(sentence).valid, false);
});

test("requires selected social-studies performance atoms and blocks sibling-level leakage", () => {
  const placeLevels = {
    high: "여러 가지 소개 방법 중 한 가지를 골라 우리 고장의 여러 장소를 소개하는 자료를 만들고 소개할 수 있다.",
    middle: "모둠원의 도움을 받아 우리 고장의 장소 소개 자료를 만들고 소개할 수 있다.",
    low: "모둠원의 도움을 받아 우리 고장의 장소 소개 자료를 만들 수 있다.",
  };
  assert.deepEqual(
    criterionSemanticIssues("모둠원의 도움을 받아 우리 고장의 장소 소개 자료를 만들고 소개함.", placeLevels.high, placeLevels),
    ["평가 기준의 필수 수행 ‘한 가지 방법 선택하기’ 누락", "선택하지 않은 평가수준의 수행 ‘도움을 받아 수행하기’ 포함"],
  );
  assert.deepEqual(
    criterionSemanticIssues("여러 소개 방법 중 한 가지를 골라 우리 고장의 장소 소개 자료를 만들고 소개함.", placeLevels.high, placeLevels),
    [],
  );

  const discussionLevels = {
    high: "살기 좋은 곳의 조건과 그 이유를 한 가지 말하고 친구들의 생각을 들으며 바른 자세로 토의할 수 있다.",
    middle: "살기 좋은 곳의 조건과 그 이유를 한 가지 말하고 토의에 참여할 수 있다.",
    low: "친구들의 생각을 들으며 토의에 참여할 수 있다.",
  };
  assert.deepEqual(
    criterionSemanticIssues("살기 좋은 곳의 조건과 이유를 말하며 친구들의 생각을 듣고 토의함.", discussionLevels.high, discussionLevels),
    ["평가 기준의 필수 수행 ‘바른 자세로 토의하기’ 누락"],
  );
  assert.deepEqual(
    criterionSemanticIssues("친구들의 생각을 들으며 살기 좋은 곳의 조건과 이유를 말하고 토의에 참여함.", discussionLevels.low, discussionLevels),
    ["선택하지 않은 평가수준의 수행 ‘조건과 이유 말하기’ 포함"],
  );
});

test("requires diverse investigation methods and completed written expression", () => {
  assert.deepEqual(
    criterionSemanticIssues(
      "오래된 물건의 조사 방법을 알고 조사 결과를 정리함.",
      "오래된 물건을 조사하는 다양한 방법을 알고 조사한 후 정리할 수 있다.",
    ),
    [
      "평가 기준의 필수 수행 ‘다양한 조사 방법 알기’ 누락",
      "평가 기준의 필수 수행 ‘조사하기’ 누락",
    ],
  );
  assert.deepEqual(
    criterionSemanticIssues(
      "지역 이름의 유래와 옛이야기를 조사하여 정리한 뒤 글로 표현하기 위해 준비함.",
      "지역 이름의 유래와 옛이야기를 조사하여 정리하고 글로 표현할 수 있다.",
    ),
    ["평가 기준의 필수 수행 ‘글로 표현하기’ 누락"],
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

test("does not show similar-expression diagnostics as an error type", () => {
  assert.deepEqual(commentAreaIssuesForDisplay("warning", ["표현 유사도 84%"]), []);
  assert.deepEqual(commentAreaIssuesForDisplay("needs_review", ["유사 표현 재생성이 완료되지 않아 교사 확인이 필요함"]), []);
  assert.deepEqual(commentAreaIssuesForDisplay("needs_review", ["평가 기준의 필수 조건 누락"]), ["평가 기준의 필수 조건 누락"]);
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
