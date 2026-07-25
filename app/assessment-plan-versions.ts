import { eq, insertRows, selectRows } from "../db/supabase";

type PlanRow = {
  subject: string;
  unit: string;
  goal: string;
  domain: string;
  assessment_type: string;
  perspective: string;
  high: string;
  middle: string;
  low: string;
  caution: string;
  sort_order: number;
};

export async function snapshotAssessmentPlan(input: {
  ownerId: string;
  ownerEmail: string;
  classId: number;
  source: string;
  label: string;
}) {
  const rows = await selectRows<PlanRow>("assessment_plans", {
    owner_id: eq(input.ownerId), class_id: eq(input.classId), order: "sort_order.asc",
  });
  const plan = rows.map((row) => ({
    subject: row.subject, unit: row.unit, goal: row.goal, domain: row.domain,
    assessment_type: row.assessment_type, perspective: row.perspective,
    high: row.high, middle: row.middle, low: row.low, caution: row.caution,
    sort_order: Number(row.sort_order),
  }));
  const latest = (await selectRows<{ plan: unknown }>("assessment_plan_versions", {
    owner_id: eq(input.ownerId), class_id: eq(input.classId), order: "created_at.desc", limit: 1,
  }))[0];
  if (latest && JSON.stringify(latest.plan) === JSON.stringify(plan)) return;
  await insertRows("assessment_plan_versions", [{
    owner_id: input.ownerId,
    owner_email: input.ownerEmail,
    class_id: input.classId,
    source: input.source,
    label: input.label,
    plan,
    item_count: plan.length,
    created_at: new Date().toISOString(),
  }]);
}
