import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const baseUrl = (process.env.SMOKE_BASE_URL || "https://giroksam-recording.vercel.app").replace(/\/$/, "");

async function credentials() {
  if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
    return { email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD };
  }
  const directory = path.resolve(".local-secrets");
  const files = (await readdir(directory)).filter((name) => /^lab-account-.*\.txt$/.test(name)).sort();
  if (!files.length) throw new Error("Lab credential file is required");
  const content = await readFile(path.join(directory, files.at(-1)), "utf8");
  const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
  const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
  if (!email || !password) throw new Error("Lab credential file is invalid");
  return { email, password };
}

function cookieHeader(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";", 1)[0]).join("; ");
}

async function sessionCookie() {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(await credentials()), returnTo: "/" }),
  });
  assert.equal(login.status, 200);
  const cookie = cookieHeader(login);
  assert.match(cookie, /giroksam-access-token=/);
  return cookie;
}

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
  "/api/pilot-feedback",
  "/api/usage",
  "/api/auth/preferences",
  "/api/school-members",
];

test("all sensitive read APIs reject unauthenticated access", async () => {
  for (const route of protectedReads) {
    const response = await fetch(`${baseUrl}${route}`, { redirect: "manual" });
    assert.equal([307, 401].includes(response.status), true, `${route} returned ${response.status}`);
  }
  const passwordChange = await fetch(`${baseUrl}/api/auth/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "Unauthorized123" }),
  });
  assert.equal(passwordChange.status, 401);
  const profileChange = await fetch(`${baseUrl}/api/auth/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "권한없음" }),
  });
  assert.equal(profileChange.status, 401);
});

test("foreign identifiers cannot mutate or reveal classroom data", async () => {
  const cookie = await sessionCookie();
  const foreignId = 2_147_483_647;
  let validBehavior = "꾸준한 노력으로 성장하는 모습을 보이며 ";
  while (new TextEncoder().encode(`${validBehavior}책임감 있게 생활함.`).length < 500) {
    validBehavior += "학습 활동에 성실하게 참여하고 친구의 의견을 존중하며 ";
  }
  validBehavior += "책임감 있게 생활함.";
  const request = (route, method, body) => fetch(`${baseUrl}${route}`, {
    method,
    redirect: "manual",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const attempts = [
    ["/api/students", "PATCH", { id: foreignId, number: 1, name: "격리검증" }, [404]],
    ["/api/students/status", "POST", { id: foreignId }, [404]],
    ["/api/students/copy", "POST", { targetClassId: foreignId }, [403]],
    ["/api/assessment-levels", "PUT", { levels: [{ studentId: foreignId, subject: "국어", assessmentIndex: 0, level: "상" }] }, [403]],
    ["/api/generated-comments", "PUT", { studentId: foreignId, subject: "국어", comment: "학습 활동에 성실하게 참여함.", confirmed: false }, [403]],
    ["/api/student-behaviors", "PUT", { studentId: foreignId, characteristic: "검증", behavior: validBehavior, confirmed: false }, [403]],
    ["/api/validate-behavior-evidence", "POST", { studentId: foreignId, characteristic: "수업 중 친구의 의견을 경청함.", behavior: validBehavior }, [403]],
    ["/api/assessment-plan/versions", "POST", { versionId: foreignId }, [403]],
  ];
  for (const [route, method, body, expected] of attempts) {
    const response = await request(route, method, body);
    assert.equal(expected.includes(response.status), true, `${route} returned ${response.status}`);
  }
});

test("worker and destructive APIs reject forged authorization", async () => {
  const cookie = await sessionCookie();
  const attempts = [
    ["/api/comment-jobs/pump", { authorization: "Bearer forged" }, {}, 403],
    ["/api/behavior-jobs/run", {}, { jobId: "00000000-0000-0000-0000-000000000000", signature: "forged" }, 403],
    ["/api/comment-jobs/run", {}, { jobId: "00000000-0000-0000-0000-000000000000", signature: "forged" }, 403],
    ["/api/privacy-data", { Cookie: cookie }, { scope: "class", confirmation: "잘못된문구" }, 400],
    ["/api/classrooms", { Cookie: cookie }, { id: 2_147_483_647, confirmation: "잘못된문구" }, 400],
  ];
  for (const [route, extraHeaders, body, expected] of attempts) {
    const response = await fetch(`${baseUrl}${route}`, {
      method: route.includes("/run") || route.includes("/pump") ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, expected, `${route} returned ${response.status}`);
  }
});
