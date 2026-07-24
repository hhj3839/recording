import { upsertRows } from "../../../db/supabase";
import { dataError, getDataScope } from "../../data-scope";

type LevelInput = { studentId?: unknown; subject?: unknown; assessmentIndex?: unknown; level?: unknown };

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { levels?: unknown };
    if (!Array.isArray(body.levels)) return Response.json({ error: "평가수준을 확인해 주세요." }, { status: 400 });
    const levels = body.levels.flatMap((item: LevelInput) => {
      const studentId = Number(item?.studentId);
      const subject = typeof item?.subject === "string" ? item.subject : "";
      const assessmentIndex = Number(item?.assessmentIndex);
      const level = typeof item?.level === "string" ? item.level : "";
      return Number.isInteger(studentId) && subject && Number.isInteger(assessmentIndex) && ["상", "중", "하", "-"].includes(level)
        ? [{ studentId, subject, assessmentIndex, level }]
        : [];
    });
    if (!levels.length) return Response.json({ error: "저장할 평가수준이 없습니다." }, { status: 400 });
    const { user, classId } = await getDataScope();
    const updatedAt = new Date().toISOString();
    await upsertRows("assessment_levels", levels.map((item) => ({
      student_id: item.studentId,
      subject: item.subject,
      assessment_index: item.assessmentIndex,
      level: item.level,
      updated_at: updatedAt,
      owner_email: user.email,
      class_id: classId,
    })), "class_id,student_id,subject,assessment_index");
    return Response.json({ ok: true, updatedAt });
  } catch (error) {
    return dataError(error, "평가수준을 저장하지 못했습니다.");
  }
}
