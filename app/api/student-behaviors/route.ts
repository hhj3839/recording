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
