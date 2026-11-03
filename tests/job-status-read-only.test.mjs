import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the real route with isolated storage and runner dependencies.
function loadRoute(kind, job, effects) {
  const source = readFileSync(`app/api/${kind}/route.ts`, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    '../../job-resume-policy': { canResumeJob: () => false },
    '@vercel/functions': { waitUntil: () => effects.push('schedule') },
    '../../../db/supabase': {
      eq: value => `eq.${value}`,
      selectRows: async (table, query) => {
        if (table === 'generation_jobs') {
          assert.equal(query.owner_id, 'eq.owner');
          if (query.status && !['queued', 'running'].includes(job?.status)) return [];
          return job ? [job] : [];
        }
        return [];
      },
    },
    '../../data-scope': {
      getDataScope: async () => ({ user: { id: 'owner', email: 'owner@giroksam.test' }, classId: 1 }),
      requireOwnedStudentIds: async () => {},
      dataError: error => { throw error; },
    },
    '../../comment-generation': { signCommentJob: () => 'signature' },
    '../../comment-pool-library': { buildCommentPoolSpecs: () => [] },
    '../../comment-pool-rows': { approvedPoolRows: async () => [] },
    '../../behavior-variation': { createBehaviorVariations: () => [{}] },
    '../../record-validation': { validateBehaviorSource: () => ({ valid: true, forbidden: [], sensitive: [] }) },
  };
  const exports = {};
  new Function('require', 'exports', 'fetch', compiled)(
    name => dependencies[name] ?? {}, exports,
    async () => { effects.push('runner'); return Response.json({}); },
  );
  return exports;
}

for (const kind of ['comment-jobs', 'behavior-jobs']) {
  test(`${kind} explicit POST can still wake an existing job`, async () => {
    const effects = [];
    const route = loadRoute(kind, { id: 'job', status: 'queued' }, effects);
    const response = await route.POST(new Request(`https://example.test/api/${kind}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kind === 'comment-jobs'
        ? { scores: {}, selectedStudentIds: [1] }
        : { students: [{ studentId: 1, characteristic: '관찰 기록' }] }),
    }));
    assert.equal(response.status, 202);
    assert.equal((await response.json()).alreadyRunning, true);
    assert.deepEqual(effects, ['runner', 'schedule']);
  });
}

for (const kind of ['comment-jobs', 'behavior-jobs', 'comment-pools']) {
  for (const status of ['queued', 'running', 'completed', 'completed_with_errors']) {
    const paths = kind === 'comment-pools' ? ['', '?jobId=job', '?jobId=job&audit=1'] : [''];
    for (const path of paths) {
      test(`${kind}${path} reads ${status} without starting work`, async () => {
        const effects = [];
        const job = { id: 'job', status, batches: [], current_batch: 0, total_batches: 1,
          total_items: 1, completed_items: 0, failed_items: 0 };
        const route = loadRoute(kind, job, effects);
        const response = await route.GET(new Request(`https://example.test/api/${kind}${path}`));
        assert.equal(response.status, path.includes('audit') && ['queued', 'running'].includes(status) ? 409 : 200);
        const result = await response.json();
        if (!path.includes('audit')) assert.equal((kind === 'comment-pools' && !path ? result.latestJob : result.job).status, status);
        assert.deepEqual(effects, [], 'A page visit or status poll must never invoke a generation runner');
      });
    }
  }
  test(`${kind} with no job does not start work`, async () => {
    const effects = [];
    const response = await loadRoute(kind, null, effects).GET(new Request(`https://example.test/api/${kind}`));
    assert.equal(response.status, 200);
    assert.deepEqual(effects, []);
  });
}
