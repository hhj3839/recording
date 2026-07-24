import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the 기록샘 application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>기록샘 \| 생활기록부 작성 지원<\/title>/);
  assert.match(html, /홍현진 선생님, 안녕하세요/);
  assert.match(html, /평가 수준 입력/);
  assert.match(html, /학생 정보는 안전하게 보호됩니다/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});
