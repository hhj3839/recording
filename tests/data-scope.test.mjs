import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync('app/data-scope.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const owner = { id: 'owner', email: 'owner@example.test', displayName: 'Teacher', lastClassId: 2,
  schoolYear: 2026, semester: 1, grade: 3, classNumber: 1 };
function setup({ user = owner, cookie = '1', rows = [{ id: 1, owner_id: 'owner' }], fallback = [], provisionOwner = 'owner' } = {}) {
  const calls = [];
  let currentCookie = cookie;
  let authCalls = 0;
  const dependencies = {
    './supabase-auth': { getAuthUser: async () => { authCalls++; return user; } },
    'next/headers': { cookies: async () => ({ get: () => ({ value: currentCookie }) }) },
    '../db/supabase': {
      eq: value => `eq.${value}`,
      selectRows: async (table, query) => {
        calls.push({ table, query });
        assert.equal(query.owner_id, `eq.${user.id}`);
        return query.id ? rows : fallback;
      },
      insertRowsIfAbsent: async (table, values) => {
        calls.push({ table, values });
        return [{ ...values[0], id: 3, owner_id: provisionOwner }];
      },
    },
  };
  const exports = {};
  new Function('require', 'exports', code)(name => {
    assert.ok(name in dependencies);
    return dependencies[name];
  }, exports);
  return { ...exports, calls, setCookie: value => { currentCookie = value; }, authCalls: () => authCalls };
}

test('existing owned class needs one scoped read and no teacher write', async () => {
  const h = setup();
  assert.equal((await h.getDataScope()).classId, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].query.id, 'in.(1,2)');
});
test('cookie wins over remembered class regardless of returned order', async () => {
  const h = setup({ rows: [{ id: 2, owner_id: 'owner' }, { id: 1, owner_id: 'owner' }] });
  assert.equal((await h.getDataScope()).classId, 1);
});
test('stale or foreign cookie falls back to owned remembered class in one read', async () => {
  const h = setup({ cookie: '99', rows: [{ id: 2, owner_id: 'owner' }] });
  assert.equal((await h.getDataScope()).classId, 2);
  assert.equal(h.calls.length, 1);
});
test('duplicate IDs are queried once before default fallback', async () => {
  const h = setup({ cookie: '2', rows: [], fallback: [{ id: 3, owner_id: 'owner' }] });
  assert.equal((await h.getDataScope()).classId, 3);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].query.id, 'in.(2)');
  assert.equal(h.calls[1].query.school_year, 'eq.2026');
});
test('invalid candidate IDs skip candidate lookup and never enter query text', async () => {
  const h = setup({ cookie: '1),owner_id.neq.owner', user: { ...owner, lastClassId: -1 }, fallback: [{ id: 3, owner_id: 'owner' }] });
  assert.equal((await h.getDataScope()).classId, 3);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].query.id, undefined);
});
test('missing class provisions teacher before classroom', async () => {
  const h = setup({ rows: [] });
  assert.equal((await h.getDataScope()).classId, 3);
  assert.deepEqual(h.calls.map(c => c.table), ['classrooms', 'classrooms', 'teachers', 'classrooms']);
});
test('unauthenticated request performs no database access', async () => {
  const h = setup({ user: null });
  await assert.rejects(h.getDataScope(), h.AuthenticationRequiredError);
  assert.equal(h.calls.length, 0);
});
test('unexpected foreign row and conflicting provision both fail closed', async () => {
  for (const options of [{ rows: [{ id: 1, owner_id: 'foreign' }] }, { rows: [], provisionOwner: 'foreign' }]) {
    const h = setup(options);
    await assert.rejects(h.getDataScope(), options.provisionOwner ? h.OwnershipConflictError : h.AuthorizationError);
  }
});
test('class switch reauthenticates and resolves fresh ownership without shared cache', async () => {
  const h = setup({ rows: [{ id: 1, owner_id: 'owner' }, { id: 2, owner_id: 'owner' }] });
  assert.equal((await h.getDataScope()).classId, 1);
  h.setCookie('2');
  assert.equal((await h.getDataScope()).classId, 2);
  assert.equal(h.authCalls(), 2);
  assert.equal(h.calls.length, 2);
});
