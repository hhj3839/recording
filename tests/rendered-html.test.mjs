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

test("publishes privacy policy and service terms without login", async () => {
  const [privacy, terms] = await Promise.all([request("/privacy"), request("/terms")]);
  assert.equal(privacy.status, 200);
  assert.match(await privacy.text(), /개인정보 처리방침/);
  assert.equal(terms.status, 200);
  assert.match(await terms.text(), /서비스 이용약관/);
});

test("keeps classroom switching inside the dashboard without duplicate shortcuts", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile("app/page.tsx", "utf8"));
  assert.doesNotMatch(source, /id: "classes", label: "학급 관리"/);
  assert.match(source, /<ClassroomManager current=\{classroom\} embedded \/>/);
  assert.match(source, /className="classroom-popover"/);
  assert.doesNotMatch(source, /<h2>빠른 시작<\/h2>|전체 보기 →/);
  assert.match(source, /rosterIds\.has\(Number\(item\.studentId\)\) && subjectNames\.has\(item\.subject\)/);
  assert.match(source, /입력 근거를 바탕으로 초안을 만들며, 교사가 최종 확인합니다/);
});
