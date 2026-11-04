import { eq, selectRows, insertRowsIfAbsent } from "../db/supabase";
import { getAuthUser } from "./supabase-auth";
import { cookies } from "next/headers";

export const ACTIVE_CLASS_COOKIE = "giroksam-active-class";

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
export class OwnershipConflictError extends Error {
  constructor() { super("기존 자료의 소유자 확인이 필요합니다. 관리자에게 문의해 주세요."); }
}

export async function createOwnedClassroom(row: Omit<SupabaseClassroom, "id">) {
  const inserted = await insertRowsIfAbsent<SupabaseClassroom>("classrooms", [row],
    "owner_email,school_year,semester,grade,class_number");
  const classroom = inserted[0] ?? (await selectRows<SupabaseClassroom>("classrooms", {
    owner_id: eq(row.owner_id), owner_email: eq(row.owner_email),
    school_year: eq(row.school_year), semester: eq(row.semester),
    grade: eq(row.grade), class_number: eq(row.class_number), limit: 1,
  }))[0];
  if (!classroom || classroom.owner_id !== row.owner_id) throw new OwnershipConflictError();
  return classroom;
}

export async function getDataScope() {
  const user = await getAuthUser();
  if (!user) throw new AuthenticationRequiredError("로그인이 필요합니다.");

  const cookieStore = await cookies();
  const preferredClassId = Number(cookieStore.get(ACTIVE_CLASS_COOKIE)?.value);
  // No cross-request cache: switching classes and ownership changes stay fresh.
  const candidateIds = [...new Set([preferredClassId, user.lastClassId]
    .filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0))];
  const candidates = candidateIds.length
    ? await selectRows<SupabaseClassroom>("classrooms", {
        id: `in.(${candidateIds.join(",")})`, owner_id: eq(user.id),
      })
    : [];
  // Preserve cookie > last-class priority regardless of database row order.
  let classroom = candidateIds.map(id => candidates.find(row => Number(row.id) === id)).find(Boolean);

  if (!classroom) {
    classroom = (await selectRows<SupabaseClassroom>("classrooms", {
      owner_id: eq(user.id),
      school_year: eq(user.schoolYear),
      semester: eq(user.semester),
      grade: eq(user.grade),
      class_number: eq(user.classNumber),
      limit: 1,
    }))[0];
  }

  if (!classroom) {
    // Only provisioning writes the teacher parent. Profile edits have their own endpoint.
    const now = new Date().toISOString();
    const teachers = await insertRowsIfAbsent<{ user_id: string }>("teachers", [{
      email: user.email, user_id: user.id, display_name: user.displayName,
      created_at: now,
    }], "email");
    const teacher = teachers[0] ?? (await selectRows<{ user_id: string }>("teachers", {
      email: eq(user.email), user_id: eq(user.id), limit: 1,
    }))[0];
    if (!teacher || teacher.user_id !== user.id) throw new OwnershipConflictError();
    classroom = await createOwnedClassroom({
      owner_id: user.id,
      owner_email: user.email,
      school_name: user.schoolName,
      school_year: user.schoolYear,
      semester: user.semester,
      grade: user.grade,
      class_number: user.classNumber,
      created_at: now,
    });
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
  if (error instanceof OwnershipConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof AuthenticationRequiredError) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (error instanceof AuthorizationError) {
    return Response.json({ error: error.message }, { status: 403 });
  }
  console.error(fallback, error instanceof Error ? error.message : "unknown");
  return Response.json({ error: fallback }, { status: 500 });
}
