import { eq, insertRows, updateRows, upsertRows } from "../../../db/supabase";
import { dataError, getDataScope } from "../../data-scope";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: unknown; number?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 50) : "";
    const number = Number(body.number);
    if (!name || !Number.isInteger(number) || number < 1) return Response.json({ error: "학생 정보를 확인해 주세요." }, { status: 400 });
    const { user, classId } = await getDataScope();
    const now = new Date().toISOString();
    const [student] = await insertRows<{ id: number; number: number; name: string }>("students", [{
      name, number, active: true, created_at: now, owner_email: user.email, owner_id: user.id, class_id: classId,
    }]);
    return Response.json({ student });
  } catch (error) {
    return dataError(error, "학생을 추가하지 못했습니다.");
  }
}

export async function DELETE(request: Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "학생 정보를 확인해 주세요." }, { status: 400 });
    const { user, classId } = await getDataScope();
    await updateRows("students", { id: eq(id), owner_id: eq(user.id), class_id: eq(classId) }, { active: false });
    return Response.json({ ok: true });
  } catch (error) {
    return dataError(error, "학생을 삭제하지 못했습니다.");
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: unknown; number?: unknown; name?: unknown };
    const id = Number(body.id);
    const number = Number(body.number);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    if (!Number.isInteger(id) || !Number.isInteger(number) || number < 1 || !name) {
      return Response.json({ error: "학생 번호와 이름을 확인해 주세요." }, { status: 400 });
    }
    const { user, classId } = await getDataScope();
    const [student] = await updateRows<{ id: number; number: number; name: string }>(
      "students",
      { id: eq(id), owner_id: eq(user.id), class_id: eq(classId) },
      { number, name },
    );
    if (!student) return Response.json({ error: "수정할 학생을 찾지 못했습니다." }, { status: 404 });
    return Response.json({ student });
  } catch (error) {
    return dataError(error, "학생 정보를 수정하지 못했습니다.");
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { students?: unknown };
    if (!Array.isArray(body.students) || !body.students.length || body.students.length > 100) {
      return Response.json({ error: "1명 이상 100명 이하의 명단을 확인해 주세요." }, { status: 400 });
    }
    const parsed = body.students.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const number = Number(row.number);
      const name = typeof row.name === "string" ? row.name.trim().slice(0, 100) : "";
      return Number.isInteger(number) && number > 0 && name ? [{ number, name }] : [];
    });
    if (parsed.length !== body.students.length || new Set(parsed.map((row) => row.number)).size !== parsed.length) {
      return Response.json({ error: "번호·이름 누락 또는 중복 번호가 있습니다." }, { status: 400 });
    }
    const { user, classId } = await getDataScope();
    const now = new Date().toISOString();
    const students = await upsertRows<{ id: number; number: number; name: string }>("students", parsed.map((row) => ({
      ...row,
      active: true,
      created_at: now,
      owner_email: user.email,
      owner_id: user.id,
      class_id: classId,
    })), "class_id,number");
    return Response.json({ students: students.sort((a, b) => a.number - b.number) });
  } catch (error) {
    return dataError(error, "학생 명단을 저장하지 못했습니다.");
  }
}
