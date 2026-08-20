import { waitUntil } from "@vercel/functions";
import { eq, insertRows, selectRows, supabaseRequest } from "../../../db/supabase";
import { batchCommentsByAssessmentArea } from "../../comment-batching";
import { CommentEvidence, signCommentJob } from "../../comment-generation";
import { createCommentVariations } from "../../comment-variation";
import { buildCommentPoolSpecs, type PoolPlanItem } from "../../comment-pool-library";
import { dataError, getDataScope, requireOwnedStudentIds } from "../../data-scope";

type Level = "상" | "중" | "하" | "미응시" | "평가 예정" | "-";
type ScoreStudent = { studentId: number; levels: Level[] };
type JobRow = {
  id: string;
  status: string;
  current_batch: number;
  total_batches: number;
  total_items: number;
  completed_items: number;
  failed_items: number;
  error_message: string;
  batches: CommentEvidence[][];
  created_at: string;
  completed_at: string | null;
};

const present = (row: JobRow) => ({
  id: row.id,
  status: row.status,
  currentBatch: Number(row.current_batch),
  totalBatches: Number(row.total_batches),
  totalItems: Number(row.total_items),
  completedItems: Number(row.completed_items),
  failedItems: Number(row.failed_items),
  error: row.error_message,
  createdAt: row.created_at,
  completedAt: row.completed_at,
  subject: row.batches?.[0]?.[0]?.subject ?? "",
});

function startRunner(request: Request, jobId: string) {
  const url = new URL("/api/comment-jobs/run", request.url);
  const signature = signCommentJob(jobId);
  waitUntil(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, signature }),
    }).catch(() => undefined),
  );
}

export async function GET(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    const jobs = await selectRows<JobRow>("generation_jobs", {
      owner_id: eq(user.id),
      class_id: eq(classId),
      job_type: eq("comments"),
      order: "created_at.desc",
      limit: 1,
    });
    if (jobs[0] && ["queued", "running"].includes(jobs[0].status)) startRunner(request, jobs[0].id);
    return Response.json({ job: jobs[0] ? present(jobs[0]) : null });
  } catch (error) {
    return dataError(error, "교과 평어 생성 상태를 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      scores?: unknown;
      selectedStudentIds?: unknown;
      overwriteExisting?: unknown;
      targetAssessmentIndexes?: unknown;
      forceTargetRegeneration?: unknown;
    };
    if (!body.scores || typeof body.scores !== "object" || Array.isArray(body.scores)) {
      return Response.json({ error: "평가 수준을 다시 확인해 주세요." }, { status: 400 });
    }
    const { user, classId } = await getDataScope();
    const selectedStudentIds = Array.isArray(body.selectedStudentIds)
      ? [...new Set(body.selectedStudentIds.map(Number).filter(Number.isInteger))]
      : [];
    if (!selectedStudentIds.length) return Response.json({ error: "생성할 학생을 한 명 이상 선택해 주세요." }, { status: 400 });
    await requireOwnedStudentIds(selectedStudentIds, user.id, classId);
    const active = await selectRows<JobRow>("generation_jobs", {
      owner_id: eq(user.id),
      class_id: eq(classId),
      job_type: eq("comments"),
      status: "in.(queued,running)",
      limit: 1,
    });
    if (active[0]) {
      startRunner(request, active[0].id);
      return Response.json({ job: present(active[0]), alreadyRunning: true }, { status: 202 });
    }
    const planRows = await selectRows<PoolPlanItem & Record<string, string | number>>("assessment_plans", {
      owner_id: eq(user.id), class_id: eq(classId), order: "sort_order.asc",
    });
    const plan = planRows.map((row) => ({
      id: Number(row.id),
      subject: String(row.subject), unit: String(row.unit), goal: String(row.goal), domain: String(row.domain),
      perspective: String(row.perspective), high: String(row.high), middle: String(row.middle), low: String(row.low),
    }));
    const poolSpecs = buildCommentPoolSpecs(planRows);
    const poolFingerprintByPlanLevel = new Map(poolSpecs.map((spec) => [`${spec.assessmentPlanId}|${spec.level}`, spec.fingerprint]));
    const scores = body.scores as Record<string, ScoreStudent[]>;
    const targetAssessmentIndexes = body.targetAssessmentIndexes && typeof body.targetAssessmentIndexes === "object"
      && !Array.isArray(body.targetAssessmentIndexes)
      ? body.targetAssessmentIndexes as Record<string, unknown>
      : null;
    const evidence: CommentEvidence[] = [];
    for (const subject of [...new Set(plan.map((item) => item.subject))]) {
      const subjectPlan = plan.filter((item) => item.subject === subject);
      for (const student of Array.isArray(scores[subject]) ? scores[subject] : []) {
        if (!selectedStudentIds.includes(student.studentId)) continue;
        if (!Number.isInteger(student.studentId) || !Array.isArray(student.levels) || student.levels.length !== subjectPlan.length) continue;
        const subjectItems = subjectPlan.flatMap((item, index) => {
          const level = student.levels[index];
          if (level !== "상" && level !== "중" && level !== "하") return [];
          const criterion = level === "상" ? item.high : level === "중" ? item.middle : item.low;
          return [{
            assessmentIndex: index,
            assessmentPlanId: item.id,
            poolFingerprint: poolFingerprintByPlanLevel.get(`${item.id}|${level}`),
            level,
            criterion,
            levelCriteria: { high: item.high, middle: item.middle, low: item.low },
            text: `${item.unit} | ${item.domain} | 목표: ${item.goal} | 관점: ${item.perspective} | 수준: ${level} | 기준: ${criterion}`,
          }];
        });
        const requestedIndexes = targetAssessmentIndexes?.[`${student.studentId}|${subject}`];
        const targetSet = Array.isArray(requestedIndexes)
          ? new Set(requestedIndexes.map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < subjectPlan.length))
          : null;
        const items = targetSet ? subjectItems.filter((item) => targetSet.has(item.assessmentIndex)) : subjectItems;
        if (items.length) evidence.push({
          studentId: student.studentId,
          subject,
          items,
          subjectItems,
          forceRegenerateItems: body.forceTargetRegeneration === true && Boolean(targetSet),
        });
      }
    }
    if (!evidence.length) return Response.json({ error: "전 과목 중 평가 수준을 한 개 이상 입력해 주세요." }, { status: 400 });
    const requiredFingerprints = [...new Set(evidence.flatMap((entry) => entry.items.map((item) => item.poolFingerprint).filter((value): value is string => Boolean(value))))];
    const preparedPools = requiredFingerprints.length ? await selectRows<{ fingerprint: string; approved_count: number }>("comment_pool_versions", {
      fingerprint: `in.(${requiredFingerprints.join(",")})`,
    }) : [];
    const usableFingerprints = new Set(preparedPools.filter((pool) => Number(pool.approved_count) > 0).map((pool) => pool.fingerprint));
    const missingPoolCount = requiredFingerprints.filter((fingerprint) => !usableFingerprints.has(fingerprint)).length;
    if (missingPoolCount) {
      return Response.json({ error: `평가계획 관리의 AI 평어 탭에서 ${missingPoolCount}개 영역·수준의 AI 평어를 먼저 제작해 주세요.`, code: "COMMENT_POOLS_REQUIRED" }, { status: 409 });
    }
    const variations = createCommentVariations(evidence.reduce((count, item) => count + item.items.length, 0));
    let variationIndex = 0;
    evidence.forEach((item) => {
      item.itemVariations = Object.fromEntries(item.items.map((entry) => [entry.assessmentIndex, variations[variationIndex++]]));
      item.variation = item.itemVariations[item.items[0]?.assessmentIndex];
    });
    await requireOwnedStudentIds(evidence.map((item) => item.studentId), user.id, classId);

    const batches = batchCommentsByAssessmentArea(evidence);
    if (body.overwriteExisting === true) {
      const selected = `in.(${selectedStudentIds.join(",")})`;
      const selectedSubjects = Object.keys(body.scores as Record<string, unknown>);
      if (selectedSubjects.length !== 1) return Response.json({ error: "전체 재생성은 한 과목씩 실행해 주세요." }, { status: 400 });
      const subject = selectedSubjects[0];
      await supabaseRequest("generated_comment_parts", {
        method: "DELETE", query: { owner_id: eq(user.id), class_id: eq(classId), subject: eq(subject), student_id: selected },
      });
      await supabaseRequest("generated_comments", {
        method: "DELETE", query: { owner_id: eq(user.id), class_id: eq(classId), subject: eq(subject), student_id: selected },
      });
    }

    const rows = await insertRows<JobRow>("generation_jobs", [{
      owner_id: user.id,
      owner_email: user.email,
      class_id: classId,
      job_type: "comments",
      status: "queued",
      batches,
      current_batch: 0,
      total_batches: batches.length,
      total_items: evidence.reduce((count, item) => count + item.items.length, 0),
      completed_items: 0,
      failed_items: 0,
      error_message: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]);
    startRunner(request, rows[0].id);
    return Response.json({ job: present(rows[0]) }, { status: 202 });
  } catch (error) {
    return dataError(error, "교과 평어 백그라운드 작업을 시작하지 못했습니다.");
  }
}
