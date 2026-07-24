import { assessmentLevels } from "../../../db/schema";
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
    const { db, user, classId } = await getDataScope();
    const updatedAt = new Date().toISOString();
    await Promise.all(levels.map((item) => db.insert(assessmentLevels).values({ ...item, updatedAt, ownerEmail: user.email, classId }).onConflictDoUpdate({
      target: [assessmentLevels.classId, assessmentLevels.studentId, assessmentLevels.subject, assessmentLevels.assessmentIndex],
      set: { level: item.level, updatedAt },
    })));
    return Response.json({ ok: true, updatedAt });
  } catch (error) {
    return dataError(error, "평가수준을 저장하지 못했습니다.");
  }
}
