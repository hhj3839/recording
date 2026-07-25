import { eq, selectRows, upsertRows } from "../../../db/supabase";
import { dataError, getDataScope, requireOwnedStudentIds } from "../../data-scope";
import { recordSimilarity, validateRecord } from "../../record-validation";
import { archiveComment } from "../../record-revisions";

export async function GET() {
  try {
    const { user, classId } = await getDataScope();
    const rows = await selectRows<Record<string, string | number>>("generated_comments", {
      owner_id: eq(user.id), class_id: eq(classId), order: "student_id.asc,subject.asc",
    });
    return Response.json({ comments: rows.map((row) => ({ studentId: row.student_id, subject: row.subject, comment: row.comment, confirmed: Boolean(row.confirmed), confirmedAt: row.confirmed_at, updatedAt: row.updated_at })) });
  } catch (error) {
    return dataError(error, "저장된 평어를 불러오지 못했습니다.");
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { studentId?: unknown; subject?: unknown; comment?: unknown; confirmed?: unknown };
    const studentId = Number(body.studentId);
    const subject = typeof body.subject === "string" ? body.subject : "";
    const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 4000) : "";
    if (!Number.isInteger(studentId) || !subject) return Response.json({ error: "평어 정보를 확인해 주세요." }, { status: 400 });
    const confirmed = body.confirmed === true;
    const validation = validateRecord(comment);
    if (confirmed && !validation.valid) return Response.json({ error: "검수 항목을 모두 통과한 평어만 확정할 수 있습니다.", validation }, { status: 400 });
    const { user, classId } = await getDataScope();
    await requireOwnedStudentIds([studentId], user.id, classId);
    if (confirmed) {
      const peers = await selectRows<{ student_id: number; comment: string }>("generated_comments", {
        owner_id: eq(user.id), class_id: eq(classId), subject: eq(subject),
      });
      const duplicate = peers.find((item) => Number(item.student_id) !== studentId && recordSimilarity(comment, item.comment) >= 0.82);
      if (duplicate) return Response.json({ error: "같은 과목의 다른 학생 평어와 지나치게 유사하여 확정할 수 없습니다.", duplicateStudentId: duplicate.student_id }, { status: 409 });
    }
    await archiveComment({ ownerId: user.id, ownerEmail: user.email, classId, studentId, subject, nextContent: comment, source: confirmed ? "confirmation" : "manual-edit" });
    const updatedAt = new Date().toISOString();
    await upsertRows("generated_comments", [{
      student_id: studentId, subject, comment, confirmed, confirmed_at: confirmed ? updatedAt : null, updated_at: updatedAt, owner_email: user.email, owner_id: user.id, class_id: classId,
    }], "class_id,student_id,subject");
    return Response.json({ ok: true, confirmed, validation, updatedAt });
  } catch (error) {
    return dataError(error, "수정한 평어를 저장하지 못했습니다.");
  }
}
