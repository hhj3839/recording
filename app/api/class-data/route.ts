import { eq, selectRows } from "../../../db/supabase";
import { dataError, getDataScope } from "../../data-scope";

export async function GET() {
  try {
    const { user, classId, classroom } = await getDataScope();
    const [studentRows, levelRows] = await Promise.all([
      selectRows<Record<string, string | number | boolean>>("students", { owner_id: eq(user.id), class_id: eq(classId), active: eq(true), order: "number.asc" }),
      selectRows<Record<string, string | number>>("assessment_levels", { owner_id: eq(user.id), class_id: eq(classId), order: "student_id.asc,subject.asc,assessment_index.asc" }),
    ]);
    return Response.json({
      students: studentRows.map((student) => ({ id: student.id, number: student.number, name: student.name })),
      levels: levelRows.map((row) => ({ studentId: row.student_id, subject: row.subject, assessmentIndex: row.assessment_index, level: row.level })),
      classroom: { schoolName: classroom.school_name, schoolYear: classroom.school_year, semester: classroom.semester, grade: classroom.grade, classNumber: classroom.class_number },
      user: { displayName: user.displayName },
    });
  } catch (error) {
    return dataError(error, "학급 데이터를 불러오지 못했습니다.");
  }
}
