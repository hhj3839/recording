import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { assessmentPlans } from "../../../db/schema";

export async function GET() {
  try {
    const db = await getDb();
    const rows = await db.select().from(assessmentPlans).orderBy(asc(assessmentPlans.sortOrder));
    return Response.json({
      plan: rows.map((row) => ({
        subject: row.subject,
        unit: row.unit,
        goal: row.goal,
        domain: row.domain,
        type: row.assessmentType,
        perspective: row.perspective,
        high: row.high,
        middle: row.middle,
        low: row.low,
        caution: row.caution,
      })),
    });
  } catch (error) {
    console.error("Assessment plan load failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "평가계획을 불러오지 못했습니다." }, { status: 500 });
  }
}
