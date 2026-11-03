import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

function compile(path, dependencies, globals = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', ...Object.keys(globals), code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports, ...Object.values(globals));
  return exports;
}
const timing = compile('app/request-timing.ts', { 'node:async_hooks': createRequire(import.meta.url)('node:async_hooks') });
test('database detail spans use fixed labels and retain aggregate counts without query data', async () => {
  const db = compile('db/supabase.ts', { '../app/request-timing.ts': timing }, {
    process: { env: { SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture' } },
    fetch: async () => Response.json([]),
  });
  const response = await timing.withRequestTiming('login', async () => {
    await Promise.all([
      db.selectRows('auth_login_attempts', { attempt_key: 'private-attempt-key' }),
      db.supabaseRequest('auth_login_attempts', { method: 'DELETE' }),
      db.selectRows('classrooms'), db.selectRows('generated_comments'), db.selectRows('generated_comment_parts'),
    ]);
    return Response.json({ ok: true });
  });
  const header = response.headers.get('server-timing');
  for (const phase of ['login_check', 'login_reset', 'classroom_lookup', 'comment_rows', 'comment_parts']) {
    assert.match(header, new RegExp(`${phase};dur=[0-9.]+;desc="1 calls"`));
  }
  assert.match(header, /database;dur=[0-9.]+;desc="5 calls"/);
  assert.doesNotMatch(header, /private|attempt_key|fixture/);
});
const request = () => new Request('https://example.test/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'fixture@example.test', password: 'fixture' }) });
function loginHarness({ failReset = false, failClass = false, remembered = true } = {}) {
  const calls = [], cookieWrites = [];
  let releaseReset;
  const resetGate = new Promise(resolve => { releaseReset = resolve; });
  const route = compile('app/api/auth/login/route.ts', {
    '../../../request-timing': timing,
    'next/server': { NextResponse: { json: (body, init) => {
      const response = Response.json(body, init);
      response.cookies = { set: (...args) => cookieWrites.push(args), delete: (...args) => cookieWrites.push(args) };
      return response;
    } } },
    'node:crypto': createRequire(import.meta.url)('node:crypto'),
    '../../../data-scope': { ACTIVE_CLASS_COOKIE: 'active' },
    '../../../../db/supabase': {
      eq: value => `eq.${value}`,
      selectRows: async (table, query) => {
        calls.push(table);
        if (table === 'auth_login_attempts') return [];
        assert.equal(query.owner_id, 'eq.owner');
        assert.equal(query.id, 'eq.7');
        if (failClass) throw new Error('private-class-error');
        return remembered ? [{ id: 7 }] : [];
      },
      supabaseRequest: async () => { calls.push('reset'); await resetGate; if (failReset) throw new Error('private-reset-error'); },
    },
    '../../../supabase-auth': {
      ACCESS_COOKIE: 'access', REFRESH_COOKIE: 'refresh', safeReturnTo: () => '/', authCookieOptions: () => ({}),
      createAuthClient: () => ({ auth: { signInWithPassword: async () => {
        calls.push('auth');
        return { data: { session: { access_token: 'fixture', refresh_token: 'fixture', expires_in: 60 }, user: { id: 'owner', user_metadata: { last_class_id: 7 } } } };
      } } }),
    },
  });
  return { route, calls, cookieWrites, releaseReset };
}
test('login keeps gate before auth and overlaps required post-auth work before cookies', async () => {
  const h = loginHarness();
  const pending = h.route.POST(request());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls, ['auth_login_attempts', 'auth', 'reset', 'classrooms']);
  assert.equal(h.cookieWrites.length, 0);
  h.releaseReset();
  assert.equal((await pending).status, 200);
  assert.deepEqual(h.cookieWrites.map(c => c[0]), ['access', 'refresh', 'active']);
});
for (const failure of ['failReset', 'failClass']) test(`login ${failure} returns safe 503 without cookies`, async () => {
  const h = loginHarness({ [failure]: true });
  h.releaseReset();
  const response = await h.route.POST(request());
  assert.equal(response.status, 503);
  assert.equal(h.cookieWrites.length, 0);
  assert.doesNotMatch(await response.text(), /private-/);
});
test('foreign or stale remembered class is cleared instead of trusted', async () => {
  const h = loginHarness({ remembered: false });
  h.releaseReset();
  assert.equal((await h.route.POST(request())).status, 200);
  assert.deepEqual(h.cookieWrites.at(-1), ['active']);
});

function commentsHarness({ denied = false } = {}) {
  const calls = [];
  const route = compile('app/api/generated-comments/route.ts', {
    '../../request-timing': timing,
    '../../../db/supabase': { eq: value => `eq.${value}`, selectRows: async (table, query) => {
      calls.push({ table, query });
      assert.equal(query.owner_id, 'eq.owner');
      assert.equal(query.class_id, 'eq.7');
      return table === 'generated_comments'
        ? [{ student_id: 1, subject: '국어', comment: '  내용  ', candidates: ['후보'], confirmed: true }]
        : [{ student_id: 1, subject: '국어', assessment_index: 0, sentence: '영역 내용', status: 'complete', issues: [] }];
    } },
    '../../data-scope': { getDataScope: async () => { if (denied) throw new Error('unauthorized'); return { user: { id: 'owner' }, classId: 7 }; }, dataError: () => Response.json({ error: 'denied' }, { status: 401 }) },
    '../../record-confirmation': {}, '../../record-validation': {}, '../../record-revisions': {},
  });
  return { route, calls };
}
test('summary retains exact counting inputs but never fetches parts or candidates', async () => {
  const h = commentsHarness();
  const response = await h.route.GET(new Request('https://example.test/api/generated-comments?summary=1'));
  assert.deepEqual(await response.json(), { comments: [{ studentId: 1, subject: '국어', comment: '  내용  ' }] });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].query.select, 'student_id,subject,comment');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('full read retains candidates and parts with explicit projections', async () => {
  const h = commentsHarness();
  const response = await h.route.GET(new Request('https://example.test/api/generated-comments'));
  const data = await response.json();
  assert.deepEqual(data.comments[0].candidates, ['후보']);
  assert.equal(data.parts[0].sentence, '영역 내용');
  assert.equal(h.calls.length, 2);
  for (const call of h.calls) assert.ok(!call.query.select.includes('*'));
});
for (const suffix of ['', '?summary=1']) test(`unauthorized comments ${suffix} never access data`, async () => {
  const h = commentsHarness({ denied: true });
  assert.equal((await h.route.GET(new Request(`https://example.test/api/generated-comments${suffix}`))).status, 401);
  assert.equal(h.calls.length, 0);
});
