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
  if (!files.length) throw new Error("SMOKE_EMAIL/SMOKE_PASSWORD or a local lab credential file is required");
  const content = await readFile(path.join(directory, files.at(-1)), "utf8");
  const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
  const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
  if (!email || !password) throw new Error("Lab credential file is invalid");
  return { email, password };
}

function cookieHeader(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

test("production API authentication and read-only data contracts", async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/class-data`, { redirect: "manual" });
  assert.equal(unauthenticated.status, 307);
  assert.match(unauthenticated.headers.get("location") ?? "", /\/login/);

  const invalid = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "invalid@example.com", password: "invalid-password" }),
  });
  assert.equal(invalid.status, 401);

  const account = await credentials();
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...account, returnTo: "/" }),
  });
  assert.equal(login.status, 200);
  const cookie = cookieHeader(login);
  assert.match(cookie, /giroksam-access-token=/);

  const getJson = async (route) => {
    const response = await fetch(`${baseUrl}${route}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, `${route} should return 200`);
    return response.json();
  };
  const [classData, plans, classrooms, commentJob, behaviorJob, privacy, usage] = await Promise.all([
    getJson("/api/class-data"),
    getJson("/api/assessment-plan"),
    getJson("/api/classrooms"),
    getJson("/api/comment-jobs"),
    getJson("/api/behavior-jobs"),
    getJson("/api/privacy-data"),
    getJson("/api/usage"),
  ]);
  assert.equal(Array.isArray(classData.students), true);
  assert.equal(Array.isArray(classData.levels), true);
  assert.equal(Array.isArray(plans.plan), true);
  assert.equal(Array.isArray(classrooms.classrooms), true);
  assert.equal("job" in commentJob, true);
  assert.equal("job" in behaviorJob, true);
  assert.equal(typeof privacy.counts.students, "number");
  assert.equal(typeof usage.monthly, "number");

  const protectedPump = await fetch(`${baseUrl}/api/comment-jobs/pump`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(protectedPump.status, 403);
});
