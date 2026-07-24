import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { studentBehaviors } from "../../../db/schema";

export async function GET() {
  try {
    const db = await getDb();
    const rows = await db.select().from(studentBehaviors).orderBy(asc(studentBehaviors.studentId));
    return Response.json({ behaviors: rows });
  } catch (error) {
    console.error("Student behaviors load failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "저장된 행동특성을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { studentId?: unknown; characteristic?: unknown; behavior?: unknown };
    const studentId = Number(body.studentId);
    const characteristic = typeof body.characteristic === "string" ? body.characteristic.trim().slice(0, 4000) : "";
    const behavior = typeof body.behavior === "string" ? body.behavior.trim().slice(0, 8000) : "";
    if (!Number.isInteger(studentId)) return Response.json({ error: "학생 정보를 확인해 주세요." }, { status: 400 });
    const db = await getDb();
    const updatedAt = new Date().toISOString();
    await db.insert(studentBehaviors).values({ studentId, characteristic, behavior, updatedAt }).onConflictDoUpdate({
      target: studentBehaviors.studentId,
      set: { characteristic, behavior, updatedAt },
    });
    return Response.json({ ok: true, updatedAt });
  } catch (error) {
    console.error("Student behavior save failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "행동특성 내용을 저장하지 못했습니다." }, { status: 500 });
  }
}
