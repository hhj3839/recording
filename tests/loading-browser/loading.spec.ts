import { test, expect, type Page } from "@playwright/test";

const fixtures: Record<string, unknown> = {
  "/api/auth/login": { returnTo: "/" },
  "/api/assessment-plan": { plan: [] },
  "/api/class-data": { students: [{ id: 1, number: 1, name: "테스트학생" }], levels: [], user: { displayName: "검증교사" }, classroom: { id: 1, schoolName: "검증학교", schoolYear: 2026, semester: 1, grade: 3, classNumber: 1 } },
  "/api/generated-comments": { comments: [] },
  "/api/student-behaviors": { behaviors: [] },
  "/api/classrooms": { classrooms: [] },
};

test.beforeEach(async ({ context }) => {
  // Prevent test traffic from reaching any real service, even on bad navigation.
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:4183") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    return route.fulfill({ status: fixtures[url.pathname] ? 200 : 404, json: fixtures[url.pathname] ?? {} });
  });
});

async function fillLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill("fixture@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-password");
}

test("login click reaches a populated dashboard", async ({ page }, info) => {
  await fillLogin(page);
  const started = Date.now();
  await page.locator(".auth-submit").click();
  await expect(page.getByRole("heading", { name: /검증교사 선생님의 학급 기록/ })).toBeVisible();
  await expect(page.getByLabel("학급 진행 현황")).toContainText("1명");
  await expect(page.getByLabel("학급 진행 현황")).toHaveAttribute("aria-busy", "false");
  await info.attach("fixture-login-duration", { body: JSON.stringify({ elapsedMs: Date.now() - started, scope: "local mocked API, not production latency" }), contentType: "application/json" });
});

for (const failure of ["network", "html", "timeout"]) {
  test(`login ${failure} restores retry and then succeeds`, async ({ page }) => {
    await page.clock.install();
    let calls = 0;
    await page.route("**/api/auth/login", async route => {
      calls++;
      if (calls > 1) return route.fulfill({ json: { returnTo: "/" } });
      if (failure === "network") return route.abort();
      if (failure === "html") return route.fulfill({ status: 504, contentType: "text/html", body: "gateway unavailable" });
      // Deliberately leave this request unresolved; the UI must abort it.
    });
    await fillLogin(page);
    await page.locator(".auth-submit").click();
    await expect.poll(() => calls).toBe(1);
    if (failure === "timeout") {
      await expect(page.locator(".auth-submit")).toBeDisabled();
      await expect(page.getByRole("button", { name: "회원가입", exact: true })).toBeDisabled();
      await page.clock.fastForward(20_001);
    }
    await expect(page.getByRole("status")).toContainText(/다시 시도/);
    await expect(page.locator(".auth-submit")).toBeEnabled();
    await page.locator(".auth-submit").click();
    await expect(page.getByRole("heading", { name: /검증교사 선생님의 학급 기록/ })).toBeVisible();
    expect(calls).toBe(2);
  });
}

test("login aborts a stalled JSON body and permits a successful retry", async ({ page }) => {
  await page.clock.install();
  let calls = 0;
  await page.route("**/api/auth/login", route => {
    calls++;
    return calls === 1
      ? route.continue({ headers: { ...route.request().headers(), "x-test-response": "stall-body" } })
      : route.fulfill({ json: { returnTo: "/" } });
  });
  await fillLogin(page);
  const headersReceived = page.waitForResponse("**/api/auth/login");
  await page.locator(".auth-submit").click();
  await headersReceived;
  await expect(page.locator(".auth-submit")).toBeDisabled();
  await page.clock.fastForward(20_001);
  await expect(page.getByRole("status")).toContainText("응답 시간이 초과");
  await page.locator(".auth-submit").click();
  await expect(page.getByRole("heading", { name: /검증교사 선생님의 학급 기록/ })).toBeVisible();
});

for (const endpoint of ["/api/class-data", "/api/assessment-plan", "/api/generated-comments", "/api/student-behaviors"]) {
  test(`stalled ${endpoint} stops loading and retries without reload`, async ({ page }) => {
    await page.clock.install();
    let calls = 0;
    await page.route(`**${endpoint}`, async route => {
      calls++;
      if (calls > 1) await route.fulfill({ json: fixtures[endpoint] });
    });
    await page.goto("/");
    await expect.poll(() => calls).toBe(1);
    await expect(page.getByLabel("학급 진행 현황")).toHaveAttribute("aria-busy", "true");
    await page.clock.fastForward(20_001);
    await expect(page.getByLabel("학급 진행 현황")).toContainText("조회 실패");
    await page.getByRole("button", { name: "학급 현황 다시 불러오기", exact: true }).click();
    await expect(page.getByLabel("학급 진행 현황")).toHaveAttribute("aria-busy", "false");
    await expect(page.getByLabel("학급 진행 현황")).toContainText("1명");
  });
}

test("initial HTML error exposes retry instead of empty successful data", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/class-data", route => ++calls === 1
    ? route.fulfill({ status: 503, contentType: "text/html", body: "unavailable" })
    : route.fulfill({ json: fixtures["/api/class-data"] }));
  await page.goto("/");
  await expect(page.getByLabel("학급 진행 현황")).toContainText("조회 실패");
  await expect(page.getByText("현재 학급 필수 항목 작성 완료")).toHaveCount(0);
  await page.getByRole("button", { name: "학급 현황 다시 불러오기", exact: true }).click();
  await expect(page.getByLabel("학급 진행 현황")).toContainText("1명");
});
