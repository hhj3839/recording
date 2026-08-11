import assert from "node:assert/strict";
import test from "node:test";
import { selectCommentLoadScope } from "../scripts/load-test-scope.mjs";

const students = Array.from({ length: 25 }, (_, index) => ({ id: index + 1 }));
const subjects = ["국어", "사회", "도덕", "수학", "과학", "음악", "미술", "체육", "영어"];

test("comment preflight matches the paid five-student sample scope", () => {
  const preflight = selectCommentLoadScope("preflight", students, subjects);
  const sample = selectCommentLoadScope("sample", students, subjects);
  assert.deepEqual(preflight, sample);
  assert.equal(preflight.selectedStudents.length, 5);
  assert.deepEqual(preflight.selectedSubjects, ["국어"]);
});

test("subject and full scopes remain unchanged", () => {
  assert.equal(selectCommentLoadScope("subject", students, subjects).selectedStudents.length, 25);
  assert.deepEqual(selectCommentLoadScope("subject", students, subjects).selectedSubjects, ["국어"]);
  assert.equal(selectCommentLoadScope("start", students, subjects).selectedStudents.length, 25);
  assert.equal(selectCommentLoadScope("start", students, subjects).selectedSubjects.length, 9);
});
