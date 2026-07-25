import { NextResponse } from "next/server";
import { eq, selectRows, supabaseRequest } from "../../../db/supabase";
import { dataError, getDataScope } from "../../data-scope";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../supabase-auth";

const classTables = ["assessment_levels", "generated_comments", "student_behaviors", "record_revisions", "generation_jobs", "assessment_plans", "students", "ai_usage_events"] as const;

export async function GET() {
  try {
    const { user, classId, classroom } = await getDataScope();
    const [students, plans, levels, comments, behaviors] = await Promise.all([
      selectRows<{ id: number }>("students", { owner_id: eq(user.id), class_id: eq(classId), active: eq(true) }),
      selectRows<{ id: number }>("assessment_plans", { owner_id: eq(user.id), class_id: eq(classId) }),
      selectRows<{ id: number }>("assessment_levels", { owner_id: eq(user.id), class_id: eq(classId) }),
      selectRows<{ id: number }>("generated_comments", { owner_id: eq(user.id), class_id: eq(classId) }),
      selectRows<{ id: number }>("student_behaviors", { owner_id: eq(user.id), class_id: eq(classId) }),
    ]);
    return Response.json({
      account: { email: user.email, displayName: user.displayName },
      classroom: {
        schoolName: classroom.school_name,
        schoolYear: classroom.school_year,
        semester: classroom.semester,
        grade: classroom.grade,
        classNumber: classroom.class_number,
      },
      counts: {
        students: students.length,
        plans: plans.length,
        levels: levels.length,
        comments: comments.length,
        behaviors: behaviors.length,
      },
    });
  } catch (error) {
    return dataError(error, "개인정보 저장 현황을 불러오지 못했습니다.");
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { scope?: unknown; confirmation?: unknown };
    const scope = body.scope === "account" ? "account" : body.scope === "class" ? "class" : "";
    const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : "";
    if (!scope) return Response.json({ error: "삭제 범위를 확인해 주세요." }, { status: 400 });
    if (scope === "class" && confirmation !== "학급자료삭제") {
      return Response.json({ error: "확인 문구가 일치하지 않습니다." }, { status: 400 });
    }
    if (scope === "account" && confirmation !== "계정탈퇴") {
      return Response.json({ error: "확인 문구가 일치하지 않습니다." }, { status: 400 });
    }

    const { user, classId } = await getDataScope();
    if (scope === "class") {
      for (const table of classTables) {
        await supabaseRequest(table, {
          method: "DELETE",
          query: { owner_id: eq(user.id), class_id: eq(classId) },
        });
      }
      await supabaseRequest("classrooms", {
        method: "DELETE",
        query: { id: eq(classId), owner_id: eq(user.id) },
      });
      return Response.json({ ok: true, scope });
    }

    const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) throw new Error("Supabase server configuration is missing");
    const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!response.ok) throw new Error(`Supabase auth deletion failed: ${response.status}`);
    const result = NextResponse.json({ ok: true, scope });
    result.cookies.delete(ACCESS_COOKIE);
    result.cookies.delete(REFRESH_COOKIE);
    return result;
  } catch (error) {
    return dataError(error, "데이터를 삭제하지 못했습니다.");
  }
}
