import { eq, selectRows, updateRows } from "../../../../db/supabase";
import { COMMENT_POOL_TARGET } from "../../../comment-pool-library";
import { dataError, getDataScope } from "../../../data-scope";

type PoolSentence = { id: number; pool_version_id: number; status: string };

export async function POST(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    const body = await request.json().catch(() => ({})) as { sentenceId?: unknown; allowShared?: unknown };
    const sentenceId = Number(body.sentenceId);
    if (!Number.isInteger(sentenceId) || sentenceId < 1) {
      return Response.json({ error: "제외할 문장 후보를 확인해 주세요." }, { status: 400 });
    }

    const sentence = (await selectRows<PoolSentence>("comment_pool_sentences", {
      id: eq(sentenceId), status: eq("approved"), limit: 1,
    }))[0];
    if (!sentence) return Response.json({ error: "이미 제외되었거나 찾을 수 없는 문장 후보입니다." }, { status: 404 });

    const currentLink = (await selectRows<{ id: number }>("assessment_plan_pool_links", {
      owner_id: eq(user.id), class_id: eq(classId), pool_version_id: eq(sentence.pool_version_id), limit: 1,
    }))[0];
    if (!currentLink) return Response.json({ error: "현재 학급에 연결된 문장 후보만 제외할 수 있습니다." }, { status: 403 });

    const links = await selectRows<{ owner_id: string; class_id: number }>("assessment_plan_pool_links", {
      pool_version_id: eq(sentence.pool_version_id),
    });
    const shared = links.some((link) => link.owner_id !== user.id || Number(link.class_id) !== classId);
    if (shared && body.allowShared !== true) {
      return Response.json({ error: "공동으로 사용하는 문장 풀입니다. 영향 범위를 확인한 뒤 다시 제외해 주세요.", shared: true }, { status: 409 });
    }

    await updateRows("comment_pool_sentences", { id: eq(sentenceId), status: eq("approved") }, {
      status: "retired", updated_at: new Date().toISOString(),
    });
    const approved = await selectRows<{ id: number }>("comment_pool_sentences", {
      pool_version_id: eq(sentence.pool_version_id), status: eq("approved"), limit: COMMENT_POOL_TARGET,
    });
    await updateRows("comment_pool_versions", { id: eq(sentence.pool_version_id) }, {
      approved_count: approved.length,
      status: approved.length >= COMMENT_POOL_TARGET ? "ready" : approved.length ? "usable" : "failed",
      updated_at: new Date().toISOString(),
    });

    return Response.json({ excluded: true, shared, approvedCount: approved.length });
  } catch (error) {
    return dataError(error, "문장 후보를 제외하지 못했습니다.");
  }
}
