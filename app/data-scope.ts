import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { assessmentPlans, classrooms, students, teachers } from "../db/schema";
import { getChatGPTUser } from "./chatgpt-auth";

export class AuthenticationRequiredError extends Error {}

export async function getDataScope() {
  const user = await getChatGPTUser();
  if (!user) throw new AuthenticationRequiredError("로그인이 필요합니다.");
  const db = await getDb();
  const now = new Date().toISOString();
  await db.insert(teachers).values({ email: user.email, displayName: user.displayName, createdAt: now }).onConflictDoUpdate({
    target: teachers.email,
    set: { displayName: user.displayName },
  });
  const classFilter = and(
    eq(classrooms.ownerEmail, user.email),
    eq(classrooms.schoolYear, 2026),
    eq(classrooms.semester, 1),
    eq(classrooms.grade, 3),
    eq(classrooms.classNumber, 5),
  );
  let classroom = (await db.select().from(classrooms).where(classFilter).limit(1))[0];
  if (!classroom) {
    await db.insert(classrooms).values({
      ownerEmail: user.email,
      schoolName: "서울하늘초등학교",
      schoolYear: 2026,
      semester: 1,
      grade: 3,
      classNumber: 5,
      createdAt: now,
    }).onConflictDoNothing();
    classroom = (await db.select().from(classrooms).where(classFilter).limit(1))[0];
  }
  if (!classroom) throw new Error("학급을 준비하지 못했습니다.");

  const existingPlans = await db.select({ id: assessmentPlans.id }).from(assessmentPlans).where(eq(assessmentPlans.classId, classroom.id)).limit(1);
  if (!existingPlans.length) {
    const templates = await db.select().from(assessmentPlans).where(eq(assessmentPlans.classId, 0)).orderBy(asc(assessmentPlans.sortOrder));
    await Promise.all(templates.map(({ id: _id, ...plan }) => db.insert(assessmentPlans).values({
      ...plan,
      ownerEmail: user.email,
      classId: classroom.id,
    }).onConflictDoNothing()));
  }
  const existingStudents = await db.select({ id: students.id }).from(students).where(eq(students.classId, classroom.id)).limit(1);
  if (!existingStudents.length) {
    const templates = await db.select().from(students).where(eq(students.classId, 0)).orderBy(asc(students.number));
    await Promise.all(templates.map(({ id: _id, ...student }) => db.insert(students).values({
      ...student,
      ownerEmail: user.email,
      classId: classroom.id,
    }).onConflictDoNothing()));
  }
  return { db, user, classId: classroom.id, classroom };
}

export function dataError(error: unknown, fallback: string) {
  if (error instanceof AuthenticationRequiredError) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  console.error(fallback, error instanceof Error ? error.message : "unknown");
  return Response.json({ error: fallback }, { status: 500 });
}
