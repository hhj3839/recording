import { eq, selectRows } from "../../../db/supabase";
import { dataError, getDataScope } from "../../data-scope";

export async function GET() {
  try {
    const { user, classId } = await getDataScope();
    const rows = await selectRows<Record<string, string | number>>("assessment_plans", {
      owner_email: eq(user.email), class_id: eq(classId), order: "sort_order.asc",
    });
    return Response.json({
      plan: rows.map((row) => ({
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
      })),
    });
  } catch (error) {
    return dataError(error, "평가계획을 불러오지 못했습니다.");
  }
}
