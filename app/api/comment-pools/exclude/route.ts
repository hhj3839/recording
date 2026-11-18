import { hasNaturalNominalEnding, normalizeGeneratedCommentWhitespace } from "../../../comment-generation-policy";
import { editLocalPool, PoolEditConflict } from "../../../comment-pool-local-edit";
import { dataError, getDataScope } from "../../../data-scope";
import { eq, selectRows } from "../../../../db/supabase";

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
    let impactMessage = "영향 학생 조회를 완료하지 못했습니다. 기존 학생 평어는 유지됩니다.";
    try {
      const records = await selectRows<{ student_id: number; comment: string }>("generated_comments", { owner_id: eq(user.id), class_id: eq(classId), subject: eq(result.subject) });
      const affectedIds = new Set(records.filter((row) => result.changedSentences.some((text) => text && row.comment.includes(text))).map((row) => Number(row.student_id)));
      const students = affectedIds.size ? await selectRows<{ id: number; number: number; name: string }>("students", { owner_id: eq(user.id), class_id: eq(classId), id: `in.(${[...affectedIds].join(",")})` }) : [];
      impactMessage = affectedIds.size ? `변경 전 문장을 포함한 학생 ${affectedIds.size}명: ${students.map((student) => `${student.number}번 ${student.name}`).join(", ")}. 교과평어에서 선택 재배정할 수 있습니다. 기존 결과는 자동 변경하지 않았습니다.` : "변경 전 문장을 그대로 포함한 학생 평어는 없습니다. 수동으로 바꾼 문장까지 추적한 결과는 아닙니다.";
    } catch { /* Pool edit succeeded; report impact lookup separately. */ }
    return Response.json({ approvedCount: result.approvedCount, poolVersionId: result.poolVersionId, impactMessage, ...(editing ? { updated: true, sentence } : { excluded: true, excludedCount: sentenceIds.length }) });
  } catch (error) {
    if (error instanceof PoolEditConflict) return Response.json({ error: error.message }, { status: 409 });
    return dataError(error, "문장 후보를 변경하지 못했습니다. 기존 풀을 다시 확인해 주세요.");
  }
}

export async function PATCH(request: Request) { return change(request, true); }
export async function POST(request: Request) { return change(request, false); }
