import { eq, selectRows, upsertRows } from "../../../../db/supabase";
import { dataError, getDataScope } from "../../../data-scope";

type ClassroomRow = {
  id: number;
  owner_id: string;
  school_name: string;
  school_year: number;
  semester: number;
  grade: number;
  class_number: number;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as { targetClassId?: unknown };
    const targetClassId = Number(body.targetClassId);
    if (!Number.isInteger(targetClassId)) return Response.json({ error: "대상 학급을 선택해 주세요." }, { status: 400 });
    const { user, classId } = await getDataScope();
    if (targetClassId === classId) return Response.json({ error: "현재 학급이 아닌 다른 학급을 선택해 주세요." }, { status: 400 });
    const target = (await selectRows<ClassroomRow>("classrooms", {
      id: eq(targetClassId), owner_id: eq(user.id), limit: 1,
    }))[0];
    if (!target) return Response.json({ error: "복사할 수 없는 학급입니다." }, { status: 403 });
    const source = await selectRows<Record<string, string | number>>("assessment_plans", {
      owner_id: eq(user.id), class_id: eq(classId), order: "sort_order.asc",
    });
    if (!source.length) return Response.json({ error: "현재 학급에 복사할 평가계획이 없습니다." }, { status: 400 });
    const existingLevels = await selectRows<{ id: number }>("assessment_levels", {
      owner_id: eq(user.id), class_id: eq(targetClassId), limit: 1,
    });
    if (existingLevels.length) {
      return Response.json({ error: "대상 학급에 이미 평가수준이 입력되어 있어 평가계획을 복사할 수 없습니다." }, { status: 409 });
    }
    await upsertRows("assessment_plans", source.map((row) => ({
      subject: row.subject,
      unit: row.unit,
      goal: row.goal,
      domain: row.domain,
      assessment_type: row.assessment_type,
      perspective: row.perspective,
      high: row.high,
      middle: row.middle,
      low: row.low,
      caution: row.caution,
      sort_order: row.sort_order,
      owner_email: user.email,
      owner_id: user.id,
      class_id: targetClassId,
    })), "class_id,subject,unit,goal");
    return Response.json({
      ok: true,
      copied: source.length,
      target: {
        id: Number(target.id),
        schoolName: target.school_name,
        schoolYear: Number(target.school_year),
        semester: Number(target.semester),
        grade: Number(target.grade),
        classNumber: Number(target.class_number),
      },
    });
  } catch (error) {
    return dataError(error, "평가계획을 다른 학급에 복사하지 못했습니다.");
  }
}
