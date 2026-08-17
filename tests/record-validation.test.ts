import assert from "node:assert/strict";
import test from "node:test";
import { createBehaviorVariations } from "../app/behavior-variation.ts";
import { selectMostDiverseComments } from "../app/comment-diversity.ts";
import { createCommentVariations } from "../app/comment-variation.ts";
import { countBehaviorCharacteristics, recordSimilarity, recordSimilarityDetails, validateBehaviorSource, validateRecord } from "../app/record-validation.ts";
import { parseStudentRosterText } from "../app/student-roster-parser.ts";
import { parseAssessmentPlanText } from "../app/assessment-plan-parser.ts";
import { isStrongPassword } from "../app/password-policy.ts";
import { validateSignupProfile } from "../app/signup-policy.ts";
import { assessmentPlanWarnings, validateAssessmentPlanRow } from "../app/assessment-plan-policy.ts";
import { CLASS_DATA_TABLES } from "../app/class-data-tables.ts";
import { commentAreaOverlapReasons, findCommentAreaOverlaps } from "../app/comment-area-diversity.ts";

test("requires the same strong password policy for signup and password changes", () => {
  assert.equal(isStrongPassword("shortA1"), false);
  assert.equal(isStrongPassword("alllowercase123"), false);
  assert.equal(isStrongPassword("NOLOWERCASE123"), false);
  assert.equal(isStrongPassword("NoNumbersHere"), false);
  assert.equal(isStrongPassword("StrongPass123"), true);
});

test("requires complete and valid teacher classroom metadata at signup", () => {
  const valid = { displayName: "홍교사", schoolName: "라온초등학교", schoolYear: 2026, semester: 1, grade: 3, classNumber: 1 };
  assert.equal(validateSignupProfile(valid), "");
  assert.match(validateSignupProfile({ ...valid, displayName: "" }), /교사 이름/);
  assert.match(validateSignupProfile({ ...valid, schoolName: "" }), /학교명/);
  assert.match(validateSignupProfile({ ...valid, schoolYear: 1999 }), /학년도/);
  assert.match(validateSignupProfile({ ...valid, semester: 3 }), /학기/);
  assert.match(validateSignupProfile({ ...valid, grade: 7 }), /학년/);
  assert.match(validateSignupProfile({ ...valid, classNumber: 0 }), /반/);
});

test("uses one complete table list for classroom and privacy deletion", () => {
  assert.deepEqual(CLASS_DATA_TABLES, [
    "assessment_levels",
    "generated_comment_parts",
    "generated_comments",
    "student_behaviors",
    "record_revisions",
    "generation_jobs",
    "assessment_plan_versions",
    "pilot_feedback",
    "assessment_plans",
    "students",
    "ai_usage_events",
  ]);
});

test("parses pasted student numbers and names separated by tabs or spaces", () => {
  assert.deepEqual(parseStudentRosterText("1\t강예린\n2 김민성\n3   김민준\n4\t김선").students, [
    { number: 1, name: "강예린" },
    { number: 2, name: "김민성" },
    { number: 3, name: "김민준" },
    { number: 4, name: "김선" },
  ]);
  assert.match(parseStudentRosterText("1 강예린\n1 김민성").error, /중복 번호/);
});

test("parses ten-column assessment plans pasted from a table", () => {
  const first = ["국어", "1. 생생하게 표현해요", "상황에 알맞게 표현할 수 있다.", "듣기·말하기", "구술 평가", "알맞게 표현하는가?", "정확하게 표현할 수 있다.", "알맞게 표현할 수 있다.", "도움을 받아 표현하기 위해 노력한다.", "다양한 표현을 고려한다."].join("\t");
  const second = ["국어", "2. 분명하고 유창하게", "문장을 바르게 표현할 수 있다.", "문법", "서술형 평가", "문장의 짜임을 아는가?", "정확하게 나눌 수 있다.", "일부 나눌 수 있다.", "도움을 받아 나눌 수 있다.", ""].join("\t");
  const result = parseAssessmentPlanText(`${first}\n${second}`);
  assert.equal(result.error, "");
  assert.equal(result.plans.length, 2);
  assert.equal(result.plans[0].subject, "국어");
  assert.equal(result.plans[1].caution, "");
  assert.match(parseAssessmentPlanText("국어\t1단원").error, /10개 열/);
});

test("validates assessment plan limits and warns about unusual labels", () => {
  const valid = {
    subject: "국어", unit: "1단원", goal: "알맞게 표현할 수 있다.", domain: "듣기·말하기",
    type: "구술", perspective: "상황에 맞게 표현하는가?", high: "정확하게 표현한다.",
    middle: "알맞게 표현한다.", low: "도움을 받아 표현한다.", caution: "",
  };
  assert.equal(validateAssessmentPlanRow(valid), "");
  assert.match(validateAssessmentPlanRow({ ...valid, subject: "가".repeat(31) }), /30자/);
  assert.equal(assessmentPlanWarnings({ ...valid, subject: "우리학교교과" }).length, 1);
  assert.equal(assessmentPlanWarnings({ ...valid, goal: valid.perspective }).length, 1);
});
import { confirmationIssue } from "../app/record-confirmation.ts";

test("distributes randomized comment styles across a class batch", () => {
  const variations = createCommentVariations(10);
  assert.equal(variations.length, 10);
  assert.equal(new Set(variations.slice(0, 6).map((item) => item.structure)).size, 6);
  assert.equal(new Set(variations.slice(0, 8).map((item) => item.opening)).size, 8);
  assert.equal(variations.every((item) => item.structure && item.opening && item.focusOrder && item.verbStrategy && item.endingStyle), true);
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

test("does not flag unavoidable evidence openings as style duplication", () => {
  const evidence = "1단원 | 듣기·말하기 | 목표: 상황에 맞게 표현하기 | 수준: 상 | 기준: 표정과 말투로 대화를 표현할 수 있다.";
  const first = { studentId: 1, subject: "국어", assessmentIndex: 0, evidence, text: "인물의 상황을 파악하여 알맞은 표정과 말투로 대화를 실감 나게 표현함." };
  const repeated = { studentId: 2, subject: "국어", assessmentIndex: 0, evidence, text: "인물의 상황을 파악하여 알맞은 몸짓과 목소리로 대화를 실감 나게 표현함." };
  assert.deepEqual(commentAreaOverlapReasons(repeated, first), []);
  const differentLevel = { ...repeated, evidence: evidence.replace("수준: 상", "수준: 중") };
  assert.deepEqual(commentAreaOverlapReasons(differentLevel, first), []);
  const differentArea = { ...repeated, assessmentIndex: 1 };
  assert.deepEqual(commentAreaOverlapReasons(differentArea, first), []);
});

test("always flags an identical sentence within the same area and level", () => {
  const evidence = "5단원 | 쓰기 | 목표: 마음을 전하는 글쓰기 | 수준: 중 | 기준: 마음을 전하는 글을 쓰기 위해 노력한다.";
  const first = { studentId: 1, subject: "국어", assessmentIndex: 4, evidence, text: "마음을 전하는 글을 쓰는 방법을 알고 글을 쓰기 위해 노력함." };
  const repeated = { ...first, studentId: 2 };
  assert.equal(commentAreaOverlapReasons(repeated, first).includes("동일 문장 중복"), true);
});

test("marks only later overlapping area sentences for one diversity repair", () => {
  const evidence = "1단원 | 문법 | 목표: 문장 짜임 이해 | 수준: 중 | 기준: 문장을 짜임에 따라 나눌 수 있다.";
  const parts = [
    { studentId: 1, subject: "국어", assessmentIndex: 0, evidence, text: "문장의 짜임을 살펴 주어진 문장을 기준에 따라 나누고 그 특징을 구체적으로 설명함." },
    { studentId: 2, subject: "국어", assessmentIndex: 0, evidence, text: "문장의 짜임을 살펴 제시된 문장을 기준에 따라 나누고 그 특징을 구체적으로 설명함." },
    { studentId: 3, subject: "국어", assessmentIndex: 0, evidence, text: "주어진 문장의 구조를 구분하고 각 성분이 이루는 관계를 알맞은 말로 정리하여 발표함." },
  ];
  const overlaps = findCommentAreaOverlaps({ candidates: parts, references: [] });
  assert.deepEqual(overlaps.map((item) => item.key), ["2|국어|0"]);
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

test("detects additional common Korean spelling mistakes", () => {
  const result = validateRecord("맡은 역활을 깨끗히 마무리 할려고 노력함.");
  assert.equal(result.spellingOk, false);
  assert.equal(result.spellingIssues.some((issue) => issue.includes("역할")), true);
  assert.equal(result.spellingIssues.some((issue) => issue.includes("깨끗이")), true);
  assert.equal(result.spellingIssues.some((issue) => issue.includes("하려고")), true);
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
  let first = "꾸준한 노력으로 성장하며 학습 활동에 성실하게 참여함.";
  const tail = " 친구의 의견을 존중하며 대화함. 맡은 역할을 책임감 있게 수행함. 준비물을 스스로 점검하는 습관을 기름.";
  while (new TextEncoder().encode(`${first}${tail}`).length < 500) {
    first = first.replace("학습 활동에 ", "학습 활동에 차분하고 성실한 태도로 ");
  }
  const text = `${first}${tail}`;
  const result = validateRecord(text, true);
  assert.equal(result.bytes >= 500 && result.bytes <= 600, true);
  assert.equal(result.growthIncluded, true);
  assert.equal(result.valid, true);
  const looseEnding = validateRecord(text.replace(/기름\.$/, "생활한다."), true);
  assert.equal(looseEnding.endingsOk, false);
});

test("accepts natural Korean nominal endings for behavior records", () => {
  const sentence = "수업에 성실히 참여함. 친구에게 도움을 줌. 맡은 일에 책임을 다함. 준비물을 서로 나눔.";
  const repeated = sentence.repeat(5);
  const result = validateRecord(repeated, true);
  assert.equal(result.endingsOk, true);
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
  for (const term of ["학교폭력", "징계", "질병", "진단명", "신체조건"]) {
    const source = validateBehaviorSource(`${term} 관련 내용`);
    assert.equal(source.valid, false);
    assert.deepEqual(source.sensitive, [`민감 내용: ${term}`]);
    assert.deepEqual(validateRecord(`${term} 관련 내용임.`, true).forbidden, [term]);
  }
});

test("counts labeled behavior characteristics and detects fewer than four", () => {
  assert.equal(countBehaviorCharacteristics("학습 태도: 성실함\n교우관계: 원만함\n책임감: 강함\n성장 모습: 발표함"), 4);
  assert.equal(countBehaviorCharacteristics("성실하게 참여함 · 친구를 배려함 · 역할을 수행함"), 3);
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
