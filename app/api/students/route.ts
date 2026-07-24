import { eq, insertRows, updateRows } from "../../../db/supabase";
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
      name, number, active: true, created_at: now, owner_email: user.email, class_id: classId,
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
    await updateRows("students", { id: eq(id), owner_email: eq(user.email), class_id: eq(classId) }, { active: false });
    return Response.json({ ok: true });
  } catch (error) {
    return dataError(error, "학생을 삭제하지 못했습니다.");
  }
}
