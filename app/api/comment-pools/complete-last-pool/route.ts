import { eq, insertRows, selectRows, updateRows } from "../../../../db/supabase";
import {
  buildCommentPoolSpecs,
  COMMENT_POOL_MINIMUM,
  normalizedPoolSentence,
  validatePoolCandidate,
  type PoolPlanItem,
} from "../../../comment-pool-library";
import { dataError, getDataScope } from "../../../data-scope";

const approvedScope = {
  subject: "사회",
  unit: "2. 일상에서 만나는 과거",
  domain: "역사 일반",
  level: "상",
};
const approvedSentence = "오래된 물건을 조사하는 다양한 방법을 알고, 물건을 조사하여 결과를 정리함.";

type JobRow = {
  id: string;
  status: string;
  batches: Array<{ spec?: { subject?: string; unit?: string; domain?: string; level?: string }; poolVersionId?: number }>;
};

export async function POST(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    if (!user.email.toLowerCase().endsWith("@giroksam.test")) {
      return Response.json({ error: "실험실 계정에서만 실행할 수 있습니다." }, { status: 403 });
    }
    const body = await request.json().catch(() => ({})) as {
      jobId?: unknown;
      expectedApprovedCount?: unknown;
      approvalCode?: unknown;
      apply?: unknown;
    };
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(jobId)
      || Number(body.expectedApprovedCount) !== COMMENT_POOL_MINIMUM - 1
      || body.approvalCode !== "COMPLETE_LAST_POOL_2026_08_28") {
      return Response.json({ error: "승인된 마지막 문장 풀 보완 범위와 일치하지 않습니다." }, { status: 409 });
    }

    const job = (await selectRows<JobRow>("generation_jobs", {
      id: eq(jobId), owner_id: eq(user.id), class_id: eq(classId), job_type: eq("comment-pools"), limit: 1,
    }))[0];
    if (!job || job.status !== "completed" || !Array.isArray(job.batches) || job.batches.length !== 1) {
      return Response.json({ error: "완료된 마지막 단일 묶음 작업을 찾을 수 없습니다." }, { status: 409 });
    }
    const batch = job.batches[0];
    const scope = batch.spec;
    if (!scope || Object.entries(approvedScope).some(([key, value]) => scope[key as keyof typeof scope] !== value)) {
      return Response.json({ error: "마지막 보완 대상 평가영역이 승인 범위와 다릅니다." }, { status: 409 });
    }
    const poolVersionId = Number(batch.poolVersionId);
    if (!Number.isInteger(poolVersionId)) return Response.json({ error: "문장 풀 버전을 확인할 수 없습니다." }, { status: 409 });

    const plan = await selectRows<PoolPlanItem>("assessment_plans", {
      owner_id: eq(user.id), class_id: eq(classId), order: "sort_order.asc",
    });
    const spec = buildCommentPoolSpecs(plan).find((item) => Object.entries(approvedScope)
      .every(([key, value]) => item[key as keyof typeof approvedScope] === value));
    if (!spec) return Response.json({ error: "현재 평가계획에서 마지막 보완 대상을 찾을 수 없습니다." }, { status: 409 });
    const validation = validatePoolCandidate(approvedSentence, spec);
    if (validation.issues.length) {
      return Response.json({ error: "무료 보완 문장이 최신 검수를 통과하지 못했습니다.", issues: validation.issues }, { status: 409 });
    }

    const approved = await selectRows<{ normalized_sentence: string }>("comment_pool_sentences", {
      pool_version_id: eq(poolVersionId), status: eq("approved"), order: "id.asc",
    });
    if (approved.length !== COMMENT_POOL_MINIMUM - 1) {
      return Response.json({ error: `예상한 ${COMMENT_POOL_MINIMUM - 1}개와 현재 승인 문장 ${approved.length}개가 다릅니다.` }, { status: 409 });
    }
    const normalized = normalizedPoolSentence(approvedSentence);
    if (approved.some((row) => row.normalized_sentence === normalized)) {
      return Response.json({ error: "무료 보완 문장이 기존 승인 문장과 같습니다." }, { status: 409 });
    }
    const preview = { poolVersionId, before: approved.length, after: approved.length + 1, sentence: approvedSentence, issues: validation.issues };
    if (body.apply !== true) return Response.json({ ...preview, applied: false, aiCalls: 0 });

    await insertRows("comment_pool_sentences", [{
      pool_version_id: poolVersionId,
      sentence: approvedSentence,
      normalized_sentence: normalized,
      status: "approved",
      source: "teacher_edited",
      updated_at: new Date().toISOString(),
    }]);
    await updateRows("comment_pool_versions", { id: eq(poolVersionId) }, {
      approved_count: approved.length + 1,
      status: "ready",
      updated_at: new Date().toISOString(),
    });
    return Response.json({ ...preview, applied: true, aiCalls: 0 });
  } catch (error) {
    return dataError(error, "마지막 AI 평어 문장 풀을 보완하지 못했습니다.");
  }
}
