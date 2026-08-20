import { waitUntil } from "@vercel/functions";
import { eq, insertRows, selectRows, upsertRows } from "../../../db/supabase";
import { buildCommentPoolSpecs, COMMENT_POOL_GENERATOR_VERSION, COMMENT_POOL_TARGET, type PoolPlanItem } from "../../comment-pool-library";
import { signCommentJob } from "../../comment-generation";
import { dataError, getDataScope } from "../../data-scope";

type PoolVersionRow = {
  id: number; fingerprint: string; status: string; approved_count: number; target_count: number;
  subject: string; domain: string; level: string; updated_at: string;
};

const inValues = (values: Array<string | number>) => `in.(${values.join(",")})`;

async function currentSpecs(ownerId: string, classId: number) {
  const plan = await selectRows<PoolPlanItem>("assessment_plans", {
    owner_id: eq(ownerId), class_id: eq(classId), order: "sort_order.asc",
  });
  return buildCommentPoolSpecs(plan);
}

function queueRunner(request: Request, jobId: string) {
  const url = new URL("/api/comment-pools/run", request.url);
  waitUntil(fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, signature: signCommentJob(jobId) }),
  }).catch(() => undefined));
}

export async function GET(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    const params = new URL(request.url).searchParams;
    const jobId = params.get("jobId");
    if (jobId) {
      const job = (await selectRows<Record<string, unknown>>("generation_jobs", {
        id: eq(jobId), owner_id: eq(user.id), job_type: eq("comment-pools"), limit: 1,
      }))[0];
      if (!job) return Response.json({ error: "AI 평어 제작 작업을 찾을 수 없습니다." }, { status: 404 });
      if (["queued", "running"].includes(String(job.status))) queueRunner(request, jobId);
      return Response.json({ job: {
        id: job.id, status: job.status, completed: Number(job.completed_items), total: Number(job.total_items),
        failed: Number(job.failed_items), error: String(job.error_message ?? ""),
      } }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const specs = await currentSpecs(user.id, classId);
    const versions = specs.length ? await selectRows<PoolVersionRow>("comment_pool_versions", {
      fingerprint: inValues(specs.map((spec) => spec.fingerprint)),
    }) : [];
    const versionByFingerprint = new Map(versions.map((version) => [version.fingerprint, version]));
    const groups = specs.map((spec) => {
      const version = versionByFingerprint.get(spec.fingerprint);
      return {
        fingerprint: spec.fingerprint, subject: spec.subject, unit: spec.unit, domain: spec.domain,
        assessmentIndex: spec.assessmentIndex, level: spec.level,
        status: version?.status ?? "needs_generation", approvedCount: Number(version?.approved_count ?? 0),
        targetCount: COMMENT_POOL_TARGET, poolVersionId: version ? Number(version.id) : null,
      };
    });
    const detailFingerprint = params.get("fingerprint");
    const detailVersion = detailFingerprint ? versionByFingerprint.get(detailFingerprint) : undefined;
    const sentences = detailVersion ? await selectRows<{ id: number; sentence: string }>("comment_pool_sentences", {
      pool_version_id: eq(detailVersion.id), status: eq("approved"), order: "id.asc", limit: COMMENT_POOL_TARGET,
    }) : [];
    return Response.json({
      groups,
      summary: {
        total: groups.length,
        ready: groups.filter((group) => group.approvedCount >= COMMENT_POOL_TARGET).length,
        usable: groups.filter((group) => group.approvedCount > 0).length,
        needsGeneration: groups.filter((group) => group.approvedCount < COMMENT_POOL_TARGET).length,
      },
      sentences: sentences.map((row) => ({ id: Number(row.id), sentence: row.sentence })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return dataError(error, "AI 평어 준비 상태를 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    const body = await request.json().catch(() => ({})) as { subject?: unknown; maxGroups?: unknown; labOnly?: unknown };
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    if (!subject) return Response.json({ error: "AI 평어를 제작할 과목을 선택해 주세요." }, { status: 400 });
    if (body.labOnly === true && !user.email.toLowerCase().endsWith("@giroksam.test")) {
      return Response.json({ error: "제한 검증은 실험실 계정에서만 실행할 수 있습니다." }, { status: 403 });
    }
    const requestedMaxGroups = Number(body.maxGroups);
    const maxGroups = Number.isInteger(requestedMaxGroups) && requestedMaxGroups > 0
      ? Math.min(requestedMaxGroups, 15)
      : Number.POSITIVE_INFINITY;
    const specs = (await currentSpecs(user.id, classId)).filter((spec) => spec.subject === subject);
    if (!specs.length) return Response.json({ error: "저장된 평가계획이 없습니다." }, { status: 400 });
    const versions = await upsertRows<PoolVersionRow>("comment_pool_versions", specs.map((spec) => ({
      fingerprint: spec.fingerprint, subject: spec.subject, unit: spec.unit, domain: spec.domain,
      level: spec.level, criterion: spec.criterion, level_criteria: spec.levelCriteria,
      canonical_sentence: spec.canonicalSentence, target_count: COMMENT_POOL_TARGET,
      generator_version: COMMENT_POOL_GENERATOR_VERSION, created_by: user.id, updated_at: new Date().toISOString(),
    })), "fingerprint");
    const byFingerprint = new Map(versions.map((row) => [row.fingerprint, row]));
    await upsertRows("assessment_plan_pool_links", specs.flatMap((spec) => {
      const version = byFingerprint.get(spec.fingerprint);
      return version ? [{
        owner_id: user.id, owner_email: user.email, class_id: classId,
        assessment_plan_id: spec.assessmentPlanId, pool_version_id: Number(version.id),
      }] : [];
    }), "owner_id,class_id,assessment_plan_id,pool_version_id");
    const pending = specs.flatMap((spec) => {
      const version = byFingerprint.get(spec.fingerprint);
      return version && Number(version.approved_count ?? 0) < COMMENT_POOL_TARGET
        ? [{ spec, poolVersionId: Number(version.id) }]
        : [];
    }).slice(0, maxGroups);
    if (!pending.length) return Response.json({ ready: true, reused: specs.length });
    const jobs = await insertRows<{ id: string }>("generation_jobs", [{
      owner_id: user.id, owner_email: user.email, class_id: classId, job_type: "comment-pools",
      status: "queued", batches: pending, current_batch: 0, total_batches: pending.length,
      total_items: pending.length, completed_items: 0, failed_items: 0, error_message: "",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }]);
    queueRunner(request, jobs[0].id);
    return Response.json({ jobId: jobs[0].id, subject, total: pending.length, maxAiCalls: pending.length * 2, reused: specs.length - pending.length }, { status: 202 });
  } catch (error) {
    return dataError(error, "AI 평어 제작을 시작하지 못했습니다.");
  }
}
