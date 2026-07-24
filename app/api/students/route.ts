import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { students } from "../../../db/schema";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: unknown; number?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 50) : "";
    const number = Number(body.number);
    if (!name || !Number.isInteger(number) || number < 1) return Response.json({ error: "학생 정보를 확인해 주세요." }, { status: 400 });
    const db = await getDb();
    const now = new Date().toISOString();
    const [student] = await db.insert(students).values({ name, number, active: true, createdAt: now }).returning();
    return Response.json({ student: { id: student.id, number: student.number, name: student.name } });
  } catch (error) {
    console.error("Student add failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "학생을 추가하지 못했습니다." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "학생 정보를 확인해 주세요." }, { status: 400 });
    const db = await getDb();
    await db.update(students).set({ active: false }).where(eq(students.id, id));
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Student delete failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "학생을 삭제하지 못했습니다." }, { status: 500 });
  }
}

