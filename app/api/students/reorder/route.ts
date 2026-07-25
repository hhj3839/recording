import { supabaseRequest } from "../../../../db/supabase";
import { dataError, getDataScope, requireOwnedStudentIds } from "../../../data-scope";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { studentIds?: unknown };
    if (!Array.isArray(body.studentIds) || !body.studentIds.length || body.studentIds.length > 100) {
      return Response.json({ error: "학생 순서를 확인해 주세요." }, { status: 400 });
    }
    const studentIds = body.studentIds.map(Number);
    if (studentIds.some((id) => !Number.isInteger(id)) || new Set(studentIds).size !== studentIds.length) {
      return Response.json({ error: "중복되거나 잘못된 학생 정보가 있습니다." }, { status: 400 });
    }
    const { user, classId } = await getDataScope();
    await requireOwnedStudentIds(studentIds, user.id, classId);
    const students = await supabaseRequest<Array<{ id: number; number: number; name: string }>>("rpc/reorder_students", {
      method: "POST",
      body: { p_owner_id: user.id, p_class_id: classId, p_student_ids: studentIds },
    });
    return Response.json({ students });
  } catch (error) {
    return dataError(error, "학생 순서를 저장하지 못했습니다.");
  }
}
