import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { assessmentLevels, students } from "../../../db/schema";

export async function GET() {
  try {
    const db = await getDb();
    const [studentRows, levelRows] = await Promise.all([
      db.select().from(students).where(eq(students.active, true)).orderBy(asc(students.number)),
      db.select().from(assessmentLevels).orderBy(asc(assessmentLevels.studentId), asc(assessmentLevels.subject), asc(assessmentLevels.assessmentIndex)),
    ]);
    return Response.json({
      students: studentRows.map((student) => ({ id: student.id, number: student.number, name: student.name })),
      levels: levelRows.map(({ studentId, subject, assessmentIndex, level }) => ({ studentId, subject, assessmentIndex, level })),
    });
  } catch (error) {
    console.error("Class data load failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "학급 데이터를 불러오지 못했습니다." }, { status: 500 });
  }
}

