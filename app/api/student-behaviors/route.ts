import { eq, selectRows, upsertRows } from "../../../db/supabase";
import { dataError, getDataScope, requireOwnedStudentIds } from "../../data-scope";
import { recordSimilarity, validateRecord } from "../../record-validation";
import { archiveBehavior } from "../../record-revisions";

export async function GET() {
  try {
    const { user, classId } = await getDataScope();
    const rows = await selectRows<Record<string, string | number>>("student_behaviors", {
      owner_id: eq(user.id), class_id: eq(classId), order: "student_id.asc",
    });
    return Response.json({ behaviors: rows.map((row) => ({
      id: row.id, studentId: row.student_id, characteristic: row.characteristic, behavior: row.behavior, confirmed: Boolean(row.confirmed), confirmedAt: row.confirmed_at, updatedAt: row.updated_at,
    })) });
  } catch (error) {
    return dataError(error, "저장된 행동특성을 불러오지 못했습니다.");
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { studentId?: unknown; characteristic?: unknown; behavior?: unknown; confirmed?: unknown };
    const studentId = Number(body.studentId);
    const characteristic = typeof body.characteristic === "string" ? body.characteristic.trim().slice(0, 4000) : "";
    const behavior = typeof body.behavior === "string" ? body.behavior.trim().slice(0, 8000) : "";
    if (!Number.isInteger(studentId)) return Response.json({ error: "학생 정보를 확인해 주세요." }, { status: 400 });
    const confirmed = body.confirmed === true;
    const validation = validateRecord(behavior, true);
    if (confirmed && !validation.valid) return Response.json({ error: "검수 항목을 모두 통과한 행동특성만 확정할 수 있습니다.", validation }, { status: 400 });
    const { user, classId } = await getDataScope();
    await requireOwnedStudentIds([studentId], user.id, classId);
    if (confirmed) {
      const peers = await selectRows<{ student_id: number; behavior: string }>("student_behaviors", {
        owner_id: eq(user.id), class_id: eq(classId),
      });
      const duplicate = peers.find((item) => Number(item.student_id) !== studentId && recordSimilarity(behavior, item.behavior) >= 0.82);
      if (duplicate) return Response.json({ error: "다른 학생의 행동특성과 지나치게 유사하여 확정할 수 없습니다.", duplicateStudentId: duplicate.student_id }, { status: 409 });
    }
    await archiveBehavior({ ownerId: user.id, ownerEmail: user.email, classId, studentId, nextContent: behavior, nextCharacteristic: characteristic, source: confirmed ? "confirmation" : "manual-edit" });
    const updatedAt = new Date().toISOString();
    await upsertRows("student_behaviors", [{
      student_id: studentId, characteristic, behavior, confirmed, confirmed_at: confirmed ? updatedAt : null, updated_at: updatedAt, owner_email: user.email, owner_id: user.id, class_id: classId,
    }], "class_id,student_id");
    return Response.json({ ok: true, confirmed, validation, updatedAt });
  } catch (error) {
    return dataError(error, "행동특성 내용을 저장하지 못했습니다.");
  }
}
