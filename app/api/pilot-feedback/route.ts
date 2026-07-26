import { eq, insertRows, selectRows } from "../../../db/supabase";
import { dataError, getDataScope } from "../../data-scope";

type FeedbackRow = {
  owner_id: string; before_minutes: number; actual_minutes: number; usable_percent: number;
  satisfaction: number; reuse_intent: boolean; feedback: string; submitted_at: string;
};

function aggregate(rows: FeedbackRow[]) {
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const timeReduction = average(rows.map((row) => Math.max(0, (Number(row.before_minutes) - Number(row.actual_minutes)) / Number(row.before_minutes) * 100)));
  const usablePercent = average(rows.map((row) => Number(row.usable_percent)));
  const satisfaction = average(rows.map((row) => Number(row.satisfaction)));
  const reusePercent = rows.length ? rows.filter((row) => row.reuse_intent).length / rows.length * 100 : 0;
  return {
    participants: new Set(rows.map((row) => row.owner_id)).size,
    responses: rows.length,
    timeReduction: Math.round(timeReduction * 10) / 10,
    usablePercent: Math.round(usablePercent * 10) / 10,
    satisfaction: Math.round(satisfaction * 10) / 10,
    reusePercent: Math.round(reusePercent * 10) / 10,
    targets: { timeReduction: timeReduction >= 50, usablePercent: usablePercent >= 80, satisfaction: satisfaction >= 4, reusePercent: reusePercent >= 70 },
  };
}

export async function GET() {
  try {
    const { user, classId } = await getDataScope();
    const [mine, all] = await Promise.all([
      selectRows<FeedbackRow>("pilot_feedback", { owner_id: eq(user.id), class_id: eq(classId), order: "submitted_at.desc", limit: 1 }),
      selectRows<FeedbackRow>("pilot_feedback", { order: "submitted_at.desc" }),
    ]);
    return Response.json({
      latest: mine[0] ? {
        beforeMinutes: Number(mine[0].before_minutes), actualMinutes: Number(mine[0].actual_minutes),
        usablePercent: Number(mine[0].usable_percent), satisfaction: Number(mine[0].satisfaction),
        reuseIntent: Boolean(mine[0].reuse_intent), feedback: mine[0].feedback, submittedAt: mine[0].submitted_at,
      } : null,
      aggregate: aggregate(all),
    });
  } catch (error) {
    return dataError(error, "파일럿 측정 결과를 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const beforeMinutes = Number(body.beforeMinutes);
    const actualMinutes = Number(body.actualMinutes);
    const usablePercent = Number(body.usablePercent);
    const satisfaction = Number(body.satisfaction);
    const reuseIntent = body.reuseIntent === true;
    const feedback = typeof body.feedback === "string" ? body.feedback.trim().slice(0, 2000) : "";
    if (!Number.isInteger(beforeMinutes) || beforeMinutes < 1 || beforeMinutes > 3000 ||
        !Number.isInteger(actualMinutes) || actualMinutes < 1 || actualMinutes > 3000 ||
        !Number.isInteger(usablePercent) || usablePercent < 0 || usablePercent > 100 ||
        !Number.isInteger(satisfaction) || satisfaction < 1 || satisfaction > 5 ||
        typeof body.reuseIntent !== "boolean") {
      return Response.json({ error: "파일럿 측정값을 다시 확인해 주세요." }, { status: 400 });
    }
    const { user, classId } = await getDataScope();
    await insertRows("pilot_feedback", [{
      owner_id: user.id, owner_email: user.email, class_id: classId,
      before_minutes: beforeMinutes, actual_minutes: actualMinutes, usable_percent: usablePercent,
      satisfaction, reuse_intent: reuseIntent, feedback, submitted_at: new Date().toISOString(),
    }]);
    const all = await selectRows<FeedbackRow>("pilot_feedback", { order: "submitted_at.desc" });
    return Response.json({ ok: true, aggregate: aggregate(all) });
  } catch (error) {
    return dataError(error, "파일럿 결과를 저장하지 못했습니다.");
  }
}
