import assert from "node:assert/strict";
import test from "node:test";
import { recordSimilarity, validateRecord } from "../app/record-validation.ts";

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
  while (new TextEncoder().encode(`${text}책임감 있게 생활함.`).length < 500) {
    text += "학습 활동에 성실하게 참여하고 친구의 의견을 존중하며 ";
  }
  text += "책임감 있게 생활함.";
  const result = validateRecord(text, true);
  assert.equal(result.bytes >= 500 && result.bytes <= 550, true);
  assert.equal(result.growthIncluded, true);
  assert.equal(result.valid, true);
});

test("measures similar records without using student identity", () => {
  const left = "수업에 성실하게 참여하며 친구의 의견을 경청하고 맡은 역할을 책임감 있게 수행함.";
  const right = "수업에 성실하게 참여하며 친구의 의견을 경청하고 맡은 역할을 책임감 있게 수행함.";
  const different = "풍부한 상상력을 바탕으로 미술 활동에서 색채를 다양하게 활용하고 독창적으로 표현함.";
  assert.equal(recordSimilarity(left, right), 1);
  assert.equal(recordSimilarity(left, different) < 0.3, true);
});
