import { eq, selectRows, updateRows, upsertRows } from "../../../../db/supabase";
import { buildCommentPoolSpecs, normalizedPoolSentence, validatePoolCandidate, type PoolPlanItem } from "../../../comment-pool-library";
import { dataError, getDataScope } from "../../../data-scope";

const corrections = new Map<number, string>([
  [381, "우리가 사는 곳의 여러 장소를 소개하는 여러 방법 중 한 가지를 골라 소개 자료를 만들고 소개함."],
  [453, "친구들의 생각을 들으며 토의에 참여함."],
  [676, "효·우애의 의미를 이해하고, 효·우애를 바탕으로 가족을 소중히 여기는 마음을 전함."],
  [982, "생활용품 설계에 이용할 동물의 특징을 잘 알고, 그 특징을 이용해 생활용품을 창의적으로 설계함."],
  [1047, "배추흰나비의 한살이를 관찰하고, 한살이를 글과 그림으로 간단하게 표현함."],
  [1048, "배추흰나비의 한살이를 관찰하고, 관찰한 한살이를 글과 그림으로 간단하게 표현함."],
]);
const targetIds = [...corrections.keys()];
const inValues = (values: Array<string | number>) => `in.(${values.join(",")})`;
type Version = { id: number; fingerprint: string };
type Sentence = { id: number; pool_version_id: number; sentence: string; normalized_sentence: string; status: string };

export async function POST(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    if (!user.email.toLowerCase().endsWith("@giroksam.test")) return Response.json({ error: "실험실 계정에서만 실행할 수 있습니다." }, { status: 403 });
    const body = await request.json().catch(() => ({})) as { expectedIds?: unknown; allowShared?: unknown; apply?: unknown; approvalCode?: unknown };
    const expectedIds = Array.isArray(body.expectedIds) ? body.expectedIds.map(Number).sort((a, b) => a - b) : [];
    if (JSON.stringify(expectedIds) !== JSON.stringify(targetIds) || body.allowShared !== true || body.approvalCode !== "APPROVE_SIX_2026_08_24") {
      return Response.json({ error: "승인된 공용 문장 6개 범위와 일치하지 않습니다." }, { status: 409 });
    }
    const plan = await selectRows<PoolPlanItem>("assessment_plans", { owner_id: eq(user.id), class_id: eq(classId), order: "sort_order.asc" });
    const specs = buildCommentPoolSpecs(plan);
    const versions = await selectRows<Version>("comment_pool_versions", { fingerprint: inValues(specs.map((spec) => spec.fingerprint)) });
    const specByVersion = new Map(versions.map((version) => [Number(version.id), specs.find((spec) => spec.fingerprint === version.fingerprint)]));
    const rows = await selectRows<Sentence>("comment_pool_sentences", { id: inValues(targetIds), order: "id.asc" });
    if (rows.length !== 6 || rows.some((row) => row.status !== "approved")) return Response.json({ error: "원문 6개의 현재 상태가 승인 범위와 달라 중단했습니다." }, { status: 409 });
    const versionIds = [...new Set(rows.map((row) => Number(row.pool_version_id)))];
    const links = await selectRows<{ owner_id: string }>("assessment_plan_pool_links", { pool_version_id: inValues(versionIds) });
    const sharedOwnerIds = new Set(links.filter((link) => link.owner_id !== user.id).map((link) => link.owner_id));
    if (!sharedOwnerIds.size) return Response.json({ error: "승인 대상이 공용 문장 풀 상태가 아닙니다." }, { status: 409 });
    const replacements = rows.map((row) => {
      const spec = specByVersion.get(Number(row.pool_version_id));
      const sentence = corrections.get(Number(row.id));
      if (!spec || !sentence || validatePoolCandidate(row.sentence, spec).issues.length === 0 || validatePoolCandidate(sentence, spec).issues.length) {
        throw new Error(`문장 ${row.id}의 원문 또는 교정본 검수가 승인 상태와 다릅니다.`);
      }
      return { row, sentence };
    });
    const allPoolRows = await selectRows<Sentence>("comment_pool_sentences", { pool_version_id: inValues(versionIds) });
    const approvedKeys = new Set(allPoolRows.filter((row) => row.status === "approved").map((row) => `${row.pool_version_id}:${row.normalized_sentence}`));
    const pendingKeys = new Set<string>();
    const insertions = replacements.flatMap(({ row, sentence }) => {
      const key = `${row.pool_version_id}:${normalizedPoolSentence(sentence)}`;
      if (approvedKeys.has(key) || pendingKeys.has(key)) return [];
      pendingKeys.add(key);
      return [{ pool_version_id: row.pool_version_id, sentence, normalized_sentence: normalizedPoolSentence(sentence), status: "approved", source: "teacher_edited", updated_at: new Date().toISOString() }];
    });
    const preview = { repairCount: 6, affectedPoolCount: versionIds.length, insertCount: insertions.length, reuseCount: 6 - insertions.length, shared: true, sharedOwnerCount: sharedOwnerIds.size };
    if (body.apply !== true) return Response.json({ ...preview, applied: false });
    await upsertRows("comment_pool_sentences", insertions, "pool_version_id,normalized_sentence");
    await updateRows("comment_pool_sentences", { id: inValues(targetIds) }, { status: "retired", updated_at: new Date().toISOString() });
    for (const poolVersionId of versionIds) {
      const approved = await selectRows<{ id: number }>("comment_pool_sentences", { pool_version_id: eq(poolVersionId), status: eq("approved"), limit: 20 });
      await updateRows("comment_pool_versions", { id: eq(poolVersionId) }, { approved_count: approved.length, status: approved.length >= 20 ? "ready" : "usable", updated_at: new Date().toISOString() });
    }
    return Response.json({ ...preview, applied: true, retiredCount: 6 });
  } catch (error) {
    return dataError(error, "승인된 공용 문장 6개 교정을 완료하지 못했습니다.");
  }
}
