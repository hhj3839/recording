import assert from "node:assert/strict";
import test from "node:test";

async function request(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, {
    headers: { accept: "text/html" },
  }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the Supabase teacher login page", async () => {
  const response = await request("/login");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>기록샘 \| 생활기록부 작성 지원<\/title>/);
  assert.match(html, /교사 로그인/);
  assert.match(html, /회원가입/);
  assert.match(html, /비밀번호를 잊으셨나요/);
});

test("redirects unauthenticated users to the app login", async () => {
  const response = await request("/");
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") ?? "", /\/login\?returnTo=%2F/);
});
