import { waitUntil } from "@vercel/functions";
import { eq, insertRows, selectRows } from "../../../db/supabase";
import { getAiUsage, MONTHLY_AI_LIMIT } from "../../ai-usage";
import { batchBehaviors } from "../../behavior-batching";
import { BehaviorInput, BehaviorOptions } from "../../behavior-generation";
import { createBehaviorVariations } from "../../behavior-variation";
import { signCommentJob } from "../../comment-generation";
import { dataError, getDataScope, requireOwnedStudentIds } from "../../data-scope";
import { validateBehaviorSource } from "../../record-validation";

type JobRow = {
  id: string; status: string; current_batch: number; total_batches: number; total_items: number;
  completed_items: number; failed_items: number; error_message: string; created_at: string; completed_at: string | null;
};
const present = (row: JobRow) => ({
  id: row.id, status: row.status, currentBatch: Number(row.current_batch), totalBatches: Number(row.total_batches),
  totalItems: Number(row.total_items), completedItems: Number(row.completed_items), failedItems: Number(row.failed_items),
  error: row.error_message, createdAt: row.created_at, completedAt: row.completed_at,
});
function startRunner(request: Request, jobId: string) {
  waitUntil(fetch(new URL("/api/behavior-jobs/run", request.url), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, signature: signCommentJob(jobId) }),
  }).catch(() => undefined));
}

export async function GET(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    const rows = await selectRows<JobRow>("generation_jobs", {
      owner_id: eq(user.id), class_id: eq(classId), job_type: eq("behaviors"), order: "created_at.desc", limit: 1,
    });
    if (rows[0] && ["queued", "running"].includes(rows[0].status)) startRunner(request, rows[0].id);
    return Response.json({ job: rows[0] ? present(rows[0]) : null });
  } catch (error) {
    return dataError(error, "행동특성 생성 상태를 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { students?: unknown; options?: unknown };
    if (!Array.isArray(body.students)) return Response.json({ error: "학생 특성을 다시 확인해 주세요." }, { status: 400 });
    const options: BehaviorOptions = {
      sentenceCount: 0,
      maxBytes: 550,
      emphasis: "balanced",
    };
    const inputs: BehaviorInput[] = body.students.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const studentId = Number(row.studentId);
      const characteristic = typeof row.characteristic === "string" ? row.characteristic.trim().slice(0, 4000) : "";
      return Number.isInteger(studentId) && characteristic ? [{ studentId, characteristic, options }] : [];
    });
    if (!inputs.length) return Response.json({ error: "한 명 이상의 특성을 입력해 주세요." }, { status: 400 });
    const blocked = inputs.flatMap((item) => {
      const validation = validateBehaviorSource(item.characteristic);
      return validation.valid ? [] : [{ studentId: item.studentId, issues: [...validation.forbidden, ...validation.sensitive] }];
    });
    if (blocked.length) return Response.json({
      error: `${blocked.length}명의 관찰 사실에 금지 내용 또는 개인정보가 있어 AI 생성을 시작하지 않았습니다.`,
      blocked,
    }, { status: 400 });
    const variations = createBehaviorVariations(inputs.length);
    inputs.forEach((item, index) => { item.variation = variations[index]; });
    const { user, classId } = await getDataScope();
    await requireOwnedStudentIds(inputs.map((item) => item.studentId), user.id, classId);
    const active = await selectRows<JobRow>("generation_jobs", {
      owner_id: eq(user.id), class_id: eq(classId), job_type: eq("behaviors"), status: "in.(queued,running)", limit: 1,
    });
    if (active[0]) {
      startRunner(request, active[0].id);
      return Response.json({ job: present(active[0]), alreadyRunning: true }, { status: 202 });
    }
    const batches = batchBehaviors(inputs);
    const usage = await getAiUsage(user.id);
    if (MONTHLY_AI_LIMIT !== null && usage.monthly + batches.length > MONTHLY_AI_LIMIT) {
      return Response.json({ error: `이번 작업에는 AI 요청 ${batches.length}회가 필요하지만 이번 달 잔여 한도는 ${Math.max(0, MONTHLY_AI_LIMIT - usage.monthly)}회입니다.` }, { status: 429 });
    }
    const rows = await insertRows<JobRow>("generation_jobs", [{
      owner_id: user.id, owner_email: user.email, class_id: classId, job_type: "behaviors", status: "queued",
      batches, current_batch: 0, total_batches: batches.length, total_items: inputs.length,
      completed_items: 0, failed_items: 0, error_message: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }]);
    startRunner(request, rows[0].id);
    return Response.json({ job: present(rows[0]) }, { status: 202 });
  } catch (error) {
    return dataError(error, "행동특성 백그라운드 작업을 시작하지 못했습니다.");
  }
}
