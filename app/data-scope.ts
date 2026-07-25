import { eq, selectRows, upsertRows } from "../db/supabase";
import { getAuthUser } from "./supabase-auth";

type SupabaseClassroom = {
  id: number;
  owner_id: string;
  owner_email: string;
  school_name: string;
  school_year: number;
  semester: number;
  grade: number;
  class_number: number;
  created_at: string;
};

export class AuthenticationRequiredError extends Error {}
export class AuthorizationError extends Error {}

export async function getDataScope() {
  const user = await getAuthUser();
  if (!user) throw new AuthenticationRequiredError("로그인이 필요합니다.");

  const now = new Date().toISOString();
  await upsertRows("teachers", [{
    email: user.email,
    user_id: user.id,
    display_name: user.displayName,
    created_at: now,
  }], "email");

  let classroom = (await selectRows<SupabaseClassroom>("classrooms", {
    owner_id: eq(user.id),
    school_year: eq(user.schoolYear),
    semester: eq(user.semester),
    grade: eq(user.grade),
    class_number: eq(user.classNumber),
    limit: 1,
  }))[0];

  if (!classroom) {
    classroom = (await upsertRows<SupabaseClassroom>("classrooms", [{
      owner_id: user.id,
      owner_email: user.email,
      school_name: user.schoolName,
      school_year: user.schoolYear,
      semester: user.semester,
      grade: user.grade,
      class_number: user.classNumber,
      created_at: now,
    }], "owner_email,school_year,semester,grade,class_number"))[0];
  }

  if (classroom.owner_id !== user.id) throw new AuthorizationError("학급 접근 권한이 없습니다.");
  return { user, classId: classroom.id, classroom };
}

export async function requireOwnedStudentIds(
  studentIds: number[],
  ownerId: string,
  classId: number,
) {
  const uniqueIds = [...new Set(studentIds)];
  if (!uniqueIds.length) return;
  const rows = await selectRows<{ id: number }>("students", {
    owner_id: eq(ownerId),
    class_id: eq(classId),
    active: eq(true),
  });
  const allowed = new Set(rows.map((row) => Number(row.id)));
  if (uniqueIds.some((id) => !allowed.has(id))) {
    throw new AuthorizationError("현재 학급에 속하지 않은 학생 정보가 포함되어 있습니다.");
  }
}

export function dataError(error: unknown, fallback: string) {
  if (error instanceof AuthenticationRequiredError) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (error instanceof AuthorizationError) {
    return Response.json({ error: error.message }, { status: 403 });
  }
  console.error(fallback, error instanceof Error ? error.message : "unknown");
  return Response.json({ error: fallback }, { status: 500 });
}
