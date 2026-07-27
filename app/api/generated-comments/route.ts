import { eq, selectRows, upsertRows } from "../../../db/supabase";
import { confirmationIssue } from "../../record-confirmation";
import { dataError, getDataScope, requireOwnedStudentIds } from "../../data-scope";
import { validateRecord } from "../../record-validation";
import { archiveComment } from "../../record-revisions";

export async function GET() {
  try {
    const { user, classId } = await getDataScope();
    const [rows, partRows] = await Promise.all([
      selectRows<Record<string, string | number>>("generated_comments", {
        owner_id: eq(user.id), class_id: eq(classId), order: "student_id.asc,subject.asc",
      }),
      selectRows<Record<string, string | number | string[]>>("generated_comment_parts", {
        owner_id: eq(user.id), class_id: eq(classId), order: "student_id.asc,subject.asc,assessment_index.asc",
      }),
    ]);
    return Response.json({
      comments: rows.map((row) => ({ studentId: row.student_id, subject: row.subject, comment: row.comment, candidates: row.candidates ?? [], confirmed: Boolean(row.confirmed), confirmedAt: row.confirmed_at, updatedAt: row.updated_at })),
      parts: partRows.map((row) => ({
        studentId: Number(row.student_id), subject: String(row.subject), assessmentIndex: Number(row.assessment_index),
        sentence: String(row.sentence), status: String(row.status), issues: Array.isArray(row.issues) ? row.issues : [],
      })),
    });
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
    const { user, classId } = await getDataScope();
    await requireOwnedStudentIds([studentId], user.id, classId);
    if (confirmed) {
      const peers = await selectRows<{ student_id: number; comment: string }>("generated_comments", {
        owner_id: eq(user.id), class_id: eq(classId), subject: eq(subject),
      });
      const issue = confirmationIssue(comment, studentId, peers.map((item) => ({ studentId: Number(item.student_id), content: item.comment })));
      if (issue) return Response.json(issue, { status: issue.status });
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
