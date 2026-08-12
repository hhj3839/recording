import assert from "node:assert/strict";
import test from "node:test";
import { auditStoredResults, groundingWarnings, validateStoredBehavior, validateStoredComment } from "../scripts/stored-quality-audit-policy.mjs";

const strictSentence = "글의 중심 생각을 정확하게 파악하고 중요한 내용을 근거와 함께 정리하여 발표 활동에 꾸준히 참여함.";

test("validates stored comment format and grounding warnings", () => {
  assert.equal(validateStoredComment(strictSentence, 1).strict, true);
  assert.deepEqual(groundingWarnings("자료를 친구와 협력하여 적극적으로 분류함.", "자료를 기준에 따라 분류할 수 있다."), ["적극적으로", "친구와 협력"]);
});

test("validates every behavior strict criterion", () => {
  const text = `${"꾸준한 노력으로 성장 가능성을 보이며 맡은 역할을 책임감 있게 수행함. ".repeat(7)}`.trim();
  const result = validateStoredBehavior(text);
  assert.equal(typeof result.bytes, "number");
  assert.deepEqual(Object.keys(result.checks), ["length", "endings", "forbidden", "repeated", "growth", "spelling"]);
});

test("audits complete stored scope without claiming semantic targets", () => {
  const result = auditStoredResults({
    students: [{ id: 1 }],
    plan: [{ subject: "국어", high: strictSentence, middle: "", low: "" }],
    levels: [{ studentId: 1, subject: "국어", assessmentIndex: 0, level: "상" }],
    comments: [{ studentId: 1, subject: "국어", comment: strictSentence }], parts: [], behaviors: [],
  });
  assert.equal(result.scope.expectedComments, 1);
  assert.equal(result.comments.strictRate, 100);
  assert.equal(result.comments.failureCounts.sentenceCount, 0);
  assert.equal(result.comments.bySubject["국어"].strictRate, 100);
  assert.equal(result.comments.meaningTarget95Verified, false);
  assert.equal(result.comments.unsupportedFactTarget3Verified, false);
  assert.equal(result.behaviors.missing, 1);
});

test("audit runner contains GET-only data reads after login", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile("scripts/audit-stored-results.mjs", "utf8"));
  const afterLogin = source.slice(source.indexOf("const get ="));
  assert.doesNotMatch(afterLogin, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(afterLogin, /\/api\/(?:comment-jobs|behavior-jobs|generate-(?:all-)?(?:comment|behavior))/);
});
