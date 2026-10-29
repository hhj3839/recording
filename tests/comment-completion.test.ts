import { test } from "node:test";
import assert from "node:assert/strict";
import { commentCompletion } from "../app/comment-completion.ts";

const part = (assessmentIndex: number, status = "complete", sentence = "표현함.") => ({ assessmentIndex, status, sentence });
test("partial paragraphs do not count as completed students", () => {
  assert.deepEqual(commentCompletion(["상", "중", "하"], "표현함.", [part(0)], []), { required: 3, saved: 1, complete: false });
});
test("all eligible areas including warning sentences count once", () => {
  assert.deepEqual(commentCompletion(["상", "미응시", "하", "평가 예정"], "표현함.", [part(0), part(0), part(2, "warning"), part(9)], []), { required: 2, saved: 2, complete: true });
});
test("failed and empty areas do not count", () => {
  assert.equal(commentCompletion(["상", "중"], "표현함.", [part(0, "needs_review"), part(1, "complete", " ")], []).saved, 0);
});
test("manual edits retain completion through generation snapshot", () => {
  assert.equal(commentCompletion(["상"], "수정함.", [], [{ assessmentIndex: 0, level: "상" }]).complete, true);
  assert.equal(commentCompletion(["중"], "수정함.", [], [{ assessmentIndex: 0, level: "상" }]).complete, false);
});
test("empty records and no eligible levels are not complete", () => {
  assert.equal(commentCompletion(["상"], "", [part(0)], []).complete, false);
  assert.equal(commentCompletion(["미응시"], "표현함.", [part(0)], []).complete, false);
  assert.equal(commentCompletion(["상"], "표현함.", [], []).complete, false);
});
