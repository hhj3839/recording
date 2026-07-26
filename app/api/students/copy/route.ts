import { eq, insertRows, selectRows } from "../../../../db/supabase";
import { dataError, getDataScope } from "../../../data-scope";

type StudentRow = { number: number; name: string; active: boolean };

export async function POST(request: Request) {
  try {
    const { user, classId: sourceClassId } = await getDataScope();
    const body = await request.json() as { targetClassId?: unknown };
    const targetClassId = Number(body.targetClassId);
    if (!Number.isInteger(targetClassId) || targetClassId === sourceClassId) {
      return Response.json({ error: "현재 학급과 다른 대상 학급을 선택해 주세요." }, { status: 400 });
    }
    const target = (await selectRows<{ id: number }>("classrooms", {
      id: eq(targetClassId), owner_id: eq(user.id), limit: 1,
    }))[0];
    if (!target) return Response.json({ error: "명단을 복사할 수 없는 학급입니다." }, { status: 403 });

    const [sourceStudents, targetStudents] = await Promise.all([
      selectRows<StudentRow>("students", { owner_id: eq(user.id), class_id: eq(sourceClassId), active: eq(true), order: "number.asc" }),
      selectRows<StudentRow>("students", { owner_id: eq(user.id), class_id: eq(targetClassId) }),
    ]);
    if (!sourceStudents.length) return Response.json({ error: "현재 학급에 복사할 재학생이 없습니다." }, { status: 400 });
    const targetNumbers = new Set(targetStudents.map((student) => Number(student.number)));
    const targetNames = new Set(targetStudents.map((student) => student.name.replace(/\s+/g, "").toLowerCase()));
    const copied = sourceStudents.filter((student) =>
      !targetNumbers.has(Number(student.number)) &&
      !targetNames.has(student.name.replace(/\s+/g, "").toLowerCase()),
    );
    const now = new Date().toISOString();
    if (copied.length) {
      await insertRows("students", copied.map((student) => ({
        number: Number(student.number),
        name: student.name,
        active: true,
        created_at: now,
        owner_email: user.email,
        owner_id: user.id,
        class_id: targetClassId,
      })));
    }
    return Response.json({ copied: copied.length, skipped: sourceStudents.length - copied.length, total: sourceStudents.length });
  } catch (error) {
    return dataError(error, "학생 명단을 다른 학급에 복사하지 못했습니다.");
  }
}
