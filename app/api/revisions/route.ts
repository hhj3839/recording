import { eq, selectRows } from "../../../db/supabase";
import { dataError, getDataScope, requireOwnedStudentIds } from "../../data-scope";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const studentId = Number(url.searchParams.get("studentId"));
    const subject = url.searchParams.get("subject") ?? "";
    if (!["comment", "behavior"].includes(type ?? "") || !Number.isInteger(studentId)) {
      return Response.json({ error: "이력 조회 정보를 확인해 주세요." }, { status: 400 });
    }
    const { user, classId } = await getDataScope();
    await requireOwnedStudentIds([studentId], user.id, classId);
    const rows = await selectRows<Record<string, string | number | boolean>>("record_revisions", {
      owner_id: eq(user.id), class_id: eq(classId), record_type: eq(type!), student_id: eq(studentId),
      ...(type === "comment" ? { subject: eq(subject) } : {}),
      order: "created_at.desc", limit: 20,
    });
    return Response.json({ revisions: rows.map((row) => ({
      id: Number(row.id), type: row.record_type, studentId: Number(row.student_id), subject: row.subject,
      content: row.content, characteristic: row.characteristic, confirmed: Boolean(row.confirmed),
      source: row.source, createdAt: row.created_at,
    })) });
  } catch (error) {
    return dataError(error, "이전 기록을 불러오지 못했습니다.");
  }
}
