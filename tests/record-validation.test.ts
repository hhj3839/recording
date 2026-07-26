import assert from "node:assert/strict";
import test from "node:test";
import { createBehaviorVariations } from "../app/behavior-variation.ts";
import { selectMostDiverseComments } from "../app/comment-diversity.ts";
import { createCommentVariations } from "../app/comment-variation.ts";
import { recordSimilarity, recordSimilarityDetails, validateBehaviorSource, validateRecord } from "../app/record-validation.ts";
import { confirmationIssue } from "../app/record-confirmation.ts";

test("distributes randomized comment styles across a class batch", () => {
  const variations = createCommentVariations(10);
  assert.equal(variations.length, 10);
  assert.equal(new Set(variations.slice(0, 6).map((item) => item.structure)).size, 6);
  assert.equal(new Set(variations.slice(0, 4).map((item) => item.opening)).size, 4);
  assert.equal(variations.every((item) => item.structure && item.opening && item.focusOrder), true);
});

test("distributes randomized behavior styles across a class batch", () => {
  const variations = createBehaviorVariations(10);
  assert.equal(variations.length, 10);
  assert.equal(new Set(variations.slice(0, 6).map((item) => item.structure)).size, 6);
  assert.equal(new Set(variations.slice(0, 4).map((item) => item.opening)).size, 4);
});

test("selects the least repetitive AI comment candidate", () => {
  const repeated = "수업에 성실하게 참여하며 자신의 생각을 구체적으로 표현함.";
  const distinct = "자료의 특징을 세밀하게 비교하여 새로운 상황에 알맞게 적용하는 능력이 돋보임.";
  const [selected] = selectMostDiverseComments([{
    studentId: 1, subject: "국어", comment: repeated, candidates: [repeated, distinct],
  }], [repeated]);
  assert.equal(selected.comment, distinct);
  assert.equal(selected.candidates[0], distinct);
});

test("accepts a valid school-record comment", () => {
  const result = validateRecord("학습 활동에 성실하게 참여하며 자신의 생각을 구체적으로 표현함.");
  assert.equal(result.valid, true);
  assert.equal(result.endingsOk, true);
  assert.deepEqual(result.forbidden, []);
  assert.equal(result.spellingOk, true);
});

test("detects conservative Korean spelling and spacing mistakes", () => {
  const result = validateRecord("맡은 역활을 수행할수 있으며  꾸준히 노력함..");
  assert.equal(result.valid, false);
  assert.equal(result.spellingOk, false);
  assert.equal(result.spellingIssues.some((issue) => issue.includes("역할")), true);
  assert.equal(result.spellingIssues.some((issue) => issue.includes("'수'")), true);
  assert.equal(result.spellingIssues.some((issue) => issue.includes("두 칸")), true);
  assert.equal(result.spellingIssues.some((issue) => issue.includes("문장부호")), true);
});

test("detects unbalanced parentheses", () => {
  const result = validateRecord("친구의 의견을 경청하고 자신의 생각을 표현함(꾸준함.");
  assert.equal(result.spellingOk, false);
  assert.equal(result.spellingIssues.includes("여는 괄호와 닫는 괄호의 개수가 다름"), true);
});

test("rejects forbidden terms and non-nominal endings", () => {
  const result = validateRecord("학원에서 배운 내용을 잘 발표했습니다.");
  assert.equal(result.valid, false);
  assert.deepEqual(result.forbidden, ["학원"]);
  assert.equal(result.endingsOk, false);
});

test("detects repeated sentences", () => {
  const result = validateRecord("친구를 배려함. 친구를 배려함.");
  assert.equal(result.valid, false);
  assert.equal(result.repeated.length, 1);
});

test("checks behavior byte length and growth expression", () => {
  let text = "꾸준한 노력으로 성장하는 모습을 보이며 ";
  while (new TextEncoder().encode(`${text}책임감 있는 태도가 돋보임.`).length < 500) {
    text += "학습 활동에 성실하게 참여하고 친구의 의견을 존중하며 ";
  }
  text += "책임감 있는 태도가 돋보임.";
  const result = validateRecord(text, true);
  assert.equal(result.bytes >= 500 && result.bytes <= 550, true);
  assert.equal(result.growthIncluded, true);
  assert.equal(result.valid, true);
  const looseEnding = validateRecord(text.replace(/돋보임\.$/, "생활함."), true);
  assert.equal(looseEnding.endingsOk, false);
});

test("measures similar records without using student identity", () => {
  const left = "수업에 성실하게 참여하며 친구의 의견을 경청하고 맡은 역할을 책임감 있게 수행함.";
  const right = "수업에 성실하게 참여하며 친구의 의견을 경청하고 맡은 역할을 책임감 있게 수행함.";
  const different = "풍부한 상상력을 바탕으로 미술 활동에서 색채를 다양하게 활용하고 독창적으로 표현함.";
  assert.equal(recordSimilarity(left, right), 1);
  assert.equal(recordSimilarity(left, different) < 0.3, true);
});

test("reports overlap percentage and shared phrases", () => {
  const left = "수업에 성실하게 참여하며 친구의 의견을 경청하고 맡은 역할을 책임감 있게 수행함.";
  const right = "수업에 성실하게 참여하며 친구의 의견을 경청하고 자신의 역할을 꾸준히 수행함.";
  const details = recordSimilarityDetails(left, right);
  assert.equal(details.score > 0.4, true);
  assert.equal(details.overlaps.some((phrase) => phrase.includes("수업에 성실하게 참여하며")), true);
});

test("blocks prohibited and sensitive observation data before AI generation", () => {
  assert.equal(validateBehaviorSource("친구의 의견을 경청하고 맡은 역할을 꾸준히 수행함.").valid, true);
  const prohibited = validateBehaviorSource("학원에서 배운 내용을 수업 중 설명함.");
  assert.equal(prohibited.valid, false);
  assert.deepEqual(prohibited.forbidden, ["학원"]);
  const sensitive = validateBehaviorSource("보호자 연락처는 010-1234-5678임.");
  assert.equal(sensitive.valid, false);
  assert.deepEqual(sensitive.sensitive, ["휴대전화 번호"]);
});

test("confirms a valid record without a separate AI fact-validation step", () => {
  const content = "학습 활동에 성실하게 참여하며 자신의 생각을 구체적으로 표현함.";
  assert.equal(confirmationIssue(content, 1, []), null);
});

test("blocks invalid or duplicate records during final confirmation", () => {
  const content = "학습 활동에 성실하게 참여하며 자신의 생각을 구체적으로 표현함.";
  assert.equal(confirmationIssue("학원에서 배운 내용을 발표했습니다.", 1, [])?.status, 400);
  assert.equal(confirmationIssue(content, 1, [{ studentId: 2, content }])?.status, 409);
});
