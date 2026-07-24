import { and, asc, eq } from "drizzle-orm";
import { studentBehaviors } from "../../../db/schema";
import { dataError, getDataScope } from "../../data-scope";

export async function GET() {
  try {
    const { db, user, classId } = await getDataScope();
    const rows = await db.select().from(studentBehaviors).where(and(eq(studentBehaviors.ownerEmail, user.email), eq(studentBehaviors.classId, classId))).orderBy(asc(studentBehaviors.studentId));
    return Response.json({ behaviors: rows });
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
    const { db, user, classId } = await getDataScope();
    const updatedAt = new Date().toISOString();
    await db.insert(studentBehaviors).values({ studentId, characteristic, behavior, updatedAt, ownerEmail: user.email, classId }).onConflictDoUpdate({
      target: [studentBehaviors.classId, studentBehaviors.studentId],
      set: { characteristic, behavior, updatedAt },
    });
    return Response.json({ ok: true, updatedAt });
  } catch (error) {
    return dataError(error, "행동특성 내용을 저장하지 못했습니다.");
  }
}
