import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// All data and network dependencies are mocked; no server or credentials are used.
function harness(kind, status, active = true, retry = false) {
  const calls = { runs: [], writes: [], reads: [] };
  const job = { id: 'fake-job', status, batches: [[{ subject: '국어' }]],
    total_items: 6, completed_items: 2, failed_items: 0, current_batch: 0, total_batches: 1 };
  const spec = { fingerprint: 'fake-fingerprint', assessmentPlanId: 1 };
  if (retry) { job.batches = [{ spec, poolVersionId: 42, freshOnly: true }]; job.failed_items = 1; }
  const plan = { id: 1, subject: '국어', high: '설명함.', middle: '참여함.', low: '노력함.' };
  const dependencies = {
    '@vercel/functions': { waitUntil() {} },
    'node:crypto': {},
    '../../../db/supabase': {
      eq: value => `eq.${value}`,
      selectRows: async (table, query) => {
        calls.reads.push({ table, query });
        if (table === 'generation_jobs') {
          if (!active || (query.status && !['queued', 'running'].includes(status))) return [];
          return [job];
        }
        if (table === 'assessment_plans') return [plan];
        if (retry && table === 'comment_pool_versions') return [{ id: 42 }];
        return [];
      },
      insertRows: async (table, rows) => { calls.writes.push({ table, rows }); return [{ ...job, ...rows[0] }]; },
      supabaseRequest: async () => { throw new Error('Unexpected data mutation'); },
    },
    '../../data-scope': {
      getDataScope: async () => ({ user: { id: 'fake-owner', email: 'fake@giroksam.test' }, classId: 999 }),
      requireOwnedStudentIds: async ids => assert.deepEqual(ids, [1, 2, 3, 4, 5, 6]),
      dataError: error => { throw error; },
    },
    '../../comment-generation': { signCommentJob: id => `signed:${id}` },
    '../../comment-pool-library': { buildCommentPoolSpecs: () => retry ? [spec] : [], commentPoolIsComplete: () => false, COMMENT_POOL_TARGET: 20 },
    '../../comment-pool-rows': { approvedPoolRows: async () => [] },
    '../../linked-comment-pools': { linkedCommentPools: async () => new Map() },
    '../../comment-batching': { batchCommentsByAssessmentArea: evidence => [evidence] },
    '../../comment-variation': { createCommentVariations: n => Array(n).fill('fake') },
  };
  const compiled = ts.transpileModule(readFileSync(`app/api/${kind}/route.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const require = name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  };
  const fetch = async (url, init) => { calls.runs.push({ path: new URL(url).pathname, ...JSON.parse(init.body) }); return Response.json({ ok: true }); };
  new Function('require', 'exports', 'fetch', compiled)(require, exports, fetch);
  return { route: exports, calls };
}

for (const kind of ['comment-jobs', 'comment-pools']) {
  for (const status of ['queued', 'running', 'completed', 'completed_with_errors', null]) {
    test(`${kind} ${status}: entry, refresh and repeated polling are read-only`, async () => {
      const { route, calls } = harness(kind, status, status !== null);
      for (const suffix of kind === 'comment-pools' ? ['', '?jobId=fake-job', '?jobId=fake-job&audit=1'] : ['']) {
        // Audit of an active job returns 409 without waking its runner.
        if (suffix.includes('audit') && !['queued', 'running'].includes(status)) continue;
        for (let i = 0; i < 3; i++) {
          const response = await route.GET(new Request(`https://example.test/api/${kind}${suffix}`));
          assert.ok([200, 404, 409].includes(response.status));
        }
      }
      assert.deepEqual(calls.runs, []);
      assert.deepEqual(calls.writes, []);
      for (const { query } of calls.reads.filter(item => item.table === 'generation_jobs')) {
        assert.equal(query.owner_id, 'eq.fake-owner');
        assert.equal(query.job_type, `eq.${kind === 'comment-jobs' ? 'comments' : kind}`);
      }
    });
  }
  test(`${kind}: explicit POST still resumes an existing job`, async () => {
    const { route, calls } = harness(kind, 'queued');
    const response = await route.POST(new Request(`https://example.test/api/${kind}`, {
      method: 'POST', body: JSON.stringify({ scores: { 국어: [] }, selectedStudentIds: [1, 2, 3, 4, 5, 6] }),
    }));
    assert.equal(response.status, 202);
    assert.deepEqual(calls.runs, [{ path: `/api/${kind}/run`, jobId: 'fake-job', signature: 'signed:fake-job' }]);
    assert.deepEqual(calls.writes, []);
  });
}

test('manual generation registers six synthetic students and starts exactly once', async () => {
  const { route, calls } = harness('comment-jobs', 'queued', false);
  const response = await route.POST(new Request('https://example.test/api/comment-jobs', {
    method: 'POST', body: JSON.stringify({
      scores: { 국어: [1, 2, 3, 4, 5, 6].map(studentId => ({ studentId, levels: ['상'] })) },
      selectedStudentIds: [1, 2, 3, 4, 5, 6], overwriteExisting: false,
    }),
  }));
  assert.equal(response.status, 202);
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].rows[0].total_items, 6);
  assert.equal(calls.runs.length, 1);
});


test('explicit retryFailed continues only the unfinished synthetic pool', async () => {
  const { route, calls } = harness('comment-pools', 'completed_with_errors', true, true);
  const response = await route.POST(new Request('https://example.test/api/comment-pools', {
    method: 'POST', body: JSON.stringify({ retryFailed: true }),
  }));
  assert.equal(response.status, 202);
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].rows[0].batches[0].poolVersionId, 42);
  assert.equal(calls.writes[0].rows[0].batches[0].maxAttempts, 3);
  assert.equal(calls.runs.length, 1);
});

function pageHandler(name, dependencies) {
  const source = ts.createSourceFile('page.tsx', readFileSync('app/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) declaration = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration);
  const js = ts.transpileModule(`const ${declaration};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${js}; return ${name};`)(...Object.values(dependencies));
}

test('saved-result loading and opening the target dialog never submit generation', async () => {
  const requests = [];
  const state = {};
  const saved = [1, 2, 3, 4, 5, 6].map(studentId => ({ studentId, subject: '국어', comment: '가상 저장 문장임.',
    generationLevels: [{ level: '상', assessmentIndex: 0 }], updatedAt: '2026-01-01T00:00:00Z' }));
  const dependencies = {
    useCallback: fn => fn,
    fetch: async (url, init) => { requests.push({ url, method: init?.method ?? 'GET' }); return Response.json({ comments: saved, parts: [] }); },
    readApiJson: response => response.json(),
    setCommentsLoadState: value => { state.load = value; },
    setCommentParts() {}, setComments: value => { state.comments = value; },
    setGeneratedLevels() {}, setSubjectGeneratedAt() {},
  };
  const load = pageHandler('loadGeneratedComments', dependencies);
  for (let i = 0; i < 2; i++) { // initial entry and refresh
    await load();
    assert.equal(state.load, 'ready');
    assert.equal(Object.keys(state.comments).length, 6);
  }
  const open = ready => pageHandler('openSubjectGenerationDialog', {
    commentsReady: ready, roster: saved, subjectEligibleIds: [1, 2, 3, 4, 5, 6],
    modifiedSubjectIds: [], emptySubjectIds: [], selectedSubject: '국어',
    setGenerationMode: value => { state.mode = value; },
    setGenerationDialogOpen: value => { state.open = value; }, setError() {},
  })();
  open(false);
  assert.equal(state.open, undefined);
  open(true);
  assert.equal(state.open, true);
  assert.equal(state.mode, 'all');
  assert.deepEqual(requests, Array(2).fill({ url: '/api/generated-comments', method: 'GET' }));
  assert.deepEqual(Object.values(state.comments), Array(6).fill('가상 저장 문장임.'));
});
