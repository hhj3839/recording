import { eq, selectRows, supabaseRequest, updateRows } from "../../../../db/supabase";
import { dataError, getDataScope } from "../../../data-scope";

export async function GET() {
  try {
    const { user, classId } = await getDataScope();
    const students = await selectRows<{ id: number; number: number; name: string }>("students", {
      owner_id: eq(user.id), class_id: eq(classId), active: eq(false), order: "number.asc",
    });
    return Response.json({ students: students.map((student) => ({ id: Number(student.id), number: Number(student.number), name: student.name })) });
  } catch (error) {
    return dataError(error, "전출·비활성 학생을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "학생 정보를 확인해 주세요." }, { status: 400 });
    const { user, classId } = await getDataScope();
    const rows = await updateRows<{ id: number; number: number; name: string }>(
      "students",
      { id: eq(id), owner_id: eq(user.id), class_id: eq(classId), active: eq(false) },
      { active: true },
    );
    if (!rows[0]) return Response.json({ error: "복귀할 학생을 찾지 못했습니다." }, { status: 404 });
    return Response.json({ student: rows[0] });
  } catch (error) {
    return dataError(error, "학생을 재학생으로 복귀시키지 못했습니다.");
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { id?: unknown; confirmation?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id) || body.confirmation !== "학생영구삭제") {
      return Response.json({ error: "학생 정보 또는 확인 문구가 올바르지 않습니다." }, { status: 400 });
    }
    const { user, classId } = await getDataScope();
    const student = (await selectRows<{ id: number }>("students", {
      id: eq(id), owner_id: eq(user.id), class_id: eq(classId), active: eq(false), limit: 1,
    }))[0];
    if (!student) return Response.json({ error: "영구 삭제할 비활성 학생을 찾지 못했습니다." }, { status: 404 });
    const activeJobs = await selectRows<{ id: string }>("generation_jobs", {
      owner_id: eq(user.id), class_id: eq(classId), status: "in.(queued,running)", limit: 1,
    });
    if (activeJobs.length) return Response.json({ error: "AI 생성 작업이 끝난 뒤 학생을 영구 삭제해 주세요." }, { status: 409 });
    for (const table of ["assessment_levels", "generated_comment_parts", "generated_comments", "student_behaviors", "record_revisions"] as const) {
      await supabaseRequest(table, {
        method: "DELETE", query: { owner_id: eq(user.id), class_id: eq(classId), student_id: eq(id) },
      });
    }
    await supabaseRequest("students", {
      method: "DELETE", query: { id: eq(id), owner_id: eq(user.id), class_id: eq(classId), active: eq(false) },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return dataError(error, "학생을 영구 삭제하지 못했습니다.");
  }
}
