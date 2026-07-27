import { eq, selectRows, supabaseRequest, updateRows, upsertRows } from "../../../db/supabase";
import { dataError, getDataScope } from "../../data-scope";
import { snapshotAssessmentPlan } from "../../assessment-plan-versions";

type PlanInput = {
  id?: unknown;
  subject?: unknown;
  unit?: unknown;
  goal?: unknown;
  domain?: unknown;
  type?: unknown;
  perspective?: unknown;
  high?: unknown;
  middle?: unknown;
  low?: unknown;
  caution?: unknown;
  sortOrder?: unknown;
  confirmAffected?: unknown;
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const fields = (item: PlanInput) => ({
  subject: text(item.subject),
  unit: text(item.unit),
  goal: text(item.goal),
  domain: text(item.domain),
  assessment_type: text(item.type),
  perspective: text(item.perspective),
  high: text(item.high),
  middle: text(item.middle),
  low: text(item.low),
  caution: text(item.caution),
});
const validate = (item: PlanInput) => {
  const row = fields(item);
  const required = [row.subject, row.unit, row.goal, row.domain, row.perspective, row.high, row.middle, row.low];
  if (required.some((value) => !value)) return "과목, 단원, 평가목표, 영역, 평가관점, 상·중·하 기준은 필수입니다.";
  if (new Set([row.high, row.middle, row.low]).size < 3) return "상·중·하 평가 기준은 서로 달라야 합니다.";
  return "";
};
const present = (row: Record<string, unknown>) => ({
  id: Number(row.id),
  subject: row.subject,
  unit: row.unit,
  goal: row.goal,
  domain: row.domain,
  type: row.assessment_type,
  perspective: row.perspective,
  high: row.high,
  middle: row.middle,
  low: row.low,
  caution: row.caution,
  sortOrder: Number(row.sort_order),
});

export async function GET() {
  try {
    const { user, classId } = await getDataScope();
    const rows = await selectRows<Record<string, unknown>>("assessment_plans", {
      owner_id: eq(user.id), class_id: eq(classId), order: "sort_order.asc",
    });
    return Response.json({ plan: rows.map(present) });
  } catch (error) {
    return dataError(error, "평가계획을 불러오지 못했습니다.");
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { plan?: unknown };
    if (!Array.isArray(body.plan) || !body.plan.length || body.plan.length > 200) {
      return Response.json({ error: "저장할 평가계획은 1~200개여야 합니다." }, { status: 400 });
    }
    const errors = body.plan.map((item: PlanInput, index) => validate(item) ? `${index + 1}행: ${validate(item)}` : "").filter(Boolean);
    const keys = body.plan.map((item: PlanInput) => {
      const row = fields(item);
      return `${row.subject}|${row.unit}|${row.goal}`;
    });
    if (new Set(keys).size !== keys.length) errors.push("과목·단원·평가목표가 같은 중복 행이 있습니다.");
    if (errors.length) return Response.json({ error: errors.slice(0, 6).join(" ") }, { status: 400 });

    const { user, classId } = await getDataScope();
    const existing = await selectRows<{ sort_order: number }>("assessment_plans", {
      owner_id: eq(user.id), class_id: eq(classId), order: "sort_order.desc", limit: 1,
    });
    const start = Number(existing[0]?.sort_order ?? -1) + 1;
    const rows = await upsertRows<Record<string, unknown>>("assessment_plans", body.plan.map((item: PlanInput, index) => ({
      ...fields(item),
      sort_order: Number.isInteger(Number(item.sortOrder)) ? Number(item.sortOrder) : start + index,
      owner_email: user.email,
      owner_id: user.id,
      class_id: classId,
    })), "class_id,subject,unit,goal");
    await snapshotAssessmentPlan({
      ownerId: user.id, ownerEmail: user.email, classId, source: "save",
      label: `${rows.length}개 평가계획 저장`,
    });
    return Response.json({ plan: rows.map(present) });
  } catch (error) {
    return dataError(error, "평가계획을 저장하지 못했습니다.");
  }
}

export async function PATCH(request: Request) {
  try {
    const item = await request.json() as PlanInput;
    const id = Number(item.id);
    if (!Number.isInteger(id)) return Response.json({ error: "수정할 평가계획을 찾을 수 없습니다." }, { status: 400 });
    const error = validate(item);
    if (error) return Response.json({ error }, { status: 400 });
    const { user, classId } = await getDataScope();
    const target = (await selectRows<{ subject: string; unit: string }>("assessment_plans", {
      id: eq(id), owner_id: eq(user.id), class_id: eq(classId), limit: 1,
    }))[0];
    if (!target) return Response.json({ error: "수정 권한이 없거나 평가계획이 없습니다." }, { status: 404 });
    const levels = await selectRows<{ id: number }>("assessment_levels", {
      owner_id: eq(user.id), class_id: eq(classId), subject: eq(target.subject), limit: 1,
    });
    if (levels.length) {
      if (text(item.subject) !== target.subject) {
        return Response.json({
          error: "학생 평가수준이 입력된 과목명은 변경할 수 없습니다. 새 과목 평가계획으로 다시 등록해 주세요.",
        }, { status: 409 });
      }
      if (item.confirmAffected !== true) {
        return Response.json({
          error: `${target.subject}에 학생 평가수준이 입력되어 있습니다. 평가 기준을 수정하면 이후 생성되는 평어의 근거가 달라질 수 있습니다.`,
          requiresConfirmation: true,
        }, { status: 409 });
      }
    }
    const rows = await updateRows<Record<string, unknown>>("assessment_plans", {
      id: eq(id), owner_id: eq(user.id), class_id: eq(classId),
    }, fields(item));
    if (!rows.length) return Response.json({ error: "수정 권한이 없거나 평가계획이 없습니다." }, { status: 404 });
    await snapshotAssessmentPlan({
      ownerId: user.id, ownerEmail: user.email, classId, source: "edit",
      label: `${String(rows[0].subject)} ${String(rows[0].unit)} 수정`,
    });
    return Response.json({ item: present(rows[0]) });
  } catch (error) {
    return dataError(error, "평가계획을 수정하지 못했습니다.");
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { scope?: unknown; confirmation?: unknown };
    if (body.scope === "all") {
      if (body.confirmation !== "평가계획삭제") {
        return Response.json({ error: "확인 문구가 올바르지 않습니다." }, { status: 400 });
      }
      const { user, classId } = await getDataScope();
      const current = await selectRows<{ id: number }>("assessment_plans", {
        owner_id: eq(user.id), class_id: eq(classId),
      });
      if (!current.length) return Response.json({ error: "삭제할 평가계획이 없습니다." }, { status: 404 });
      await snapshotAssessmentPlan({
        ownerId: user.id, ownerEmail: user.email, classId, source: "before-clear",
        label: `전체 삭제 전 평가계획 ${current.length}개`,
      });
      await supabaseRequest("assessment_levels", {
        method: "DELETE", query: { owner_id: eq(user.id), class_id: eq(classId) },
      });
      await supabaseRequest("generated_comments", {
        method: "DELETE", query: { owner_id: eq(user.id), class_id: eq(classId) },
      });
      await supabaseRequest("generated_comment_parts", {
        method: "DELETE", query: { owner_id: eq(user.id), class_id: eq(classId) },
      });
      await supabaseRequest("record_revisions", {
        method: "DELETE", query: { owner_id: eq(user.id), class_id: eq(classId), record_type: eq("comment") },
      });
      await supabaseRequest("generation_jobs", {
        method: "DELETE", query: { owner_id: eq(user.id), class_id: eq(classId), job_type: eq("comments") },
      });
      await supabaseRequest("assessment_plans", {
        method: "DELETE", query: { owner_id: eq(user.id), class_id: eq(classId) },
      });
      return Response.json({
        ok: true,
        deleted: current.length,
        sharedPlansPreserved: true,
        versionPreserved: true,
      });
    }
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "삭제할 평가계획을 찾을 수 없습니다." }, { status: 400 });
    const { user, classId } = await getDataScope();
    const target = (await selectRows<{ subject: string }>("assessment_plans", {
      id: eq(id), owner_id: eq(user.id), class_id: eq(classId), limit: 1,
    }))[0];
    if (!target) return Response.json({ error: "삭제 권한이 없거나 평가계획이 없습니다." }, { status: 404 });
    const levels = await selectRows<{ id: number }>("assessment_levels", {
      owner_id: eq(user.id), class_id: eq(classId), subject: eq(target.subject), limit: 1,
    });
    if (levels.length) {
      return Response.json({ error: "이미 평가수준이 입력된 과목입니다. 평가계획은 수정만 가능합니다." }, { status: 409 });
    }
    await supabaseRequest("assessment_plans", {
      method: "DELETE", query: { id: eq(id), owner_id: eq(user.id), class_id: eq(classId) },
    });
    await snapshotAssessmentPlan({
      ownerId: user.id, ownerEmail: user.email, classId, source: "delete",
      label: `${target.subject} 평가계획 삭제`,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return dataError(error, "평가계획을 삭제하지 못했습니다.");
  }
}
