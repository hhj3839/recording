import { and, asc, eq } from "drizzle-orm";
import { assessmentPlans } from "../../../db/schema";
import { dataError, getDataScope } from "../../data-scope";

export async function GET() {
  try {
    const { db, user, classId } = await getDataScope();
    const rows = await db.select().from(assessmentPlans).where(and(eq(assessmentPlans.ownerEmail, user.email), eq(assessmentPlans.classId, classId))).orderBy(asc(assessmentPlans.sortOrder));
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
    return dataError(error, "평가계획을 불러오지 못했습니다.");
  }
}
