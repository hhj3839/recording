import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync('app/request-timing.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
const messages = [];
new Function('require', 'exports', 'console', compiled)(createRequire(import.meta.url), exports, { info: message => messages.push(message) });
const { timedPhase, withRequestTiming } = exports;

test('concurrent requests keep phase counts and headers separate', async () => {
  const [auth, db] = await Promise.all([
    withRequestTiming('login', async () => {
      await timedPhase('auth', async () => new Promise(resolve => setTimeout(resolve, 10)));
      return Response.json({ ok: true });
    }),
    withRequestTiming('class-data', async () => {
      await Promise.all([timedPhase('database', async () => {}), timedPhase('database', async () => {})]);
      return Response.json({ ok: true });
    }),
  ]);
  assert.match(auth.headers.get('server-timing'), /auth;dur=.*1 calls/);
  assert.doesNotMatch(auth.headers.get('server-timing'), /database/);
  assert.match(db.headers.get('server-timing'), /database;dur=.*2 calls/);
  assert.doesNotMatch(db.headers.get('server-timing'), /auth/);
});

test('failure logging uses fixed labels and numbers without exception secrets', async () => {
  const previous = process.env.LOADING_DIAGNOSTICS;
  process.env.LOADING_DIAGNOSTICS = '1';
  try {
    await assert.rejects(withRequestTiming('login', () => timedPhase('auth', async () => { throw new Error('private-password-and-token'); })));
    const log = JSON.parse(messages.at(-1));
    assert.equal(log.status, 500);
    assert.equal(log.phases.auth.count, 1);
    assert.doesNotMatch(messages.at(-1), /private-password|token|email/);
    assert.deepEqual(Object.keys(log).sort(), ['durationMs', 'event', 'phases', 'route', 'status']);
  } finally {
    if (previous === undefined) delete process.env.LOADING_DIAGNOSTICS;
    else process.env.LOADING_DIAGNOSTICS = previous;
  }
});

test('timing preserves handled error status and does not log by default', async () => {
  const previous = process.env.LOADING_DIAGNOSTICS;
  delete process.env.LOADING_DIAGNOSTICS;
  try {
    const before = messages.length;
    const response = await withRequestTiming('login', async () => Response.json({ error: 'retry' }, { status: 503 }));
    assert.equal(response.status, 503);
    assert.match(response.headers.get('server-timing'), /total;dur=/);
    assert.equal(messages.length, before);
  } finally { if (previous !== undefined) process.env.LOADING_DIAGNOSTICS = previous; }
});

for (const scenario of ['database-unavailable', 'rate-limited']) {
  test(`login ${scenario} keeps a JSON response and does not bypass the login gate`, async () => {
    let authCalls = 0;
    const dependencies = {
      '../../../request-timing': exports,
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      'node:crypto': createRequire(import.meta.url)('node:crypto'),
      '../../../data-scope': {},
      '../../../../db/supabase': {
        eq: value => value,
        selectRows: async () => {
          if (scenario === 'database-unavailable') throw new Error('private-database-detail');
          return [{ blocked_until: new Date(Date.now() + 60_000).toISOString() }];
        },
      },
      '../../../supabase-auth': { createAuthClient: () => { authCalls++; throw new Error('must not authenticate'); } },
    };
    const routeCode = ts.transpileModule(readFileSync('app/api/auth/login/route.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const route = {};
    new Function('require', 'exports', routeCode)(name => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`);
      return dependencies[name];
    }, route);
    const response = await route.POST(new Request('https://example.test/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email: 'fixture@example.test', password: 'fixture' }),
    }));
    assert.equal(response.status, scenario === 'database-unavailable' ? 503 : 429);
    assert.match(response.headers.get('server-timing'), /total;dur=/);
    const body = await response.json();
    assert.equal(typeof body.error, 'string');
    assert.doesNotMatch(body.error, /private-database|fixture/);
    assert.equal(authCalls, 0);
  });
}
