import { eq, selectRows, upsertRows } from "../../../db/supabase";
import { dataError, getDataScope } from "../../data-scope";

export async function GET() {
  try {
    const { user, classId } = await getDataScope();
    const rows = await selectRows<Record<string, string | number>>("student_behaviors", {
      owner_email: eq(user.email), class_id: eq(classId), order: "student_id.asc",
    });
    return Response.json({ behaviors: rows.map((row) => ({
      id: row.id, studentId: row.student_id, characteristic: row.characteristic, behavior: row.behavior, updatedAt: row.updated_at,
    })) });
  } catch (error) {
    return dataError(error, "저장된 행동특성을 불러오지 못했습니다.");
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { studentId?: unknown; characteristic?: unknown; behavior?: unknown };
    const studentId = Number(body.studentId);
    const characteristic = typeof body.characteristic === "string" ? body.characteristic.trim().slice(0, 4000) : "";
    const behavior = typeof body.behavior === "string" ? body.behavior.trim().slice(0, 8000) : "";
    if (!Number.isInteger(studentId)) return Response.json({ error: "학생 정보를 확인해 주세요." }, { status: 400 });
    const { user, classId } = await getDataScope();
    const updatedAt = new Date().toISOString();
    await upsertRows("student_behaviors", [{
      student_id: studentId, characteristic, behavior, updated_at: updatedAt, owner_email: user.email, class_id: classId,
    }], "class_id,student_id");
    return Response.json({ ok: true, updatedAt });
  } catch (error) {
    return dataError(error, "행동특성 내용을 저장하지 못했습니다.");
  }
}
