import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

function runWithoutApproval(script, mode, approvalVariable) {
  const env = { ...process.env };
  delete env[approvalVariable];
  return spawnSync(process.execPath, [script, mode], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

test("blocks every paid comment load-test mode before login without explicit approval", () => {
  const cases = [
    ["sample", "RUN_COMMENT_5_TEST"],
    ["subject", "RUN_COMMENT_25_TEST"],
    ["start", "RUN_FULL_225_TEST"],
    ["missing-start", "RUN_MISSING_COMMENT_TEST"],
  ];
  for (const [mode, variable] of cases) {
    const result = runWithoutApproval("scripts/load-test-comments.mjs", mode, variable);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`${variable}=YES`));
    assert.doesNotMatch(result.stderr, /Lab credential|login failed/i);
  }
});

test("blocks behavior data writes and paid generation modes without explicit approval", () => {
  const cases = [
    ["seed", "SEED_BEHAVIOR_TEST_DATA"],
    ["sample", "RUN_BEHAVIOR_5_TEST"],
    ["full", "RUN_BEHAVIOR_25_TEST"],
  ];
  for (const [mode, variable] of cases) {
    const result = runWithoutApproval("scripts/load-test-behaviors.mjs", mode, variable);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`${variable}=YES`));
    assert.doesNotMatch(result.stderr, /Lab credential|login failed/i);
  }
});

test("always refreshes generated result counts without browser caching", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.equal((page.match(/fetch\("\/api\/generated-comments", \{ cache: "no-store" \}\)/g) ?? []).length, 4);
  assert.equal((page.match(/fetch\("\/api\/student-behaviors", \{ cache: "no-store" \}\)/g) ?? []).length, 4);

  for (const route of ["app/api/generated-comments/route.ts", "app/api/student-behaviors/route.ts"]) {
    assert.match(readFileSync(route, "utf8"), /"Cache-Control": "private, no-store"/);
  }
});

test("keeps missing comment audit outside paid generation modes", () => {
  const source = readFileSync("scripts/load-test-comments.mjs", "utf8");
  assert.match(source, /if \(mode === "missing"\)/);
  assert.doesNotMatch(source.match(/if \(mode === "missing"\)[\s\S]*?process\.exit\(0\);/)?.[0] ?? "", /method:\s*"POST"|\/api\/comment-jobs/);
});

test("behavior preflight uses the same five-student scope as the paid sample", () => {
  const source = readFileSync("scripts/load-test-behaviors.mjs", "utf8");
  assert.match(source, /mode === "sample" \|\| mode === "preflight" \? 5 : 25/);
  assert.match(source, /selectBehaviorLoadScope\(mode, ready, approvedStudentIds\)/);
});

test("keeps the simplified teacher-facing guidance", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /같은 반은 1년 동안 계속 사용할 수 있습니다/);
  assert.match(page, /다른 학기·학급 추가/);
  assert.match(page, /변환 프롬프트 복사/);
  assert.match(page, />평가계획 표<\/label>/);
  assert.doesNotMatch(page, />10열 평가계획 표<\/label>|변환한 10열 평가계획 표/);
  assert.doesNotMatch(page, /AI FORMAT HELPER|① 변환 프롬프트 복사|③ 변환된 10열 표/);
  assert.match(page, /왼쪽에 관찰한 키워드나 메모를 자유롭게 쓰고/);
  assert.match(page, /관찰 키워드·메모/);
  assert.match(page, /생성 결과/);
  assert.match(page, /behavior-split-table/);
  assert.match(page, /inputs\.filter\(\(item\) => countBehaviorCharacteristics\(item\.characteristic\) < 4\)/);
});

test("keeps wide comment tables inside their responsive container", () => {
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.comments-review-layout \.review-content\{min-width:0;width:100%\}/);
  assert.match(css, /\.comments-review-layout \.comments-table-wrap\{width:100%;max-width:100%;min-width:0\}/);
});

test("keeps the app shell keyboard and screen-reader friendly", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(page, /className="skip-link" href="#main-content"/);
  assert.match(page, /<main id="main-content" tabIndex=\{-1\}>/);
  assert.match(page, /aria-label="주요 메뉴"/);
  assert.match(page, /aria-current=\{view === item\.id \? "page" : undefined\}/);
  assert.match(page, /role="progressbar"/);
  assert.match(page, /aria-label="화면 이동"/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("keeps the simplified plan, assessment, and behavior toolbars", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /className="plan-saved-actions"/);
  assert.doesNotMatch(page, /progress=\{\(subject\) => subject === activeSubject/);
  assert.doesNotMatch(page, /입력 완료 <strong>|미입력 \{Math\.max/);
  assert.doesNotMatch(page, /referenceOpen|setReferenceOpen|참고자료 닫기|참고자료 열기/);
  assert.match(page, /행동특성 생성[\s\S]*행동특성만 복사하기[\s\S]*결과 초기화/);
  assert.match(page, /className="page-heading comments-page-heading"[\s\S]*className="subject-generation-controls"/);
  assert.match(page, /className="workspace-toolbar comments-toolbar comments-subject-toolbar"[\s\S]*<SubjectNavigator/);
  assert.doesNotMatch(page, /behavior-generation-summary|생성 대상<\/small>|특성을 4개 이상 입력한 학생 자동 포함/);
  assert.doesNotMatch(page, /validation\.bytes\}B|생성 전<\/small>|className=\{validation\.[^}]+ \? "pass"/);
  assert.match(page, /issue-only-validation/);
  assert.match(page, /!validation\.lengthOk && <span className="fail">길이 확인<\/span>/);
});
