import { eq, selectRows, upsertRows } from "../../../db/supabase";
import { dataError, getDataScope, requireOwnedStudentIds } from "../../data-scope";

export async function GET() {
  try {
    const { user, classId } = await getDataScope();
    const rows = await selectRows<Record<string, string | number>>("generated_comments", {
      owner_id: eq(user.id), class_id: eq(classId), order: "student_id.asc,subject.asc",
    });
    return Response.json({ comments: rows.map((row) => ({ studentId: row.student_id, subject: row.subject, comment: row.comment, updatedAt: row.updated_at })) });
  } catch (error) {
    return dataError(error, "저장된 평어를 불러오지 못했습니다.");
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { studentId?: unknown; subject?: unknown; comment?: unknown };
    const studentId = Number(body.studentId);
    const subject = typeof body.subject === "string" ? body.subject : "";
    const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 4000) : "";
    if (!Number.isInteger(studentId) || !subject) return Response.json({ error: "평어 정보를 확인해 주세요." }, { status: 400 });
    const { user, classId } = await getDataScope();
    await requireOwnedStudentIds([studentId], user.id, classId);
    const updatedAt = new Date().toISOString();
    await upsertRows("generated_comments", [{
      student_id: studentId, subject, comment, updated_at: updatedAt, owner_email: user.email, owner_id: user.id, class_id: classId,
    }], "class_id,student_id,subject");
    return Response.json({ ok: true, updatedAt });
  } catch (error) {
    return dataError(error, "수정한 평어를 저장하지 못했습니다.");
  }
}
