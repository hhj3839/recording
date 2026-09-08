import { hasNaturalNominalEnding, normalizeGeneratedCommentWhitespace } from "../../../comment-generation-policy";
import { editLocalPool, PoolEditConflict } from "../../../comment-pool-local-edit";
import { dataError, getDataScope } from "../../../data-scope";

async function change(request: Request, editing: boolean) {
  try {
    const { user, classId } = await getDataScope();
    const body = await request.json().catch(() => ({}));
    const assessmentPlanId = Number(body.assessmentPlanId);
    const ids = editing ? [body.sentenceId] : Array.isArray(body.sentenceIds) ? body.sentenceIds : [body.sentenceId];
    const sentenceIds = [...new Set<number>(ids.map(Number))];
    if (!Number.isInteger(assessmentPlanId) || assessmentPlanId < 1 || !sentenceIds.length || sentenceIds.length > 20 || sentenceIds.some((id) => !Number.isInteger(id) || id < 1)) {
      return Response.json({ error: "평가계획과 수정할 문장을 확인해 주세요." }, { status: 400 });
    }
    const sentence = normalizeGeneratedCommentWhitespace(typeof body.sentence === "string" ? body.sentence : "");
    if (editing && (!sentence || !hasNaturalNominalEnding(sentence))) {
      return Response.json({ error: "문장은 자연스러운 명사형 종결과 마침표로 끝나야 합니다." }, { status: 400 });
    }
    const result = await editLocalPool({ ownerId: user.id, classId, assessmentPlanId, sentenceIds, replacement: editing ? sentence : undefined });
    return Response.json({ ...result, ...(editing ? { updated: true, sentence } : { excluded: true, excludedCount: sentenceIds.length }) });
  } catch (error) {
    if (error instanceof PoolEditConflict) return Response.json({ error: error.message }, { status: 409 });
    return dataError(error, "문장 후보를 변경하지 못했습니다. 기존 풀을 다시 확인해 주세요.");
  }
}

export async function PATCH(request: Request) { return change(request, true); }
export async function POST(request: Request) { return change(request, false); }
