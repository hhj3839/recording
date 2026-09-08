import { randomUUID } from "node:crypto";
import { eq, insertRows, selectRows, updateRows } from "../db/supabase.ts";
import { COMMENT_POOL_TARGET, normalizedPoolSentence } from "./comment-pool-library.ts";

type Row = Record<string, unknown>;
type Sentence = Row & { id: number; sentence: string; normalized_sentence: string; source: string };
const defaultStorage = { selectRows, insertRows, updateRows };
export class PoolEditConflict extends Error {}

// Copy-on-write: original rows remain intact. Publish last with a scoped CAS.
export async function editLocalPool(input: {
  ownerId: string; classId: number; assessmentPlanId: number;
  sentenceIds: number[]; replacement?: string;
}, storage = defaultStorage) {
  const { ownerId, classId, assessmentPlanId, sentenceIds, replacement } = input;
  const jobs = await storage.selectRows<Row>("generation_jobs", {
    owner_id: eq(ownerId), class_id: eq(classId), job_type: eq("comment-pools"), status: "in.(queued,running)", limit: 1,
  });
  if (jobs.length) throw new PoolEditConflict("AI 평어 제작이 끝난 뒤 문장을 수정·제외해 주세요.");
  const selected = await storage.selectRows<Row>("comment_pool_sentences", {
    id: `in.(${sentenceIds.join(",")})`, status: eq("approved"), limit: COMMENT_POOL_TARGET,
  });
  const versions = new Set(selected.map((row) => Number(row.pool_version_id)));
  if (selected.length !== sentenceIds.length || versions.size !== 1) throw new PoolEditConflict("같은 풀의 최신 문장만 선택해 주세요.");
  const versionId = Number(selected[0].pool_version_id);
  const scope = { owner_id: eq(ownerId), class_id: eq(classId), assessment_plan_id: eq(assessmentPlanId), pool_version_id: eq(versionId) };
  const links = await storage.selectRows<Row>("assessment_plan_pool_links", { ...scope, limit: 2 });
  if (links.length !== 1) throw new PoolEditConflict("현재 평가계획의 문장이 아닙니다. 새로고침 후 다시 시도해 주세요.");
  const version = (await storage.selectRows<Row>("comment_pool_versions", { id: eq(versionId), limit: 1 }))[0];
  if (!version) throw new PoolEditConflict("문장 풀을 찾을 수 없습니다.");
  const originals = await storage.selectRows<Sentence>("comment_pool_sentences", {
    pool_version_id: eq(versionId), status: eq("approved"), order: "id.asc", limit: COMMENT_POOL_TARGET + 1,
  });
  if (originals.length > COMMENT_POOL_TARGET || sentenceIds.some((id) => !originals.some((row) => Number(row.id) === id))) {
    throw new PoolEditConflict("문장 목록이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
  }
  const remaining = originals.flatMap((row) => {
    if (!sentenceIds.includes(Number(row.id))) return [{ sentence: row.sentence, normalized_sentence: row.normalized_sentence, source: row.source }];
    return replacement === undefined ? [] : [{ sentence: replacement, normalized_sentence: normalizedPoolSentence(replacement), source: "teacher_edited" }];
  });
  if (new Set(remaining.map((row) => row.normalized_sentence)).size !== remaining.length) throw new PoolEditConflict("같은 문장이 이미 있습니다. 다른 문장으로 수정해 주세요.");
  const copy: Row = {};
  for (const key of ["subject", "unit", "domain", "level", "criterion", "level_criteria", "canonical_sentence", "generator_version"]) copy[key] = version[key];
  const created = (await storage.insertRows<Row>("comment_pool_versions", [{
    ...copy, fingerprint: `local-edit:${randomUUID()}`, created_by: ownerId,
    target_count: COMMENT_POOL_TARGET, approved_count: remaining.length,
    status: remaining.length >= COMMENT_POOL_TARGET ? "ready" : remaining.length ? "usable" : "needs_generation",
  }]))[0];
  if (!created) throw new Error("새 문장 풀을 저장하지 못했습니다.");
  const saved = await storage.insertRows<Row>("comment_pool_sentences", remaining.map((row) => ({ ...row, pool_version_id: created.id, status: "approved" })));
  if (saved.length !== remaining.length) throw new Error("새 문장 목록을 모두 저장하지 못했습니다. 기존 풀은 유지됩니다.");
  const switched = await storage.updateRows<Row>("assessment_plan_pool_links", { ...scope, id: eq(Number(links[0].id)) }, { pool_version_id: created.id });
  if (switched.length !== 1) throw new PoolEditConflict("다른 작업에서 문장 풀을 변경했습니다. 새로고침 후 다시 시도해 주세요.");
  return { approvedCount: remaining.length, poolVersionId: Number(created.id) };
}
