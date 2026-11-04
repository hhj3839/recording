import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function load(path, deps, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', ...Object.keys(globals), code)(n => { assert.ok(n in deps, n); return deps[n]; }, exports, ...Object.values(globals));
  return exports;
}
const user = { id: 'new-user', email: 'teacher@example.test', displayName: 'New', schoolName: 'New school', schoolYear: 2026, semester: 1, grade: 3, classNumber: 1 };
const classroom = { id: 7, owner_email: user.email, owner_id: user.id, school_name: 'Original', school_year: 2026, semester: 1, grade: 3, class_number: 1, created_at: '2020-01-01' };
function harness({ teacherOwner = user.id, classOwner, teacherExists = true, classExists = true } = {}) {
  const state = { teachers: teacherExists ? [{ email: user.email, user_id: teacherOwner, display_name: 'Original', created_at: '2020-01-01' }] : [], classrooms: classExists ? [{ ...classroom, owner_id: classOwner }] : [] };
  const requests = [], remembered = [];
  const initial = structuredClone(state);
  const db = load('db/supabase.ts', { '../app/request-timing.ts': { timedPhase: (_, f) => f() } }, {
    process: { env: { SUPABASE_URL: 'https://isolated.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' } },
    fetch: async (url, init) => {
      const u = new URL(url), table = u.pathname.split('/').at(-1), rows = state[table];
      requests.push({ table, method: init.method, prefer: init.headers.Prefer });
      if (init.method === 'GET') return Response.json(rows.filter(r => [...u.searchParams].every(([k,v]) => ['select','limit','order'].includes(k) || v === 'eq.' + r[k])));
      assert.equal(init.method, 'POST');
      const incoming = JSON.parse(init.body)[0], keys = u.searchParams.get('on_conflict')?.split(',') ?? [];
      const existing = rows.find(r => keys.length && keys.every(k => r[k] === incoming[k]));
      if (existing) {
        if (init.headers.Prefer?.includes('ignore-duplicates')) return Response.json([]);
        Object.assign(existing, incoming);
        return Response.json([existing]);
      }
      const row = { id: 8, ...incoming }; rows.push(row); return Response.json([row]);
    },
  });
  const scope = load('app/data-scope.ts', { '../db/supabase': db, './supabase-auth': { getAuthUser: async () => user }, 'next/headers': { cookies: async () => ({ get: () => undefined }) } });
  const route = load('app/api/classrooms/route.ts', {
    'next/server': { NextResponse: { json: x => { const r = Response.json(x); r.cookies = { set() {} }; return r; } } },
    '../../../db/supabase': db, '../../data-scope': scope,
    '../../supabase-auth': { getAuthUser: async () => user, rememberClassroom: async id => remembered.push(id) },
    '../../class-data-tables': { CLASS_DATA_TABLES: [] },
  });
  const post = () => route.POST(new Request('https://isolated.invalid/api/classrooms', { method: 'POST', body: JSON.stringify(user) }));
  return { state, initial, requests, remembered, scope, post };
}
for (const owner of [null, 'other-user']) {
  test(`initial provisioning preserves teacher owned by ${owner}`, async () => {
    const h = harness({ teacherOwner: owner, classExists: false });
    await assert.rejects(h.scope.getDataScope());
    assert.deepEqual(h.state, h.initial);
  });
  test(`initial provisioning preserves classroom owned by ${owner}`, async () => {
    const h = harness({ classOwner: owner });
    await assert.rejects(h.scope.getDataScope());
    assert.deepEqual(h.state, h.initial);
  });
  test(`classroom POST refuses ${owner} without remembering or changing it`, async () => {
    const h = harness({ classOwner: owner });
    assert.equal((await h.post()).status, 409);
    assert.deepEqual(h.state, h.initial);
    assert.deepEqual(h.remembered, []);
  });
}
test('fresh provisioning and simultaneous retry converge without overwrite', async () => {
  const h = harness({ teacherExists: false, classExists: false });
  const results = await Promise.all([h.scope.getDataScope(), h.scope.getDataScope()]);
  assert.equal(results[0].classId, results[1].classId);
  assert.equal(h.state.teachers.length, 1);
  assert.equal(h.state.classrooms.length, 1);
});
test('owned classroom POST reuses original row without rewriting profile or timestamp', async () => {
  const h = harness({ classOwner: user.id });
  assert.equal((await h.post()).status, 200);
  assert.deepEqual(h.state, h.initial);
});
