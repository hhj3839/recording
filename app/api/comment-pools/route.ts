import { waitUntil } from "@vercel/functions";
import { eq, insertRows, selectRows, supabaseRequest, upsertRows } from "../../../db/supabase";
import { buildCommentPoolSpecs, COMMENT_POOL_GENERATOR_VERSION, COMMENT_POOL_MINIMUM, COMMENT_POOL_TARGET, type PoolPlanItem } from "../../comment-pool-library";
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
    const assessmentPlanIds = [...new Set(specs.map((spec) => spec.assessmentPlanId))];
    const links = assessmentPlanIds.length ? await selectRows<{ assessment_plan_id: number; pool_version_id: number }>("assessment_plan_pool_links", {
      owner_id: eq(user.id), class_id: eq(classId), assessment_plan_id: inValues(assessmentPlanIds),
    }) : [];
    const linkedVersionsByPlan = new Set(links.map((link) => `${Number(link.assessment_plan_id)}|${Number(link.pool_version_id)}`));
    const versions = specs.length ? await selectRows<PoolVersionRow>("comment_pool_versions", {
      fingerprint: inValues(specs.map((spec) => spec.fingerprint)),
    }) : [];
    const versionByFingerprint = new Map(versions.map((version) => [version.fingerprint, version]));
    const groups = specs.map((spec) => {
      const candidate = versionByFingerprint.get(spec.fingerprint);
      const version = candidate && linkedVersionsByPlan.has(`${spec.assessmentPlanId}|${Number(candidate.id)}`) ? candidate : undefined;
      return {
        fingerprint: spec.fingerprint, subject: spec.subject, unit: spec.unit, domain: spec.domain,
        assessmentIndex: spec.assessmentIndex, level: spec.level,
        status: version?.status ?? "needs_generation", approvedCount: Number(version?.approved_count ?? 0),
        targetCount: COMMENT_POOL_TARGET, poolVersionId: version ? Number(version.id) : null,
      };
    });
    const detailFingerprint = params.get("fingerprint");
    const detailSpec = detailFingerprint ? specs.find((spec) => spec.fingerprint === detailFingerprint) : undefined;
    const detailCandidate = detailFingerprint ? versionByFingerprint.get(detailFingerprint) : undefined;
    const detailVersion = detailSpec && detailCandidate
      && linkedVersionsByPlan.has(`${detailSpec.assessmentPlanId}|${Number(detailCandidate.id)}`)
      ? detailCandidate
      : undefined;
    const sentences = detailVersion ? await selectRows<{ id: number; sentence: string }>("comment_pool_sentences", {
      pool_version_id: eq(detailVersion.id), status: eq("approved"), order: "id.asc", limit: COMMENT_POOL_TARGET,
    }) : [];
    return Response.json({
      groups,
      summary: {
        total: groups.length,
        ready: groups.filter((group) => group.approvedCount >= COMMENT_POOL_MINIMUM).length,
        usable: groups.filter((group) => group.approvedCount > 0).length,
        needsGeneration: groups.filter((group) => group.approvedCount < COMMENT_POOL_MINIMUM).length,
      },
      sentences: sentences.map((row) => ({ id: Number(row.id), sentence: row.sentence })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return dataError(error, "AI 평어 준비 상태를 불러오지 못했습니다.");
  }
}

export async function DELETE() {
  try {
    const { user, classId } = await getDataScope();
    const specs = await currentSpecs(user.id, classId);
    const assessmentPlanIds = [...new Set(specs.map((spec) => spec.assessmentPlanId))];
    if (!assessmentPlanIds.length) return Response.json({ resetGroups: 0, resetPlanItems: 0 });
    const activeJob = (await selectRows<{ id: string }>("generation_jobs", {
      owner_id: eq(user.id), class_id: eq(classId), job_type: eq("comment-pools"), status: "in.(queued,running)", limit: 1,
    }))[0];
    if (activeJob) return Response.json({ error: "AI 평어 제작이 끝난 뒤 초기화해 주세요." }, { status: 409 });
    await supabaseRequest("assessment_plan_pool_links", {
      method: "DELETE",
      query: { owner_id: eq(user.id), class_id: eq(classId), assessment_plan_id: inValues(assessmentPlanIds) },
    });
    return Response.json({ resetGroups: specs.length, resetPlanItems: assessmentPlanIds.length });
  } catch (error) {
    return dataError(error, "AI 평어를 초기화하지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    const body = await request.json().catch(() => ({})) as {
      subject?: unknown; maxGroups?: unknown; labOnly?: unknown; targetFingerprints?: unknown; canonicalOnly?: unknown;
    };
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    if (!subject) return Response.json({ error: "AI 평어를 제작할 과목을 선택해 주세요." }, { status: 400 });
    if (body.labOnly === true && !user.email.toLowerCase().endsWith("@giroksam.test")) {
      return Response.json({ error: "제한 검증은 실험실 계정에서만 실행할 수 있습니다." }, { status: 403 });
    }
    const canonicalOnly = body.canonicalOnly === true;
    if (canonicalOnly && body.labOnly !== true) {
      return Response.json({ error: "기준 문장 전용 복구는 실험실 제한 검증에서만 사용할 수 있습니다." }, { status: 403 });
    }
    const targetFingerprints = Array.isArray(body.targetFingerprints)
      ? [...new Set(body.targetFingerprints.filter((value): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)))]
      : [];
    if (targetFingerprints.length && body.labOnly !== true) {
      return Response.json({ error: "개별 문장 풀 지정은 실험실 제한 검증에서만 사용할 수 있습니다." }, { status: 403 });
    }
    const requestedMaxGroups = Number(body.maxGroups);
    const maxGroups = Number.isInteger(requestedMaxGroups) && requestedMaxGroups > 0
      ? Math.min(requestedMaxGroups, 15)
      : Number.POSITIVE_INFINITY;
    const subjectSpecs = (await currentSpecs(user.id, classId)).filter((spec) => spec.subject === subject);
    const specs = targetFingerprints.length
      ? subjectSpecs.filter((spec) => targetFingerprints.includes(spec.fingerprint))
      : subjectSpecs;
    if (!specs.length) return Response.json({ error: "저장된 평가계획이 없습니다." }, { status: 400 });
    if (targetFingerprints.length !== 0 && specs.length !== targetFingerprints.length) {
      return Response.json({ error: "지정한 문장 풀 중 현재 평가계획과 일치하지 않는 항목이 있습니다." }, { status: 400 });
    }
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
      return version && Number(version.approved_count ?? 0) < COMMENT_POOL_MINIMUM
        ? [{ spec, poolVersionId: Number(version.id), maxAttempts: canonicalOnly ? 0 : 2 }]
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
    return Response.json({ jobId: jobs[0].id, subject, total: pending.length, maxAiCalls: pending.reduce((sum, batch) => sum + batch.maxAttempts, 0), reused: specs.length - pending.length }, { status: 202 });
  } catch (error) {
    return dataError(error, "AI 평어 제작을 시작하지 못했습니다.");
  }
}
