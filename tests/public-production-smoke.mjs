import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = (process.env.PUBLIC_SMOKE_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");

async function request(path) {
  return fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    headers: { "User-Agent": "giroksam-public-production-smoke" },
  });
}

test("production publishes login and legal pages", async () => {
  const pages = [
    ["/login", /교사 로그인/],
    ["/privacy", /개인정보 처리방침/],
    ["/terms", /서비스 이용약관/],
  ];
  for (const [path, expected] of pages) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path} returned ${response.status}`);
    assert.match(await response.text(), expected);
  }
});

test("production redirects unauthenticated app access to login", async () => {
  const response = await request("/");
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") ?? "", /\/login\?returnTo=%2F/);
});

test("production blocks unauthenticated sensitive reads", async () => {
  const protectedReads = [
    "/api/class-data",
    "/api/classrooms",
    "/api/assessment-plan",
    "/api/assessment-plan/versions",
    "/api/generated-comments",
    "/api/student-behaviors",
    "/api/comment-jobs",
    "/api/behavior-jobs",
    "/api/privacy-data",
    "/api/usage",
    "/api/auth/preferences",
    "/api/shared-assessment-plans",
  ];
  for (const path of protectedReads) {
    const response = await request(path);
    assert.equal([307, 401].includes(response.status), true, `${path} returned ${response.status}`);
    if (response.status === 307) {
      assert.match(response.headers.get("location") ?? "", /\/login/);
    }
  }
});
