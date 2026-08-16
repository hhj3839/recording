import assert from "node:assert/strict";
import test from "node:test";
import { commentLoadOverwriteExisting, selectBehaviorLoadScope, selectCommentLoadScope } from "../scripts/load-test-scope.mjs";

const students = Array.from({ length: 25 }, (_, index) => ({ id: index + 1 }));
const subjects = ["국어", "사회", "도덕", "수학", "과학", "음악", "미술", "체육", "영어"];

test("comment preflight matches the paid five-student sample scope", () => {
  const preflight = selectCommentLoadScope("preflight", students, subjects);
  const sample = selectCommentLoadScope("sample", students, subjects);
  assert.deepEqual(preflight, sample);
  assert.equal(preflight.selectedStudents.length, 5);
  assert.deepEqual(preflight.selectedSubjects, ["국어"]);
});

test("paid five-student comment sample replaces old parts to test the current prompt", () => {
  assert.equal(commentLoadOverwriteExisting("preflight"), false);
  assert.equal(commentLoadOverwriteExisting("sample"), true);
  assert.equal(commentLoadOverwriteExisting("subject"), false);
  assert.equal(commentLoadOverwriteExisting("start"), false);
});

test("subject and full scopes remain unchanged", () => {
  assert.equal(selectCommentLoadScope("subject", students, subjects).selectedStudents.length, 25);
  assert.deepEqual(selectCommentLoadScope("subject", students, subjects).selectedSubjects, ["국어"]);
  assert.equal(selectCommentLoadScope("start", students, subjects).selectedStudents.length, 25);
  assert.equal(selectCommentLoadScope("start", students, subjects).selectedSubjects.length, 9);
});

test("behavior preflight and sample prioritize the same five strict failures", () => {
  const ready = Array.from({ length: 25 }, (_, index) => ({ studentId: index + 101, strict: ![5, 11, 14, 16, 17, 19, 20, 24].includes(index) }));
  const expectedIds = [106, 112, 115, 117, 118];
  assert.deepEqual(selectBehaviorLoadScope("preflight", ready).map((item) => item.studentId), expectedIds);
  assert.deepEqual(selectBehaviorLoadScope("sample", ready).map((item) => item.studentId), expectedIds);
  assert.deepEqual(selectBehaviorLoadScope("full", ready).map((item) => item.studentId), ready.map((item) => item.studentId));
});

test("behavior scope never adds students outside explicit approval", () => {
  const ready = Array.from({ length: 25 }, (_, index) => ({ studentId: index + 101, strict: false }));
  const approved = [120, 121, 125];
  assert.deepEqual(selectBehaviorLoadScope("preflight", ready, approved).map((item) => item.studentId), approved);
  assert.deepEqual(selectBehaviorLoadScope("sample", ready, approved).map((item) => item.studentId), approved);
});
