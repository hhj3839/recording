import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadRoute(file, dependencies) {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const require = (name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  };
  new Function('require', 'exports', compiled)(require, exports);
  return exports;
}

test('pool storage failure retains partial progress, records usage, and never reports completion', async () => {
  const events = [];
  const updates = [];
  const job = { id: 'job', status: 'queued', updated_at: 'now', owner_id: 'owner', class_id: 1,
    batches: [{ spec: {}, poolVersionId: 1 }], current_batch: 0, total_batches: 1,
    completed_items: 0, failed_items: 0 };
  const route = loadRoute('app/api/comment-pools/run/route.ts', {
    '@vercel/functions': { waitUntil() {} },
    '../../../comment-generation-policy': { hasNaturalNominalEnding: () => true },
    '../../../../db/supabase': {
      eq: value => value,
      selectRows: async table => table === 'generation_jobs' ? [job] : [{ sentence: '기존 문장임.' }],
      updateRows: async (table, query, data) => { updates.push({ table, data }); return [{ ...job, ...data }]; },
      upsertRows: async () => { events.push('save'); throw new Error('storage unavailable'); },
    },
    '../../../comment-pool-library': {
      approvePoolCandidates: candidates => ({ approved: candidates, rejectedIssues: [] }),
      commentPoolIsComplete: () => false, commentPoolQuality: () => ({ issues: [] }),
      COMMENT_POOL_TARGET: 20, normalizedPoolSentence: text => text,
    },
    '../../../comment-generation': { verifyCommentJob: () => true },
    '../../../ai-model-policy': { primaryAiModel: () => 'test' },
    '../../../ai-usage': { recordAiUsage: async data => { events.push('usage'); assert.equal(data.totalTokens, 12); } },
    '../../../comment-pool-prompt': { buildCommentPoolCandidatePrompt: () => '', commentPoolSystemPrompt: '' },
    '../../../openai-response': { openAiOutputText: () => '', parseFirstJsonObject: () => ({ candidates: [{ text: '새 문장임.' }] }) },
  });
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-placeholder';
  globalThis.fetch = async () => Response.json({ usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 } });
  try {
    const response = await route.POST(new Request('https://example.test/run', { method: 'POST', body: JSON.stringify({ jobId: 'job', signature: 'test' }) }));
    assert.equal((await response.json()).failed, 1);
    assert.deepEqual(events, ['usage', 'save']);
    const final = updates.filter(item => item.table === 'generation_jobs').at(-1).data;
    assert.equal(final.completed_items, 0);
    assert.equal(final.status, 'completed_with_errors');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('behavior storage failure is not counted as a saved student or as a second usage event', async () => {
  const events = [];
  const updates = [];
  const job = { id: 'job', status: 'queued', updated_at: new Date().toISOString(), owner_id: 'owner', class_id: 1,
    batches: [[{ studentId: 1, characteristic: '관찰 내용' }]], current_batch: 0, total_batches: 1,
    completed_items: 0, failed_items: 0 };
  const route = loadRoute('app/api/behavior-jobs/run/route.ts', {
    '@vercel/functions': { waitUntil() {} },
    '../../../ability-statement-policy': { ABILITY_STATEMENT_ISSUE: 'excluded' },
    '../../../../db/supabase': {
      eq: value => value,
      selectRows: async table => table === 'generation_jobs' ? [job] : [],
      updateRows: async (table, query, data) => { updates.push(data); return [{ ...job, ...data }]; },
    },
    '../../../ai-usage': { MONTHLY_AI_LIMIT: null, getAiUsage: async () => ({}), recordAiUsage: async data => {
      assert.equal(data.totalTokens, 12); events.push('usage');
    } },
    '../../../behavior-generation': {
      generateBehaviorBatch: async () => ({ behaviors: [{ studentId: 1, behavior: '참여함.' }], failures: [], usage: { totalTokens: 12 } }),
      saveGeneratedBehaviors: async () => { events.push('save'); throw new Error('storage unavailable'); },
    },
    '../../../behavior-repair-policy': {},
    '../../../comment-generation': { verifyCommentJob: () => true },
    '../../../ai-model-policy': { generationModel: () => 'test' },
  });
  const response = await route.POST(new Request('https://example.test/run', { method: 'POST', body: JSON.stringify({ jobId: 'job', signature: 'test' }) }));
  const result = await response.json();
  assert.equal(result.completedItems, 0);
  assert.equal(result.failedItems, 1);
  assert.equal(updates.at(-1).status, 'completed_with_errors');
  assert.deepEqual(events, Array.from({ length: 4 }, () => ['usage', 'save']).flat());
});
