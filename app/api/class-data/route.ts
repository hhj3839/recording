import { and, asc, eq } from "drizzle-orm";
import { assessmentLevels, students } from "../../../db/schema";
import { dataError, getDataScope } from "../../data-scope";

export async function GET() {
  try {
    const { db, user, classId, classroom } = await getDataScope();
    const [studentRows, levelRows] = await Promise.all([
      db.select().from(students).where(and(eq(students.ownerEmail, user.email), eq(students.classId, classId), eq(students.active, true))).orderBy(asc(students.number)),
      db.select().from(assessmentLevels).where(and(eq(assessmentLevels.ownerEmail, user.email), eq(assessmentLevels.classId, classId))).orderBy(asc(assessmentLevels.studentId), asc(assessmentLevels.subject), asc(assessmentLevels.assessmentIndex)),
    ]);
    return Response.json({
      students: studentRows.map((student) => ({ id: student.id, number: student.number, name: student.name })),
      levels: levelRows.map(({ studentId, subject, assessmentIndex, level }) => ({ studentId, subject, assessmentIndex, level })),
      classroom: { schoolName: classroom.schoolName, schoolYear: classroom.schoolYear, semester: classroom.semester, grade: classroom.grade, classNumber: classroom.classNumber },
      user: { displayName: user.displayName },
    });
  } catch (error) {
    return dataError(error, "학급 데이터를 불러오지 못했습니다.");
  }
}
