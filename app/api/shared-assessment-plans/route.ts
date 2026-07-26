import { eq, insertRows, selectRows, supabaseRequest, upsertRows } from "../../../db/supabase";
import { snapshotAssessmentPlan } from "../../assessment-plan-versions";
import { dataError } from "../../data-scope";
import { schoolWorkspaceContext } from "../../school-workspace";

type SharedPlan = {
  id: number; organization_id: string; name: string; school_year: number; semester: number; grade: number;
  plan: Array<Record<string, unknown>>; item_count: number; created_by: string; created_by_email: string; updated_at: string;
};
const present = (row: SharedPlan) => ({
  id: Number(row.id), name: row.name, schoolYear: Number(row.school_year), semester: Number(row.semester),
  grade: Number(row.grade), itemCount: Number(row.item_count), createdByEmail: row.created_by_email,
  updatedAt: row.updated_at, canDelete: false,
});

export async function GET() {
  try {
    const { user, membership, organization } = await schoolWorkspaceContext();
    const rows = await selectRows<SharedPlan>("shared_assessment_plans", {
      organization_id: eq(organization.id), order: "school_year.desc,semester.desc,grade.asc,updated_at.desc",
    });
    return Response.json({ plans: rows.map((row) => ({ ...present(row), canDelete: membership.role === "admin" || row.created_by === user.id })) });
  } catch (error) {
    return dataError(error, "공동 평가계획을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    const { user, classroom, classId, organization } = await schoolWorkspaceContext();
    const body = await request.json().catch(() => ({}));
    const name = String(body.name ?? "").trim().slice(0, 80);
    if (name.length < 2) return Response.json({ error: "공유 계획 이름을 2자 이상 입력해 주세요." }, { status: 400 });
    const plan = await selectRows<Record<string, unknown>>("assessment_plans", {
      owner_id: eq(user.id), class_id: eq(classId), order: "sort_order.asc",
    });
    if (!plan.length) return Response.json({ error: "공유할 현재 학급 평가계획이 없습니다." }, { status: 400 });
    const sanitized = plan.map((row) => ({
      subject: row.subject, unit: row.unit, goal: row.goal, domain: row.domain, assessment_type: row.assessment_type,
      perspective: row.perspective, high: row.high, middle: row.middle, low: row.low, caution: row.caution, sort_order: row.sort_order,
    }));
    const rows = await upsertRows<SharedPlan>("shared_assessment_plans", [{
      organization_id: organization.id, name, school_year: classroom.school_year, semester: classroom.semester,
      grade: classroom.grade, plan: sanitized, item_count: sanitized.length, created_by: user.id,
      created_by_email: user.email, updated_at: new Date().toISOString(),
    }], "organization_id,school_year,semester,grade,name");
    return Response.json({ plan: { ...present(rows[0]), canDelete: true } });
  } catch (error) {
    return dataError(error, "평가계획을 학교 작업공간에 공유하지 못했습니다.");
  }
}

export async function PUT(request: Request) {
  try {
    const { user, classId, organization } = await schoolWorkspaceContext();
    const body = await request.json().catch(() => ({}));
    const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "가져올 공동 평가계획을 확인해 주세요." }, { status: 400 });
    const shared = (await selectRows<SharedPlan>("shared_assessment_plans", { id: eq(id), organization_id: eq(organization.id), limit: 1 }))[0];
    if (!shared) return Response.json({ error: "접근할 수 없는 공동 평가계획입니다." }, { status: 403 });
    const levels = await selectRows<{ id: number }>("assessment_levels", { owner_id: eq(user.id), class_id: eq(classId), limit: 1 });
    if (levels.length) return Response.json({ error: "현재 학급에 평가수준이 입력되어 있어 공동 계획으로 교체할 수 없습니다." }, { status: 409 });
    await snapshotAssessmentPlan({ ownerId: user.id, ownerEmail: user.email, classId, source: "shared-import", label: `공동 계획 ‘${shared.name}’ 가져오기 전` });
    await supabaseRequest("assessment_plans", { method: "DELETE", query: { owner_id: eq(user.id), class_id: eq(classId) } });
    const rows = await insertRows<Record<string, unknown>>("assessment_plans", shared.plan.map((item, index) => ({
      ...item, sort_order: Number(item.sort_order ?? index), owner_id: user.id, owner_email: user.email, class_id: classId,
    })));
    await snapshotAssessmentPlan({ ownerId: user.id, ownerEmail: user.email, classId, source: "shared-import", label: `공동 계획 ‘${shared.name}’ 적용` });
    return Response.json({ ok: true, imported: rows.length });
  } catch (error) {
    return dataError(error, "공동 평가계획을 현재 학급에 적용하지 못했습니다.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { user, membership, organization } = await schoolWorkspaceContext();
    const body = await request.json().catch(() => ({}));
    const id = Number(body.id);
    const shared = (await selectRows<SharedPlan>("shared_assessment_plans", { id: eq(id), organization_id: eq(organization.id), limit: 1 }))[0];
    if (!shared || (membership.role !== "admin" && shared.created_by !== user.id)) {
      return Response.json({ error: "공동 평가계획 삭제 권한이 없습니다." }, { status: 403 });
    }
    await supabaseRequest("shared_assessment_plans", { method: "DELETE", query: { id: eq(id), organization_id: eq(organization.id) } });
    return Response.json({ ok: true });
  } catch (error) {
    return dataError(error, "공동 평가계획을 삭제하지 못했습니다.");
  }
}
