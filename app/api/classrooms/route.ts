import { NextResponse } from "next/server";
import { eq, selectRows, supabaseRequest, upsertRows } from "../../../db/supabase";
import { ACTIVE_CLASS_COOKIE, AuthenticationRequiredError, dataError } from "../../data-scope";
import { getAuthUser } from "../../supabase-auth";
import { CLASS_DATA_TABLES } from "../../class-data-tables";

type ClassroomRow = {
  id: number;
  school_name: string;
  school_year: number;
  semester: number;
  grade: number;
  class_number: number;
  created_at: string;
};

const present = (row: ClassroomRow) => ({
  id: Number(row.id),
  schoolName: row.school_name,
  schoolYear: Number(row.school_year),
  semester: Number(row.semester),
  grade: Number(row.grade),
  classNumber: Number(row.class_number),
});

async function userOrThrow() {
  const user = await getAuthUser();
  if (!user) throw new AuthenticationRequiredError("로그인이 필요합니다.");
  return user;
}

export async function GET() {
  try {
    const user = await userOrThrow();
    const rows = await selectRows<ClassroomRow>("classrooms", {
      owner_id: eq(user.id),
      order: "school_year.desc,semester.desc,grade.asc,class_number.asc",
    });
    return Response.json({ classrooms: rows.map(present) });
  } catch (error) {
    return dataError(error, "학급 목록을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await userOrThrow();
    const body = await request.json() as Record<string, unknown>;
    const schoolName = typeof body.schoolName === "string" ? body.schoolName.trim().slice(0, 100) : "";
    const schoolYear = Number(body.schoolYear);
    const semester = Number(body.semester);
    const grade = Number(body.grade);
    const classNumber = Number(body.classNumber);
    if (!schoolName || schoolYear < 2020 || schoolYear > 2100 || ![1, 2].includes(semester) || grade < 1 || grade > 6 || classNumber < 1 || classNumber > 30) {
      return Response.json({ error: "학교·학년도·학기·학년·반 정보를 확인해 주세요." }, { status: 400 });
    }
    const rows = await upsertRows<ClassroomRow>("classrooms", [{
      owner_id: user.id,
      owner_email: user.email,
      school_name: schoolName,
      school_year: schoolYear,
      semester,
      grade,
      class_number: classNumber,
      created_at: new Date().toISOString(),
    }], "owner_email,school_year,semester,grade,class_number");
    const response = NextResponse.json({ classroom: present(rows[0]) });
    response.cookies.set(ACTIVE_CLASS_COOKIE, String(rows[0].id), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    return dataError(error, "학급을 추가하지 못했습니다.");
  }
}

export async function PUT(request: Request) {
  try {
    const user = await userOrThrow();
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "학급 정보를 확인해 주세요." }, { status: 400 });
    const classroom = (await selectRows<ClassroomRow>("classrooms", { id: eq(id), owner_id: eq(user.id), limit: 1 }))[0];
    if (!classroom) return Response.json({ error: "선택할 수 없는 학급입니다." }, { status: 403 });
    const response = NextResponse.json({ classroom: present(classroom) });
    response.cookies.set(ACTIVE_CLASS_COOKIE, String(classroom.id), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    return dataError(error, "학급을 전환하지 못했습니다.");
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await userOrThrow();
    const body = await request.json() as { id?: unknown; confirmation?: unknown };
    const id = Number(body.id);
    const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : "";
    if (!Number.isInteger(id) || confirmation !== "학급삭제") {
      return Response.json({ error: "학급 정보 또는 확인 문구가 올바르지 않습니다." }, { status: 400 });
    }

    const classrooms = await selectRows<ClassroomRow>("classrooms", {
      owner_id: eq(user.id),
      order: "school_year.desc,semester.desc,grade.asc,class_number.asc",
    });
    const classroom = classrooms.find((item) => Number(item.id) === id);
    if (!classroom) return Response.json({ error: "삭제할 수 없는 학급입니다." }, { status: 403 });
    if (classrooms.length <= 1) {
      return Response.json({ error: "사용할 학급이 하나는 필요합니다. 새 학급을 추가한 뒤 이 학급을 삭제해 주세요." }, { status: 409 });
    }

    for (const table of CLASS_DATA_TABLES) {
      await supabaseRequest(table, {
        method: "DELETE",
        query: { owner_id: eq(user.id), class_id: eq(id) },
      });
    }
    await supabaseRequest("classrooms", {
      method: "DELETE",
      query: { id: eq(id), owner_id: eq(user.id) },
    });

    const nextClassroom = classrooms.find((item) => Number(item.id) !== id)!;
    const response = NextResponse.json({ ok: true, classroom: present(nextClassroom) });
    response.cookies.set(ACTIVE_CLASS_COOKIE, String(nextClassroom.id), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    return dataError(error, "학급을 삭제하지 못했습니다.");
  }
}
