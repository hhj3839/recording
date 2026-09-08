import test from "node:test";
import assert from "node:assert/strict";
import { editLocalPool } from "../app/comment-pool-local-edit.ts";
import { approvedPoolRows } from "../app/comment-pool-rows.ts";

type Row = Record<string, unknown>;
function database() {
  const tables: Record<string, Row[]> = {
    generation_jobs: [],
    comment_pool_versions: [{ id: 1, fingerprint: "shared", subject: "국어", unit: "단원", domain: "읽기", level: "상", criterion: "기준", level_criteria: {}, canonical_sentence: "표현함.", generator_version: "v2" }],
    comment_pool_sentences: [
      { id: 1, pool_version_id: 1, sentence: "표현함.", normalized_sentence: "표현함", status: "approved", source: "generated" },
      { id: 2, pool_version_id: 1, sentence: "설명함.", normalized_sentence: "설명함", status: "approved", source: "generated" },
    ],
    assessment_plan_pool_links: [
      { id: 1, owner_id: "me", class_id: 1, assessment_plan_id: 10, pool_version_id: 1 },
      { id: 2, owner_id: "other", class_id: 2, assessment_plan_id: 20, pool_version_id: 1 },
      { id: 3, owner_id: "me", class_id: 1, assessment_plan_id: 11, pool_version_id: 1 },
    ],
  };
  let nextId = 100;
  const matches = (row: Row, query: Record<string, unknown>) => Object.entries(query).every(([key, value]) => {
    if (["limit", "offset", "order"].includes(key)) return true;
    const text = String(value);
    return text.startsWith("eq.") ? String(row[key]) === text.slice(3) : text.slice(4, -1).split(",").includes(String(row[key]));
  });
  const storage = {
    async selectRows<T>(table: string, query: Record<string, unknown> = {}) {
      return tables[table].filter((row) => matches(row, query)).slice(Number(query.offset ?? 0), Number(query.offset ?? 0) + Number(query.limit ?? 1000)) as T[];
    },
    async insertRows<T>(table: string, rows: unknown[]) {
      const inserted = rows.map((row) => ({ ...row as Row, id: nextId++ }));
      tables[table].push(...inserted);
      return inserted as T[];
    },
    async updateRows<T>(table: string, query: Record<string, unknown>, values: unknown) {
      assert.equal(table, "assessment_plan_pool_links", "never mutate originals");
      const rows = tables[table].filter((row) => matches(row, query));
      rows.forEach((row) => Object.assign(row, values));
      return rows as T[];
    },
  };
  return { tables, storage };
}
const input = { ownerId: "me", classId: 1, assessmentPlanId: 10, sentenceIds: [1] };

test("local exclusion preserves original and every other account/plan link", async () => {
  const { tables, storage } = database();
  const originals = structuredClone(tables.comment_pool_sentences);
  const result = await editLocalPool(input, storage);
  assert.equal(result.approvedCount, 1);
  assert.deepEqual(tables.comment_pool_sentences.slice(0, 2), originals);
  assert.equal(tables.assessment_plan_pool_links[0].pool_version_id, result.poolVersionId);
  assert.equal(tables.assessment_plan_pool_links[1].pool_version_id, 1);
  assert.equal(tables.assessment_plan_pool_links[2].pool_version_id, 1);
  assert.equal(tables.comment_pool_sentences.at(-1)?.sentence, "설명함.");
  await assert.rejects(editLocalPool(input, storage), /현재 평가계획/);
});

test("local edit saves new text while original text remains", async () => {
  const { tables, storage } = database();
  await editLocalPool({ ...input, replacement: "자연스럽게 표현함." }, storage);
  assert.equal(tables.comment_pool_sentences[0].sentence, "표현함.");
  assert.equal(tables.comment_pool_sentences[2].source, "teacher_edited");
  assert.equal(tables.comment_pool_sentences[2].sentence, "자연스럽게 표현함.");
});

test("active generation blocks edits before copying", async () => {
  const { tables, storage } = database();
  tables.generation_jobs.push({ owner_id: "me", class_id: 1, job_type: "comment-pools", status: "running" });
  await assert.rejects(editLocalPool(input, storage), /제작이 끝난 뒤/);
  assert.equal(tables.comment_pool_versions.length, 1);
});

test("foreign plan and duplicate edits fail before any insert", async () => {
  const { tables, storage } = database();
  await assert.rejects(editLocalPool({ ...input, assessmentPlanId: 20 }, storage));
  await assert.rejects(editLocalPool({ ...input, replacement: "설명함." }, storage), /같은 문장/);
  assert.equal(tables.comment_pool_versions.length, 1);
});

test("failed copy or lost compare-and-swap never replaces old link", async () => {
  const { tables, storage } = database();
  const insert = storage.insertRows;
  storage.insertRows = async (table, rows) => {
    if (table === "comment_pool_sentences") throw new Error("simulated failure");
    return insert(table, rows);
  };
  await assert.rejects(editLocalPool(input, storage), /simulated failure/);
  assert.equal(tables.assessment_plan_pool_links[0].pool_version_id, 1);
  storage.insertRows = insert;
  storage.updateRows = async () => [];
  await assert.rejects(editLocalPool(input, storage), /다른 작업/);
  assert.equal(tables.assessment_plan_pool_links[0].pool_version_id, 1);
});

test("removing all candidates leaves an empty private pool, never falls back to shared original", async () => {
  const { tables, storage } = database();
  const result = await editLocalPool({ ...input, sentenceIds: [1, 2] }, storage);
  assert.equal(result.approvedCount, 0);
  assert.equal(tables.comment_pool_versions.at(-1)?.status, "needs_generation");
  assert.equal(tables.comment_pool_sentences.length, 2);
});

test("approved pool pagination reads all 1500 rows and legacy oversized pools", async () => {
  const { tables, storage } = database();
  tables.comment_pool_sentences = Array.from({ length: 1500 }, (_, i) => ({ id: i + 1, pool_version_id: Math.floor(i / 20) + 1, status: "approved", sentence: `${i}` }));
  const rows = await approvedPoolRows(Array.from({ length: 75 }, (_, i) => i + 1), storage.selectRows);
  assert.equal(rows.length, 1500);
  assert.equal(rows.at(-1)?.sentence, "1499");
  tables.comment_pool_sentences.forEach((row) => { row.pool_version_id = 1; });
  assert.equal((await approvedPoolRows([1, 1], storage.selectRows)).length, 1500);
  assert.deepEqual(await approvedPoolRows([], storage.selectRows), []);
});
