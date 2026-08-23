import { eq, selectRows, updateRows, upsertRows } from "../../../../db/supabase";
import {
  buildCommentPoolSpecs,
  normalizedPoolSentence,
  repairLegacyPoolCandidate,
  type PoolPlanItem,
} from "../../../comment-pool-library";
import { dataError, getDataScope } from "../../../data-scope";

const inValues = (values: Array<string | number>) => `in.(${values.join(",")})`;

type PoolVersion = { id: number; fingerprint: string; approved_count: number };
type PoolSentence = { id: number; pool_version_id: number; sentence: string; normalized_sentence: string; status: string };

export async function POST(request: Request) {
  let stage = "authorization";
  try {
    const { user, classId } = await getDataScope();
    if (!user.email.toLowerCase().endsWith("@giroksam.test")) {
      return Response.json({ error: "문장 풀 교정은 실험실 계정에서만 실행할 수 있습니다." }, { status: 403 });
    }
    const body = await request.json().catch(() => ({})) as {
      subject?: unknown;
      expectedCount?: unknown;
      allowShared?: unknown;
      apply?: unknown;
    };
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const expectedCount = Number(body.expectedCount);
    if (!subject || !Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 100) {
      return Response.json({ error: "교정 과목과 예상 문장 수를 확인해 주세요." }, { status: 400 });
    }
    stage = "load-plan";
    const plan = await selectRows<PoolPlanItem>("assessment_plans", {
      owner_id: eq(user.id), class_id: eq(classId), order: "sort_order.asc",
    });
    const specs = buildCommentPoolSpecs(plan).filter((spec) => spec.subject === subject);
    const versions = specs.length ? await selectRows<PoolVersion>("comment_pool_versions", {
      fingerprint: inValues(specs.map((spec) => spec.fingerprint)),
    }) : [];
    const versionIds = versions.map((version) => Number(version.id));
    const links = versionIds.length ? await selectRows<{ owner_id: string; pool_version_id: number }>("assessment_plan_pool_links", {
      pool_version_id: inValues(versionIds),
    }) : [];
    const sharedOwnerIds = new Set(links.filter((link) => link.owner_id !== user.id).map((link) => link.owner_id));
    if (sharedOwnerIds.size && body.allowShared !== true) {
      return Response.json({ error: "다른 계정과 공유된 문장 풀입니다. 공용 풀 교정을 명시적으로 승인해 주세요." }, { status: 409 });
    }
    const rows = versionIds.length ? await selectRows<PoolSentence>("comment_pool_sentences", {
      pool_version_id: inValues(versionIds), order: "id.asc",
    }) : [];
    const specByVersion = new Map(versions.map((version) => [Number(version.id), specs.find((spec) => spec.fingerprint === version.fingerprint)]));
    const repairs = rows.flatMap((row) => {
      if (row.status !== "approved") return [];
      const spec = specByVersion.get(Number(row.pool_version_id));
      const repaired = spec ? repairLegacyPoolCandidate(row.sentence, spec) : null;
      return repaired ? [{ row, repaired: repaired.repaired }] : [];
    });
    if (repairs.length !== expectedCount) {
      return Response.json({ error: `예상한 ${expectedCount}개와 실제 교정 대상 ${repairs.length}개가 달라 작업을 중단했습니다.` }, { status: 409 });
    }
    const affectedVersionIds = [...new Set(repairs.map(({ row }) => Number(row.pool_version_id)))];
    const existingByVersionAndText = new Map(rows.map((row) => [`${row.pool_version_id}:${row.normalized_sentence}`, row]));
    const insertions = repairs.flatMap(({ row, repaired }) => {
      const key = `${row.pool_version_id}:${normalizedPoolSentence(repaired)}`;
      const existing = existingByVersionAndText.get(key);
      if (existing?.status === "approved") return [];
      return [{
        pool_version_id: row.pool_version_id,
        sentence: repaired,
        normalized_sentence: normalizedPoolSentence(repaired),
        status: "approved",
        source: "teacher_edited",
        updated_at: new Date().toISOString(),
      }];
    });
    const preview = {
      subject, repairCount: repairs.length, affectedPoolCount: affectedVersionIds.length,
      insertCount: insertions.length, reuseCount: repairs.length - insertions.length,
      shared: sharedOwnerIds.size > 0, sharedOwnerCount: sharedOwnerIds.size,
    };
    if (body.apply !== true) return Response.json({ ...preview, applied: false });

    stage = "save-replacements";
    await upsertRows("comment_pool_sentences", insertions, "pool_version_id,normalized_sentence");
    stage = "retire-originals";
    await updateRows("comment_pool_sentences", { id: inValues(repairs.map(({ row }) => Number(row.id))) }, {
      status: "retired", updated_at: new Date().toISOString(),
    });
    stage = "refresh-pools";
    for (const poolVersionId of affectedVersionIds) {
      const approved = await selectRows<{ id: number }>("comment_pool_sentences", {
        pool_version_id: eq(poolVersionId), status: eq("approved"), limit: 20,
      });
      const approvedCount = approved.length;
      await updateRows("comment_pool_versions", { id: eq(poolVersionId) }, {
        approved_count: approvedCount,
        status: approvedCount >= 20 ? "ready" : approvedCount ? "usable" : "failed",
        updated_at: new Date().toISOString(),
      });
    }
    return Response.json({ ...preview, applied: true, retiredCount: repairs.length });
  } catch (error) {
    const response = dataError(error, "문장 풀 무료 교정을 완료하지 못했습니다.");
    response.headers.set("X-Pool-Repair-Stage", stage);
    return response;
  }
}
