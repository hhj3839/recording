import assert from "node:assert/strict";
import test from "node:test";
import { auditStoredResults, groundingWarnings, validateStoredBehavior, validateStoredComment } from "../scripts/stored-quality-audit-policy.mjs";
import { resolveStoredAuditScope } from "../scripts/stored-audit-scope-policy.mjs";
import { buildTeacherReviewSample, summarizeTeacherReview } from "../scripts/teacher-review-sample-policy.mjs";

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
  assert.equal(result.comments.remediation.readOnly, true);
  assert.equal(result.comments.remediation.automaticChangesAllowed, false);
  assert.equal(result.comments.remediation.formatCandidateCount, 0);
  assert.equal(result.behaviors.missing, 1);
});

test("classifies every stored comment issue without changing data", () => {
  const awkward = "자료의 특징을 자세히 살펴 분류 기준을 정확하게 세우고 결과를 알맞게 표현하고 함.";
  const result = auditStoredResults({
    students: [{ id: 7 }],
    plan: [{ subject: "사회", high: "자료를 기준에 따라 분류할 수 있다.", middle: "", low: "" }],
    levels: [{ studentId: 7, subject: "사회", assessmentIndex: 0, level: "상" }],
    comments: [{ studentId: 7, subject: "사회", comment: awkward }], parts: [], behaviors: [],
  });
  assert.equal(result.comments.remediation.formatCandidateCount, 1);
  assert.equal(result.comments.remediation.reasonCounts.awkwardNominalEnding, 1);
  assert.deepEqual(result.comments.remediation.formatCandidates[0].formatReasons.includes("awkwardNominalEnding"), true);
});

test("audit runner contains GET-only data reads after login", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile("scripts/audit-stored-results.mjs", "utf8"));
  const afterLogin = source.slice(source.indexOf("const get ="));
  assert.doesNotMatch(afterLogin, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(afterLogin, /\/api\/(?:comment-jobs|behavior-jobs|generate-(?:all-)?(?:comment|behavior))/);
});

test("marks an unspecified audit as diagnostic instead of an official result", () => {
  const scope = resolveStoredAuditScope({
    env: {},
    classroom: { id: 10, schoolName: "기록샘 실험실", schoolYear: 2026, semester: 1, grade: 3, classNumber: 1 },
    students: [{ id: 1, name: "학생01" }],
  });
  assert.equal(scope.mode, "diagnostic");
  assert.equal(scope.officialEligible, false);
  assert.equal(scope.targetVerified, false);
});

test("requires and verifies the active classroom for an official audit", () => {
  const classroom = { id: 10, schoolName: "정상 기준 학급", schoolYear: 2026, semester: 1, grade: 3, classNumber: 1 };
  const scope = resolveStoredAuditScope({
    env: { AUDIT_MODE: "official", AUDIT_CLASSROOM_ID: "10" }, classroom, students: [{ id: 1, name: "학생01" }],
  });
  assert.equal(scope.officialEligible, true);
  assert.equal(scope.targetVerified, true);
  assert.throws(
    () => resolveStoredAuditScope({ env: { AUDIT_MODE: "official", AUDIT_CLASSROOM_ID: "11" }, classroom, students: [] }),
    /classroom mismatch/,
  );
});

test("blocks fixture data from official quality metrics", () => {
  assert.throws(
    () => resolveStoredAuditScope({
      env: { AUDIT_MODE: "official", AUDIT_CLASSROOM_ID: "20" },
      classroom: { id: 20, schoolName: "기록샘 UI 오류 점검", schoolYear: 2026, semester: 1, grade: 3, classNumber: 2 },
      students: [{ id: 1, name: "오류학생01" }],
    }),
    /Official audit blocked by fixture signals/,
  );
  assert.throws(
    () => resolveStoredAuditScope({
      env: { AUDIT_MODE: "official", AUDIT_CLASSROOM_ID: "10" },
      classroom: { id: 10, schoolName: "기록샘 실험실", schoolYear: 2026, semester: 1, grade: 3, classNumber: 1 },
      students: [{ id: 1, name: "학생01" }],
      comments: [{ studentId: 1, comment: "학원에서 대회 실적을 준비하며 되여" }],
      behaviors: [],
    }),
    /knownFixtureContent/,
  );
});

test("teacher review summarizer only reads a local review file", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile("scripts/summarize-teacher-review.mjs", "utf8"));
  assert.doesNotMatch(source, /fetch\s*\(|method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  assert.match(source, /readFile\(file/);
});

test("creates a deterministic anonymous teacher review sample without student identifiers", () => {
  const sample = buildTeacherReviewSample({
    students: [{ id: 7, number: 12, name: "홍길동" }],
    plan: [{ subject: "국어", high: "중심 생각을 근거와 함께 설명할 수 있다.", middle: "", low: "" }],
    levels: [{ studentId: 7, subject: "국어", assessmentIndex: 0, level: "상" }],
    comments: [{ studentId: 7, subject: "국어", comment: strictSentence }],
    auditResult: { comments: { remediation: { meaningReviewCandidates: [] } } },
    limit: 30,
  });
  assert.equal(sample.selected, 1);
  assert.equal(sample.rows[0].reviewCode, "R001");
  assert.equal(sample.rows[0].evidence, "중심 생각을 근거와 함께 설명할 수 있다.");
  assert.equal(sample.rows[0].judgment.meaningMatch, "pending");
  assert.equal("studentId" in sample.rows[0], false);
  assert.doesNotMatch(JSON.stringify(sample), /홍길동|"number":12|"id":7/);
});

test("summarizes completed teacher judgments against PRD targets", () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    judgment: { meaningMatch: index < 95 ? "pass" : "fail", unsupportedFact: index < 3 ? "yes" : "no" },
  }));
  assert.deepEqual(summarizeTeacherReview(rows), {
    decided: 100,
    meaningMatchRate: 95,
    meaningTarget95Met: true,
    unsupportedFactRate: 3,
    unsupportedFactTarget3Met: true,
    complete: true,
  });
});
