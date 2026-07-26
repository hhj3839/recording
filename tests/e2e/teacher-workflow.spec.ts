import { expect, test, type Page } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

async function credentials() {
  if (process.env.E2E_EMAIL && process.env.E2E_PASSWORD) {
    return { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD };
  }
  const directory = path.resolve(".local-secrets");
  const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
  if (!files.length) throw new Error("E2E_EMAIL/E2E_PASSWORD 또는 실험실 계정 파일이 필요합니다.");
  const content = await readFile(path.join(directory, files.at(-1)!), "utf8");
  const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
  const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
  if (!email || !password) throw new Error("실험실 계정 파일 형식이 올바르지 않습니다.");
  return { email, password };
}

async function login(page: Page) {
  const account = await credentials();
  await page.goto("/login");
  await page.getByLabel("이메일").fill(account.email);
  await page.getByLabel("비밀번호").fill(account.password);
  await page.locator("button.auth-submit").click();
  await expect(page.getByRole("heading", { name: "안녕하세요" })).toBeVisible();
}

async function navigate(page: Page, label: string, view: string) {
  const mobileNavigation = page.locator(".mobile-header select");
  if (await mobileNavigation.isVisible()) {
    await mobileNavigation.selectOption(view);
    return;
  }
  await page.getByRole("button", { name: label }).click();
}

test("로그인부터 명단·평가계획·평가수준·교과 평어 화면까지 연결된다", async ({ page }) => {
  await login(page);

  const classroomResponse = await page.request.get("/api/classrooms");
  expect(classroomResponse.ok()).toBeTruthy();
  let existing = await classroomResponse.json() as {
    classrooms: Array<{ id: number; schoolName: string; schoolYear: number; semester: number; grade: number; classNumber: number }>;
  };
  for (const stale of existing.classrooms.filter((item) => item.schoolName === "기록샘E2E검증초")) {
    const cleanup = await page.request.delete("/api/classrooms", {
      data: { id: stale.id, confirmation: "학급삭제" },
    });
    expect(cleanup.ok(), "이전 E2E 임시 학급 정리에 실패했습니다.").toBeTruthy();
  }
  existing = await (await page.request.get("/api/classrooms")).json() as typeof existing;
  const candidate = Array.from({ length: 11 }, (_, index) => ({
    schoolYear: 2099,
    semester: 2,
    grade: 6,
    classNumber: 20 + index,
  })).find((item) => !existing.classrooms.some((current) =>
    current.schoolYear === item.schoolYear
    && current.semester === item.semester
    && current.grade === item.grade
    && current.classNumber === item.classNumber));
  expect(candidate, "E2E용 빈 학급 번호가 필요합니다.").toBeTruthy();

  let classroomId: number | undefined;
  try {
    await navigate(page, "학급 관리", "classes");
    const form = page.locator(".classroom-create-panel form");
    await form.locator("input").nth(0).fill("기록샘E2E검증초");
    await form.locator("input").nth(1).fill(String(candidate!.schoolYear));
    await form.locator("select").nth(0).selectOption(String(candidate!.semester));
    await form.locator("select").nth(1).selectOption(String(candidate!.grade));
    await form.locator("input").nth(2).fill(String(candidate!.classNumber));
    const createdResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/classrooms") && response.request().method() === "POST");
    await form.getByRole("button", { name: "새 학급 추가 후 전환" }).click();
    expect((await createdResponse).ok()).toBeTruthy();

    const refreshedClassrooms = await (await page.request.get("/api/classrooms")).json() as {
      classrooms: Array<{ id: number; schoolYear: number; semester: number; grade: number; classNumber: number }>;
    };
    classroomId = refreshedClassrooms.classrooms.find((item) =>
      item.schoolYear === candidate!.schoolYear
      && item.semester === candidate!.semester
      && item.grade === candidate!.grade
      && item.classNumber === candidate!.classNumber)?.id;
    expect(classroomId).toBeTruthy();
    const selectedClassroom = await page.request.put("/api/classrooms", { data: { id: classroomId } });
    expect(selectedClassroom.ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByRole("button", { name: /기록샘E2E검증초/ })).toBeVisible();

    await navigate(page, "학생 관리", "students");
    await page.getByLabel("번호와 이름 명단").fill("1\t테스트가람\n2\t테스트나래");
    const rosterResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/students") && response.request().method() === "PUT");
    await page.getByRole("button", { name: "명단 인식·추가" }).click();
    expect((await rosterResponse).ok()).toBeTruthy();
    await expect(page.locator('input[value="테스트가람"]')).toBeVisible();
    await expect(page.locator('input[value="테스트나래"]')).toBeVisible();

    await navigate(page, "평가계획 관리", "plans");
    const planRow = [
      "국어", "1. 표현하기", "상황에 맞게 표현할 수 있다.", "듣기·말하기", "구술 평가",
      "상황에 맞는 표현을 사용하는가?", "상황을 정확히 파악하여 실감 나게 표현할 수 있다.",
      "상황을 파악하여 알맞게 표현할 수 있다.", "교사의 도움을 받아 상황에 맞게 표현할 수 있다.",
      "표현 방법이 다양할 수 있음을 고려한다.",
    ].join("\t");
    await page.locator(".plan-paste-entry textarea").fill(planRow);
    await page.getByRole("button", { name: "표 이해하기" }).click();
    await expect(page.getByRole("heading", { name: /저장 전 미리보기 · 1개/ })).toBeVisible();
    const planResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/assessment-plan") && response.request().method() === "PUT");
    await page.getByRole("button", { name: "검증된 계획 저장" }).click();
    expect((await planResponse).ok()).toBeTruthy();
    await expect(page.getByRole("heading", { name: "저장된 평가계획 · 1개" })).toBeVisible();

    await navigate(page, "평가 수준 입력", "assessments");
    await expect(page.getByRole("heading", { name: "평가 수준 입력" })).toBeVisible();
    await expect(page.locator(".assessment-workspace-toolbar .unified-subject-tabs").getByRole("button", { name: /국어/ })).toBeVisible();
    await page.getByText("일괄 입력 도구", { exact: true }).click();
    await page.getByRole("button", { name: "미입력 전체 적용" }).click();
    const levelResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/assessment-levels") && response.request().method() === "PUT");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    expect((await levelResponse).ok()).toBeTruthy();
    await expect(page.getByText("변경사항을 저장했습니다.")).toBeVisible();

    await navigate(page, "평가계획 관리", "plans");
    await page.locator(".plan-card-details summary").click();
    const goalInput = page.locator(".plan-card-fields input").nth(0);
    await goalInput.fill("상황에 맞는 표현을 활용하여 자연스럽게 발표할 수 있다.");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toMatch(/학생 평가수준이 입력되어 있습니다/);
      await dialog.accept();
    });
    const confirmedPlanUpdate = page.waitForResponse((response) =>
      response.url().endsWith("/api/assessment-plan")
      && response.request().method() === "PATCH"
      && response.status() === 200);
    await page.getByRole("button", { name: "수정 저장" }).click();
    expect((await confirmedPlanUpdate).ok()).toBeTruthy();
    await expect(page.getByText("평가계획을 수정했습니다.")).toBeVisible();

    const classData = await (await page.request.get("/api/class-data")).json() as {
      students: Array<{ id: number; number: number; name: string }>;
    };
    const orderedStudents = [...classData.students].sort((left, right) => left.number - right.number);
    const seededComments = [
      "인물의 상황을 세심하게 살피고 알맞은 표정과 목소리를 활용하여 대화를 자연스럽고 실감 나게 표현함.",
      "문장의 짜임을 정확하게 파악하고 자료의 내용을 알맞은 문장으로 구성하여 자신의 생각을 분명하게 표현함.",
    ];
    for (const [index, student] of orderedStudents.entries()) {
      const saved = await page.request.put("/api/generated-comments", {
        data: { studentId: student.id, subject: "국어", comment: seededComments[index], confirmed: false },
      });
      expect(saved.ok(), `${student.name} 학생의 E2E 평어 저장에 실패했습니다.`).toBeTruthy();
    }

    await navigate(page, "교과 평어", "comments");
    await expect(page.getByRole("heading", { name: "전 과목 교과 평어" })).toBeVisible();
    await expect(page.getByRole("button", { name: "✦ AI 평어 생성" })).toBeVisible();
    await expect(page.locator(".comments-toolbar .unified-subject-tabs").getByRole("button", { name: /국어/ })).toBeVisible();
    await expect(page.locator(".subject-comments-table textarea")).toHaveCount(2);
    await expect(page.locator(".subject-comments-table textarea").nth(0)).toHaveValue(seededComments[0]);
    await expect(page.locator(".subject-comments-table textarea").nth(1)).toHaveValue(seededComments[1]);
    await page.getByRole("button", { name: "평어만 복사하기" }).click();
    await expect(page.getByRole("button", { name: "복사됨 ✓" })).toBeVisible();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText.replaceAll("\r\n", "\n")).toBe(seededComments.join("\n"));

    const seededCharacteristics = [
      "학습 태도: 수업에 성실히 참여함\n교우관계: 친구의 말을 경청함\n책임감: 맡은 역할을 끝까지 수행함\n성장 모습: 발표에 꾸준히 참여함",
      "학습 태도: 궁금한 점을 질문함\n협력: 모둠 활동에 적극적으로 참여함\n자기관리: 준비물을 스스로 점검함\n성장 모습: 자신의 생각을 구체적으로 표현함",
    ];
    const seededBehaviors = [
      "수업에 성실히 참여하고 친구의 말을 경청하며 맡은 역할을 끝까지 수행하는 책임감이 돋보임.",
      "궁금한 점을 질문으로 해결하고 모둠 활동에 협력하며 준비물을 스스로 점검하는 습관을 실천함.",
    ];
    for (const [index, student] of orderedStudents.entries()) {
      const saved = await page.request.put("/api/student-behaviors", {
        data: {
          studentId: student.id,
          characteristic: seededCharacteristics[index],
          behavior: seededBehaviors[index],
          confirmed: false,
        },
      });
      expect(saved.ok(), `${student.name} 학생의 E2E 행동특성 저장에 실패했습니다.`).toBeTruthy();
    }

    await navigate(page, "행동특성", "behavior");
    await expect(page.getByRole("heading", { name: "행동특성 작성" })).toBeVisible();
    await expect(page.getByText("특성을 입력한 학생은 자동 포함", { exact: false })).toBeVisible();
    await expect(page.getByLabel("관찰 사실 입력 학생 전체 선택")).toHaveCount(0);
    await expect(page.locator('.behavior-table input[type="checkbox"]')).toHaveCount(0);
    const behaviorRows = page.locator(".behavior-table tbody tr");
    await expect(behaviorRows).toHaveCount(2);
    await expect(behaviorRows.nth(0).locator("textarea").nth(0)).toHaveValue(seededCharacteristics[0]);
    await expect(behaviorRows.nth(0).locator("textarea").nth(1)).toHaveValue(seededBehaviors[0]);
    await expect(behaviorRows.nth(1).locator("textarea").nth(1)).toHaveValue(seededBehaviors[1]);
    await page.getByRole("button", { name: "행동특성만 복사하기" }).click();
    await expect(page.getByRole("button", { name: "복사됨 ✓" })).toBeVisible();
    const behaviorClipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(behaviorClipboard.replaceAll("\r\n", "\n")).toBe(seededBehaviors.join("\n"));

    if (process.env.E2E_RUN_AI === "1") {
      await page.getByRole("button", { name: "✦ AI 평어 생성" }).click();
      await expect(page.getByRole("button", { name: "평어만 복사하기" })).toBeEnabled({ timeout: 240_000 });
    }
  } finally {
    if (classroomId) {
      const deleted = await page.request.delete("/api/classrooms", {
        data: { id: classroomId, confirmation: "학급삭제" },
      });
      expect(deleted.ok(), "E2E 임시 학급 정리에 실패했습니다.").toBeTruthy();
    }
  }
});
