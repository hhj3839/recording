import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function harness(fetch, mode = 'login') {
  const source = readFileSync('app/login/page.tsx', 'utf8');
  const handler = source.slice(source.indexOf('  async function submit('), source.indexOf('\n  return ('));
  const compiled = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const state = { busy: false, message: '', navigated: null, cleared: false, timer: null };
  const submit = new Function('fetch', 'FormData', 'setBusy', 'setMessage', 'mode', 'accepted', 'params', 'window', 'submitPending', 'setTimeout', 'clearTimeout', `${compiled}; return submit;`)(
    fetch, class { *[Symbol.iterator]() { yield ['email', 'test@example.test']; yield ['password', 'placeholder']; } },
    value => { state.busy = value; }, value => { state.message = value; }, mode, false, { get: () => '/' },
    { location: { set href(value) { state.navigated = value; } } }, { current: false },
    callback => { state.timer = callback; return 1; }, () => { state.cleared = true; },
  );
  return { state, submit: () => submit({ preventDefault() {}, currentTarget: {} }) };
}

for (const [name, response] of [
  ['network rejection', () => Promise.reject(new TypeError('Failed to fetch'))],
  ['HTML gateway error', async () => new Response('<html>timeout</html>', { status: 504 })],
  ['invalid success response', async () => Response.json(null)],
]) {
  test(`login releases loading and allows retry after ${name}`, async () => {
    let calls = 0;
    const { state, submit } = harness(() => { calls++; return response(); });
    await submit();
    assert.equal(state.busy, false);
    assert.ok(state.message);
    assert.equal(state.navigated, null);
    await submit();
    assert.equal(calls, 2);
  });
}

test('login timeout aborts a stalled response body and releases the form', async () => {
  const { state, submit } = harness(async (_url, { signal }) => ({
    ok: true, json: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }),
  }));
  const pending = submit();
  await Promise.resolve();
  assert.equal(state.busy, true);
  assert.equal(typeof state.timer, 'function');
  state.timer();
  await pending;
  assert.equal(state.busy, false);
  assert.match(state.message, /시간|지연/);
  assert.equal(state.cleared, true);
});

test('login prevents duplicate requests while pending and navigates on success', async () => {
  let resolve;
  let calls = 0;
  const { state, submit } = harness(() => { calls++; return new Promise(done => { resolve = done; }); });
  const first = submit();
  const second = submit();
  assert.equal(calls, 1);
  resolve(Response.json({ returnTo: '/' }));
  await Promise.all([first, second]);
  assert.equal(state.navigated, '/');
  assert.equal(state.busy, false);
});

test('login displays server authentication errors', async () => {
  const { state, submit } = harness(async () => Response.json({ error: '이메일 또는 비밀번호를 확인해 주세요.' }, { status: 401 }));
  await submit();
  assert.match(state.message, /비밀번호/);
  assert.equal(state.busy, false);
  assert.equal(state.navigated, null);
});

test('password reset success displays the server message without navigation', async () => {
  const { state, submit } = harness(async () => Response.json({ message: '메일을 확인해 주세요.' }), 'forgot');
  await submit();
  assert.equal(state.message, '메일을 확인해 주세요.');
  assert.equal(state.navigated, null);
  assert.equal(state.busy, false);
});
