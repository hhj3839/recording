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
  const summaryRequest = page.waitForRequest(request => new URL(request.url()).pathname === "/api/generated-comments"
    && new URL(request.url()).searchParams.get("summary") === "1");
  await fillLogin(page);
  const started = Date.now();
  await page.locator(".auth-submit").click();
  await expect(page.getByRole("heading", { name: /검증교사 선생님의 학급 기록/ })).toBeVisible();
  await expect(page.getByLabel("학급 진행 현황")).toContainText("1명");
  await expect(page.getByLabel("학급 진행 현황")).toHaveAttribute("aria-busy", "false");
  await summaryRequest;
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
    await page.route(`**${endpoint}*`, async route => {
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

test("retrying failed counts does not reload successful assessment state", async ({ page }) => {
  let classCalls = 0;
  let planCalls = 0;
  let countCalls = 0;
  await page.route("**/api/class-data", route => {
    classCalls++;
    return route.fulfill({ json: fixtures["/api/class-data"] });
  });
  await page.route("**/api/assessment-plan", route => {
    planCalls++;
    return route.fulfill({ json: fixtures["/api/assessment-plan"] });
  });
  await page.route("**/api/generated-comments*", route => ++countCalls === 1
    ? route.fulfill({ status: 503, json: { error: "unavailable" } })
    : route.fulfill({ json: fixtures["/api/generated-comments"] }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /검증교사 선생님의 학급 기록/ })).toBeVisible();
  await page.getByRole("button", { name: "학급 현황 다시 불러오기", exact: true }).click();
  await expect(page.getByLabel("학급 진행 현황")).toHaveAttribute("aria-busy", "false");
  expect(classCalls).toBe(1);
  expect(planCalls).toBe(1);
  expect(countCalls).toBe(2);
});

for (const [path, label] of [["comment-jobs", "교과 평어"], ["behavior-jobs", "행동특성"]]) {
  test(`stalled ${path} requires explicit resume and sends only existing ID`, async ({ page }) => {
    await page.clock.install();
    let posts = 0;
    let status = "queued";
    await page.route(`**/api/${path}`, route => {
      if (route.request().method() !== "GET") { posts++; return route.fulfill({ status: 500, json: {} }); }
      return route.fulfill({ json: { job: { id: "existing", status, canResume: status === "queued", subject: "국어", completedItems: 1, totalItems: 2, failedItems: 0, currentBatch: 1, totalBatches: 2 } } });
    });
    let release: (() => void) | undefined;
    await page.route("**/api/generation-jobs/resume", async route => {
      posts++;
      expect(route.request().postDataJSON()).toEqual({ jobId: "existing" });
      await new Promise<void>(resolve => { release = resolve; });
      status = "completed";
      await route.fulfill({ status: 202, json: { accepted: true, jobId: "existing" } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: label, exact: true }).click();
    const button = page.getByRole("button", { name: "기존 작업 재개", exact: true });
    await expect(button).toBeVisible();
    await page.clock.fastForward(10_000);
    expect(posts).toBe(0);
    await button.click();
    await expect.poll(() => posts).toBe(1);
    await expect(page.getByRole("button", { name: "재개 요청 중…" })).toBeDisabled();
    release!();
    await page.clock.fastForward(3_100);
    await expect(page.getByRole("button", { name: /기존 작업.*재개/ })).toHaveCount(0);
    expect(posts).toBe(1);
  });
}

test("resume network failure recovers button without automatic retry", async ({ page }) => {
  await page.clock.install();
  let posts = 0;
  await page.route("**/api/behavior-jobs", route => route.fulfill({ json: { job: { id: "existing", status: "queued", canResume: true, completedItems: 1, totalItems: 2 } } }));
  await page.route("**/api/generation-jobs/resume", route => { posts++; return route.abort(); });
  await page.goto("/");
  await page.getByRole("button", { name: "행동특성", exact: true }).click();
  const button = page.getByRole("button", { name: "기존 작업 재개", exact: true });
  await button.click();
  await expect(button).toBeEnabled();
  await page.clock.fastForward(10_000);
  expect(posts).toBe(1);
  await button.click();
  await expect.poll(() => posts).toBe(2);
});

test("pool status polling does not resume until the explicit button click", async ({ page }) => {
  await page.clock.install();
  let posts = 0;
  const job = { id: "pool-existing", status: "queued", canResume: true, completed: 1, total: 2, failed: 0, error: "", current: null };
  await page.route("**/api/comment-pools*", route => route.fulfill({ json: { job, activeJob: job, groups: [], summary: { total: 2, usable: 0, needsGeneration: 2 } } }));
  await page.route("**/api/generation-jobs/resume", route => {
    posts++;
    expect(route.request().postDataJSON()).toEqual({ jobId: "pool-existing" });
    return route.fulfill({ status: 202, json: { accepted: true, jobId: "pool-existing" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "평가계획 관리", exact: true }).click();
  await page.getByRole("tab", { name: /AI 평어/ }).click();
  await page.clock.fastForward(500);
  const button = page.getByRole("button", { name: "기존 작업 재개", exact: true });
  await expect(button).toBeVisible();
  await page.clock.fastForward(10_000);
  expect(posts).toBe(0);
  await button.click();
  await expect.poll(() => posts).toBe(1);
});

for (const failure of ["timeout", "html", "conflict"]) {
  test(`resume ${failure} restores controls without auto-dispatch`, async ({ page }) => {
    await page.clock.install();
    let posts = 0;
    await page.route("**/api/behavior-jobs", route => route.fulfill({ json: { job: { id: "existing", status: "queued", canResume: true, completedItems: 1, totalItems: 2 } } }));
    await page.route("**/api/generation-jobs/resume", route => {
      posts++;
      if (failure === "timeout") return;
      return failure === "html"
        ? route.fulfill({ status: 502, contentType: "text/html", body: "gateway unavailable" })
        : route.fulfill({ status: 409, json: { error: "busy" } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "행동특성", exact: true }).click();
    await page.getByRole("button", { name: "기존 작업 재개", exact: true }).click();
    await expect.poll(() => posts).toBe(1);
    if (failure === "timeout") await page.clock.fastForward(20_001);
    await expect(page.getByRole("button", { name: "기존 작업 재개", exact: true })).toBeEnabled();
    await expect(page.getByText(failure === "timeout" ? /응답 시간이 초과됐습니다/ : failure === "conflict" ? /작업 상태가 변경됐습니다/ : /재개 요청을 보내지 못했습니다/)).toBeVisible();
    await page.clock.fastForward(10_000);
    expect(posts).toBe(1);
  });
}
