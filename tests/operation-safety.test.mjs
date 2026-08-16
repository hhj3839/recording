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

test("job status polling wakes queued background generation without creating a new job", () => {
  for (const route of ["app/api/comment-jobs/route.ts", "app/api/behavior-jobs/route.ts"]) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /export async function GET\(request: Request\)/);
    assert.match(source, /\["queued", "running"\]\.includes\(.+\.status\).*startRunner\(request,/s);
  }
});

test("comment prompt forces natural 함 endings for reading summaries", () => {
  const source = readFileSync("app/comment-generation.ts", "utf8");
  assert.match(source, /마지막 두 글자는 반드시 ‘함\.’/);
  assert.match(source, /‘간추림\.’, ‘할 수 있음\.’, ‘모습임\.’, ‘하려 함\.’으로 끝내지 않는다/);
  assert.match(source, /중요한 내용을 간추려 정리함\./);
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
  assert.doesNotMatch(page, /countBehaviorCharacteristics\(item\.characteristic\) < 4/);
  assert.match(page, /한 가지 키워드만 입력해도 되지만/);
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
  assert.doesNotMatch(page, /생성 전<\/small>|className=\{validation\.[^}]+ \? "pass"/);
  assert.match(page, /issue-only-validation/);
  assert.match(page, /validation\.bytes < 500 \? \[`500B 미만 · 현재 \$\{validation\.bytes\}B`\]/);
  assert.match(page, /validation\.bytes > 600 \? \[`600B 초과 · 현재 \$\{validation\.bytes\}B`\]/);
  assert.equal((page.match(/className="secondary result-copy-button"/g) ?? []).length, 2);
  assert.match(page, /className="comment-row-actions review-cell-actions comment-review-actions"[\s\S]*다시 생성[\s\S]*선택한 부분 바꾸기/);
  assert.match(page, /if \(!eligibleIds\.length\) return setError\(`\$\{selectedSubject\}에서 상·중·하 평가수준이 입력된 학생이 없습니다\.`\)/);
  assert.match(page, /isRetry[\s\S]*다시 생성할 수 있는 학생이 없습니다[\s\S]*모든 생성 대상 학생에게 이미 작성되어 있습니다/);
  assert.doesNotMatch(page, /evidenceKey|setEvidenceKey|className="evidence-button"/);
  const css = readFileSync("app/globals.css", "utf8");
  const recordValidation = readFileSync("app/record-validation.ts", "utf8");
  assert.match(page, /className="comment-review-controls"[\s\S]*compact-similarity[\s\S]*comment-review-actions/);
  assert.match(css, /comment-review-cell>\.comment-review-controls\{display:inline-flex;width:max-content;max-width:100%;align-items:stretch;flex-direction:column;flex-wrap:nowrap;gap:0\}/);
  assert.match(css, /comment-review-cell \.review-cell-actions\{display:flex;align-items:center;gap:4px\}/);
  assert.match(css, /comment-review-cell \.review-cell-actions button\{width:auto;min-height:28px[^}]+font-size:9px/);
  assert.match(css, /compact-similarity\{display:block;box-sizing:border-box;width:100%/);
  assert.match(css, /behavior-review-cell>div:not\(\.review-cell-actions\):not\(\.similarity-detail\)>span\{box-sizing:border-box;width:100%;text-align:center\}/);
  assert.match(css, /behavior-split-table th:nth-child\(2\),\.behavior-split-table td:nth-child\(2\)\{width:64px\}/);
  assert.match(page, /<th>검수<\/th>[\s\S]*className="validation-cell behavior-validation issue-only-validation behavior-review-cell"/);
  assert.match(page, /behavior-review-cell[\s\S]*<ReviewWarning issues=\{behaviorReviewIssues\}[\s\S]*다시 생성/);
  assert.doesNotMatch(page, /issues\.length === 1/);
  assert.match(page, /createPortal\([\s\S]*review-warning-tooltip[\s\S]*document\.body/);
  assert.match(page, /document\.addEventListener\("pointerdown", closeOutside\)/);
  assert.match(page, /rect\.top > estimatedHeight \+ 16[\s\S]*rect\.bottom \+ 8/);
  assert.match(page, /window\.innerWidth - width - 12/);
  assert.match(css, /review-warning-tooltip\{position:fixed/);
  assert.match(css, /review-warning\{[^}]*min-height:28px[^}]*#dfaaa5[^}]*#fff0ee[^}]*#a33f38/);
  assert.match(css, /review-warning-tooltip\{position:fixed;z-index:10000/);
  assert.match(recordValidation, /bytes >= 500 && bytes <= 600/);
  assert.doesNotMatch(page, />길이 조정<\/button>/);
  assert.doesNotMatch(page, /<th>관리<\/th>[\s\S]*className="delete-student"/);
  assert.doesNotMatch(page, /function Assessments\([\s\S]{0,180}onDeleteStudent/);
  assert.match(page, /미입력 칸 채우기[\s\S]*미입력 칸에 적용[\s\S]*표에서 가져오기[\s\S]*엑셀 표 붙여넣기[\s\S]*현재 과목 전체 초기화/);
  assert.match(page, /기존에 입력한 칸은 변경하지 않습니다/);
  assert.match(page, /className="comment-review-controls"[\s\S]*compact-similarity[\s\S]*comment-review-actions/);
  assert.match(page, /compact-similarity"><strong>\{closest\.student\.name\} 학생과 \{Math\.round\(closest\.score \* 100\)\}%<\/strong><\/div>/);
});

test("clears a comment before regeneration without a confirmation dialog", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /mode === "regenerate"[\s\S]*discardPrevious: true[\s\S]*\/api\/generate-comment/);
  assert.doesNotMatch(page, /mode === "regenerate" && !window\.confirm/);
  assert.match(page, /disabled=\{!hasLevel \|\| !!rewriteBusyKey\}/);
});
