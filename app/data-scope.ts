import { and, asc, eq as drizzleEq } from "drizzle-orm";
import { getDb } from "../db";
import {
  assessmentLevels as d1AssessmentLevels,
  assessmentPlans as d1AssessmentPlans,
  classrooms as d1Classrooms,
  generatedComments as d1GeneratedComments,
  studentBehaviors as d1StudentBehaviors,
  students as d1Students,
} from "../db/schema";
import { eq, insertRows, selectRows, upsertRows } from "../db/supabase";
import { getChatGPTUser } from "./chatgpt-auth";

type SupabaseClassroom = {
  id: number;
  owner_email: string;
  school_name: string;
  school_year: number;
  semester: number;
  grade: number;
  class_number: number;
  created_at: string;
};

type SupabaseStudent = { id: number; number: number; name: string };

export class AuthenticationRequiredError extends Error {}

async function migrateD1Data(ownerEmail: string, classId: number) {
  const db = await getDb();
  const legacyClass = (await db.select().from(d1Classrooms).where(and(
    drizzleEq(d1Classrooms.ownerEmail, ownerEmail),
    drizzleEq(d1Classrooms.schoolYear, 2026),
    drizzleEq(d1Classrooms.semester, 1),
    drizzleEq(d1Classrooms.grade, 3),
    drizzleEq(d1Classrooms.classNumber, 5),
  )).limit(1))[0];
  const sourceClassId = legacyClass?.id ?? 0;
  const planRows = await db.select().from(d1AssessmentPlans).where(drizzleEq(d1AssessmentPlans.classId, sourceClassId)).orderBy(asc(d1AssessmentPlans.sortOrder));
  const studentRows = await db.select().from(d1Students).where(drizzleEq(d1Students.classId, sourceClassId)).orderBy(asc(d1Students.number));
  await upsertRows("assessment_plans", planRows.map((row) => ({
    subject: row.subject,
    unit: row.unit,
    goal: row.goal,
    domain: row.domain,
    assessment_type: row.assessmentType,
    perspective: row.perspective,
    high: row.high,
    middle: row.middle,
    low: row.low,
    caution: row.caution,
    sort_order: row.sortOrder,
    owner_email: ownerEmail,
    class_id: classId,
  })), "class_id,subject,unit,goal");
  const migratedStudents = await upsertRows<SupabaseStudent>("students", studentRows.map((row) => ({
    number: row.number,
    name: row.name,
    active: row.active,
    created_at: row.createdAt,
    owner_email: ownerEmail,
    class_id: classId,
  })), "class_id,number");
  if (!legacyClass) return;
  const newIdByNumber = new Map(migratedStudents.map((student) => [student.number, student.id]));
  const newIdByOldId = new Map(studentRows.flatMap((student) => {
    const newId = newIdByNumber.get(student.number);
    return newId ? [[student.id, newId] as const] : [];
  }));
  const [levels, comments, behaviors] = await Promise.all([
    db.select().from(d1AssessmentLevels).where(drizzleEq(d1AssessmentLevels.classId, legacyClass.id)),
    db.select().from(d1GeneratedComments).where(drizzleEq(d1GeneratedComments.classId, legacyClass.id)),
    db.select().from(d1StudentBehaviors).where(drizzleEq(d1StudentBehaviors.classId, legacyClass.id)),
  ]);
  await upsertRows("assessment_levels", levels.flatMap((row) => {
    const studentId = newIdByOldId.get(row.studentId);
    return studentId ? [{
      student_id: studentId, subject: row.subject, assessment_index: row.assessmentIndex, level: row.level,
      updated_at: row.updatedAt, owner_email: ownerEmail, class_id: classId,
    }] : [];
  }), "class_id,student_id,subject,assessment_index");
  await upsertRows("generated_comments", comments.flatMap((row) => {
    const studentId = newIdByOldId.get(row.studentId);
    return studentId ? [{
      student_id: studentId, subject: row.subject, comment: row.comment, updated_at: row.updatedAt,
      owner_email: ownerEmail, class_id: classId,
    }] : [];
  }), "class_id,student_id,subject");
  await upsertRows("student_behaviors", behaviors.flatMap((row) => {
    const studentId = newIdByOldId.get(row.studentId);
    return studentId ? [{
      student_id: studentId, characteristic: row.characteristic, behavior: row.behavior, updated_at: row.updatedAt,
      owner_email: ownerEmail, class_id: classId,
    }] : [];
  }), "class_id,student_id");
}

export async function getDataScope() {
  const user = await getChatGPTUser();
  if (!user) throw new AuthenticationRequiredError("로그인이 필요합니다.");
  const now = new Date().toISOString();
  await upsertRows("teachers", [{ email: user.email, display_name: user.displayName, created_at: now }], "email");
  let classroom = (await selectRows<SupabaseClassroom>("classrooms", {
    owner_email: eq(user.email),
    school_year: eq(2026),
    semester: eq(1),
    grade: eq(3),
    class_number: eq(5),
    limit: 1,
  }))[0];
  if (!classroom) {
    classroom = (await insertRows<SupabaseClassroom>("classrooms", [{
      owner_email: user.email,
      school_name: "서울하늘초등학교",
      school_year: 2026,
      semester: 1,
      grade: 3,
      class_number: 5,
      created_at: now,
    }]))[0];
    await migrateD1Data(user.email, classroom.id);
  }
  return { user, classId: classroom.id, classroom };
}

export function dataError(error: unknown, fallback: string) {
  if (error instanceof AuthenticationRequiredError) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  console.error(fallback, error instanceof Error ? error.message : "unknown");
  return Response.json({ error: fallback }, { status: 500 });
}
