import { eq, selectRows, supabaseRequest, updateRows, upsertRows } from "../../../../db/supabase";
import { buildCommentPoolSpecs, commentPoolQuality, type CommentPoolSpec, type PoolPlanItem } from "../../../comment-pool-library";
import { dataError, getDataScope } from "../../../data-scope";

type PoolBatch = {
  spec?: CommentPoolSpec;
  poolVersionId?: number;
  previousPoolVersionIds?: number[];
};
type JobRow = {
  id: string; owner_id: string; class_id: number; job_type: string; status: string;
  total_items: number; batches: PoolBatch[];
};

const inValues = (values: Array<string | number>) => `in.(${values.join(",")})`;
const scopeKey = (spec: Pick<CommentPoolSpec, "subject" | "unit" | "domain" | "level" | "criterion">) =>
  `${spec.subject}|${spec.unit}|${spec.domain}|${spec.level}|${spec.criterion}`;

export async function POST(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    if (!user.email.toLowerCase().endsWith("@giroksam.test")) {
      return Response.json({ error: "완료 작업 풀 복구는 실험실 계정에서만 실행할 수 있습니다." }, { status: 403 });
    }
    const body = await request.json().catch(() => ({})) as {
      jobId?: unknown; expectedRecoverable?: unknown; apply?: unknown;
    };
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(jobId)) {
      return Response.json({ error: "재검수할 문장 풀 작업을 확인해 주세요." }, { status: 400 });
    }
    const job = (await selectRows<JobRow>("generation_jobs", {
      id: eq(jobId), owner_id: eq(user.id), class_id: eq(classId), job_type: eq("comment-pools"), limit: 1,
    }))[0];
    if (!job || !["completed", "completed_with_errors"].includes(job.status)) {
      return Response.json({ error: "완료된 실험실 문장 풀 작업만 재검수할 수 있습니다." }, { status: 409 });
    }
    if (Number(job.total_items) !== 75 || !Array.isArray(job.batches) || job.batches.length !== 75) {
      return Response.json({ error: "재검수 범위가 승인된 75개 묶음과 일치하지 않습니다." }, { status: 409 });
    }

    const plan = await selectRows<PoolPlanItem>("assessment_plans", {
      owner_id: eq(user.id), class_id: eq(classId), order: "sort_order.asc",
    });
    const currentSpecs = buildCommentPoolSpecs(plan);
    const currentByScope = new Map(currentSpecs.map((spec) => [scopeKey(spec), spec]));
    const versionIds = job.batches.map((batch) => Number(batch.poolVersionId)).filter(Number.isInteger);
    const sentenceRows = await selectRows<{ pool_version_id: number; sentence: string }>("comment_pool_sentences", {
      pool_version_id: inValues(versionIds), status: eq("approved"), order: "id.asc",
    });
    const sentencesByVersion = new Map<number, string[]>();
    sentenceRows.forEach((row) => {
      const versionId = Number(row.pool_version_id);
      sentencesByVersion.set(versionId, [...(sentencesByVersion.get(versionId) ?? []), row.sentence]);
    });
    const planIds = [...new Set(currentSpecs.map((spec) => spec.assessmentPlanId))];
    const links = await selectRows<{ assessment_plan_id: number; pool_version_id: number }>("assessment_plan_pool_links", {
      owner_id: eq(user.id), class_id: eq(classId), assessment_plan_id: inValues(planIds),
    });
    const linkedVersionIds = new Set(links.map((link) => Number(link.pool_version_id)));
    const candidates = job.batches.flatMap((batch) => {
      const jobSpec = batch.spec;
      const poolVersionId = Number(batch.poolVersionId);
      if (!jobSpec || !Number.isInteger(poolVersionId)) return [];
      const currentSpec = currentByScope.get(scopeKey(jobSpec));
      if (!currentSpec || linkedVersionIds.has(poolVersionId)) return [];
      const sentences = sentencesByVersion.get(poolVersionId) ?? [];
      const quality = commentPoolQuality(sentences, currentSpec.canonicalSentence);
      return quality.reusable ? [{
        spec: currentSpec, poolVersionId, sentences, quality,
        previousPoolVersionIds: (batch.previousPoolVersionIds ?? []).map(Number).filter(Number.isInteger),
      }] : [];
    });
    const preview = {
      jobId,
      recoverable: candidates.length,
      recoveredSentences: candidates.reduce((sum, candidate) => sum + candidate.sentences.length, 0),
      remaining: 75 - linkedVersionIds.size - candidates.length,
      scopes: candidates.map((candidate) => ({
        subject: candidate.spec.subject, domain: candidate.spec.domain, level: candidate.spec.level,
        approvedCount: candidate.sentences.length, warnings: candidate.quality.warnings,
      })),
    };
    if (body.apply !== true) return Response.json({ ...preview, applied: false });
    const expectedRecoverable = Number(body.expectedRecoverable);
    if (!Number.isInteger(expectedRecoverable) || expectedRecoverable !== candidates.length) {
      return Response.json({ error: `예상 복구 ${expectedRecoverable}개와 실제 ${candidates.length}개가 다릅니다.` }, { status: 409 });
    }
    for (const candidate of candidates) {
      await upsertRows("assessment_plan_pool_links", [{
        owner_id: user.id, owner_email: user.email, class_id: classId,
        assessment_plan_id: candidate.spec.assessmentPlanId, pool_version_id: candidate.poolVersionId,
      }], "owner_id,class_id,assessment_plan_id,pool_version_id");
      const previousIds = candidate.previousPoolVersionIds.filter((id) => id !== candidate.poolVersionId);
      if (previousIds.length) {
        await supabaseRequest("assessment_plan_pool_links", {
          method: "DELETE",
          query: {
            owner_id: eq(user.id), class_id: eq(classId), assessment_plan_id: eq(candidate.spec.assessmentPlanId),
            pool_version_id: inValues(previousIds),
          },
        });
      }
      await updateRows("comment_pool_versions", { id: eq(candidate.poolVersionId) }, {
        status: "ready", approved_count: candidate.sentences.length, updated_at: new Date().toISOString(),
      });
    }
    return Response.json({ ...preview, applied: true });
  } catch (error) {
    return dataError(error, "완료된 문장 풀을 새 기준으로 연결하지 못했습니다.");
  }
}
