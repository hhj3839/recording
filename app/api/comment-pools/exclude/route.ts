import { eq, selectRows, updateRows } from "../../../../db/supabase";
import { COMMENT_POOL_TARGET, normalizedPoolSentence } from "../../../comment-pool-library";
import { hasNaturalNominalEnding, normalizeGeneratedCommentWhitespace } from "../../../comment-generation-policy";
import { dataError, getDataScope } from "../../../data-scope";

type PoolSentence = { id: number; pool_version_id: number; status: string };

async function sentenceScope(userId: string, classId: number, sentenceId: number) {
  const sentence = (await selectRows<PoolSentence>("comment_pool_sentences", {
    id: eq(sentenceId), status: eq("approved"), limit: 1,
  }))[0];
  if (!sentence) return { error: Response.json({ error: "이미 제외되었거나 찾을 수 없는 문장 후보입니다." }, { status: 404 }) };
  const currentLink = (await selectRows<{ id: number }>("assessment_plan_pool_links", {
    owner_id: eq(userId), class_id: eq(classId), pool_version_id: eq(sentence.pool_version_id), limit: 1,
  }))[0];
  if (!currentLink) return { error: Response.json({ error: "현재 학급에 연결된 문장 후보만 수정할 수 있습니다." }, { status: 403 }) };
  const links = await selectRows<{ owner_id: string; class_id: number }>("assessment_plan_pool_links", {
    pool_version_id: eq(sentence.pool_version_id),
  });
  const shared = links.some((link) => link.owner_id !== userId || Number(link.class_id) !== classId);
  return { sentence, shared };
}

export async function PATCH(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    const body = await request.json().catch(() => ({})) as { sentenceId?: unknown; sentence?: unknown; allowShared?: unknown };
    const sentenceId = Number(body.sentenceId);
    const sentence = normalizeGeneratedCommentWhitespace(typeof body.sentence === "string" ? body.sentence : "");
    if (!Number.isInteger(sentenceId) || sentenceId < 1 || !sentence) {
      return Response.json({ error: "수정할 문장과 내용을 확인해 주세요." }, { status: 400 });
    }
    if (!hasNaturalNominalEnding(sentence)) {
      return Response.json({ error: "문장은 자연스러운 명사형 종결과 마침표로 끝나야 합니다." }, { status: 400 });
    }
    const scope = await sentenceScope(user.id, classId, sentenceId);
    if (scope.error) return scope.error;
    if (scope.shared && body.allowShared !== true) {
      return Response.json({ error: "공동으로 사용하는 문장 풀입니다. 영향 범위를 확인한 뒤 다시 수정해 주세요.", shared: true }, { status: 409 });
    }
    const updated = await updateRows<{ id: number; sentence: string }>("comment_pool_sentences", {
      id: eq(sentenceId), status: eq("approved"),
    }, {
      sentence, normalized_sentence: normalizedPoolSentence(sentence), source: "teacher_edited", updated_at: new Date().toISOString(),
    });
    if (!updated[0]) return Response.json({ error: "문장을 수정하지 못했습니다." }, { status: 409 });
    return Response.json({ updated: true, shared: scope.shared, sentence: updated[0].sentence });
  } catch (error) {
    return dataError(error, "문장을 수정하지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    const body = await request.json().catch(() => ({})) as { sentenceId?: unknown; sentenceIds?: unknown; allowShared?: unknown };
    const requestedIds = Array.isArray(body.sentenceIds) ? body.sentenceIds : [body.sentenceId];
    const sentenceIds = [...new Set(requestedIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (!sentenceIds.length || sentenceIds.length > 20) {
      return Response.json({ error: "제외할 문장 후보를 확인해 주세요." }, { status: 400 });
    }

    const sentences = await selectRows<PoolSentence>("comment_pool_sentences", {
      id: `in.(${sentenceIds.join(",")})`, status: eq("approved"), limit: 20,
    });
    if (sentences.length !== sentenceIds.length) return Response.json({ error: "일부 문장이 이미 제외되었거나 찾을 수 없습니다." }, { status: 404 });
    const poolVersionIds = [...new Set(sentences.map((sentence) => Number(sentence.pool_version_id)))];

    const currentLinks = await selectRows<{ id: number; pool_version_id: number }>("assessment_plan_pool_links", {
      owner_id: eq(user.id), class_id: eq(classId), pool_version_id: `in.(${poolVersionIds.join(",")})`, limit: 20,
    });
    const currentVersionIds = new Set(currentLinks.map((link) => Number(link.pool_version_id)));
    if (poolVersionIds.some((id) => !currentVersionIds.has(id))) return Response.json({ error: "현재 학급에 연결된 문장 후보만 제외할 수 있습니다." }, { status: 403 });

    const links = await selectRows<{ owner_id: string; class_id: number }>("assessment_plan_pool_links", {
      pool_version_id: `in.(${poolVersionIds.join(",")})`,
    });
    const shared = links.some((link) => link.owner_id !== user.id || Number(link.class_id) !== classId);
    if (shared && body.allowShared !== true) {
      return Response.json({ error: "공동으로 사용하는 문장 풀입니다. 영향 범위를 확인한 뒤 다시 제외해 주세요.", shared: true }, { status: 409 });
    }

    await updateRows("comment_pool_sentences", { id: `in.(${sentenceIds.join(",")})`, status: eq("approved") }, {
      status: "retired", updated_at: new Date().toISOString(),
    });
    let approvedCount = 0;
    for (const poolVersionId of poolVersionIds) {
      const approved = await selectRows<{ id: number }>("comment_pool_sentences", {
        pool_version_id: eq(poolVersionId), status: eq("approved"), limit: COMMENT_POOL_TARGET,
      });
      approvedCount += approved.length;
      await updateRows("comment_pool_versions", { id: eq(poolVersionId) }, {
        approved_count: approved.length,
        status: approved.length >= COMMENT_POOL_TARGET ? "ready" : approved.length ? "usable" : "failed",
        updated_at: new Date().toISOString(),
      });
    }

    return Response.json({ excluded: true, excludedCount: sentenceIds.length, shared, approvedCount });
  } catch (error) {
    return dataError(error, "문장 후보를 제외하지 못했습니다.");
  }
}
