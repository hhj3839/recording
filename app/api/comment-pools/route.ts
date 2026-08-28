import { waitUntil } from "@vercel/functions";
import { createHash } from "node:crypto";
import { eq, insertRows, selectRows, supabaseRequest, updateRows, upsertRows } from "../../../db/supabase";
import { buildCommentPoolSpecs, buildValidatedMinimumPoolFallbacks, commentPoolQuality, COMMENT_POOL_GENERATOR_VERSION, COMMENT_POOL_TARGET, normalizedPoolSentence, validatePoolCandidate, type CommentPoolSpec, type PoolPlanItem } from "../../comment-pool-library";
import { signCommentJob } from "../../comment-generation";
import { dataError, getDataScope } from "../../data-scope";

type PoolVersionRow = {
  id: number; fingerprint: string; status: string; approved_count: number; target_count: number;
  subject: string; unit: string; domain: string; level: string; criterion: string; updated_at: string;
};

const inValues = (values: Array<string | number>) => `in.(${values.join(",")})`;

async function currentSpecs(ownerId: string, classId: number) {
  const plan = await selectRows<PoolPlanItem>("assessment_plans", {
    owner_id: eq(ownerId), class_id: eq(classId), order: "sort_order.asc",
  });
  return buildCommentPoolSpecs(plan);
}

function versionMatchesSpec(version: PoolVersionRow, spec: ReturnType<typeof buildCommentPoolSpecs>[number]) {
  return version.subject === spec.subject && version.unit === spec.unit && version.domain === spec.domain
    && version.level === spec.level && version.criterion === spec.criterion;
}

async function linkedVersions(ownerId: string, classId: number) {
  const links = await selectRows<{ assessment_plan_id: number; pool_version_id: number }>("assessment_plan_pool_links", {
    owner_id: eq(ownerId), class_id: eq(classId), order: "id.desc",
  });
  const versionIds = [...new Set(links.map((link) => Number(link.pool_version_id)))];
  const versions = versionIds.length ? await selectRows<PoolVersionRow>("comment_pool_versions", {
    id: inValues(versionIds), order: "updated_at.desc",
  }) : [];
  const versionById = new Map(versions.map((version) => [Number(version.id), version]));
  return { links, versions, versionById };
}

async function approvedSentencesByVersion(versionIds: number[]) {
  const rows = versionIds.length ? await selectRows<{ pool_version_id: number; sentence: string }>("comment_pool_sentences", {
    pool_version_id: inValues(versionIds), status: eq("approved"), order: "id.asc",
  }) : [];
  const byVersion = new Map<number, string[]>();
  rows.forEach((row) => {
    const versionId = Number(row.pool_version_id);
    byVersion.set(versionId, [...(byVersion.get(versionId) ?? []), row.sentence]);
  });
  return byVersion;
}

function queueRunner(request: Request, jobId: string) {
  const url = new URL("/api/comment-pools/run", request.url);
  waitUntil(fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, signature: signCommentJob(jobId) }),
  }).catch(() => undefined));
}

function publicJob(job: Record<string, unknown>) {
  const batches = Array.isArray(job.batches) ? job.batches as Array<{ spec?: { subject?: string; domain?: string; level?: string } }> : [];
  const current = batches[Math.max(0, Number(job.current_batch) || 0)]?.spec;
  return {
    id: String(job.id), status: String(job.status), completed: Number(job.completed_items), total: Number(job.total_items),
    failed: Number(job.failed_items), error: String(job.error_message ?? ""),
    current: current ? { subject: String(current.subject ?? ""), domain: String(current.domain ?? ""), level: String(current.level ?? "") } : null,
  };
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
      if (params.get("audit") === "1") {
        if (!user.email.toLowerCase().endsWith("@giroksam.test")) {
          return Response.json({ error: "제한 품질 감사는 실험실 계정에서만 확인할 수 있습니다." }, { status: 403 });
        }
        if (["queued", "running"].includes(String(job.status))) {
          return Response.json({ error: "제작이 끝난 뒤 품질 감사를 확인해 주세요." }, { status: 409 });
        }
        const batches = Array.isArray(job.batches) ? job.batches as Array<{ spec?: CommentPoolSpec; poolVersionId?: number }> : [];
        const versionIds = batches.map((batch) => Number(batch.poolVersionId)).filter(Number.isInteger);
        const rows = versionIds.length ? await selectRows<{ pool_version_id: number; sentence: string }>("comment_pool_sentences", {
          pool_version_id: inValues(versionIds), status: eq("approved"), order: "id.asc",
        }) : [];
        const audit = batches.flatMap((batch) => {
          const spec = batch.spec;
          const poolVersionId = Number(batch.poolVersionId);
          if (!spec || !Number.isInteger(poolVersionId)) return [];
          const sentences = rows.filter((row) => Number(row.pool_version_id) === poolVersionId).map((row) => row.sentence);
          const validations = sentences.map((sentence) => validatePoolCandidate(sentence, spec));
          return [{
            scope: { subject: spec.subject, unit: spec.unit, domain: spec.domain, level: spec.level },
            poolVersionId,
            quality: commentPoolQuality(sentences, spec.canonicalSentence),
            grounding: {
              passing: validations.filter((result) => result.issues.length === 0).length,
              failing: validations.filter((result) => result.issues.length > 0).length,
              issues: [...new Set(validations.flatMap((result) => result.issues))],
            },
            sentences: validations.map((result) => ({ text: result.text, length: Array.from(result.text).length, issues: result.issues })),
          }];
        });
        return Response.json({ job: publicJob(job), audit }, { headers: { "Cache-Control": "private, no-store" } });
      }
      return Response.json({ job: publicJob(job) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const [specs, linked] = await Promise.all([
      currentSpecs(user.id, classId),
      linkedVersions(user.id, classId),
    ]);
    const { links, versionById } = linked;
    const sentencesByVersion = await approvedSentencesByVersion([...versionById.keys()]);
    const linkedVersionFor = (spec: (typeof specs)[number]) => links
      .filter((link) => Number(link.assessment_plan_id) === spec.assessmentPlanId)
      .map((link) => versionById.get(Number(link.pool_version_id)))
      .find((version): version is PoolVersionRow => Boolean(version && versionMatchesSpec(version, spec)));
    const groups = specs.map((spec) => {
      const version = linkedVersionFor(spec);
      const quality = commentPoolQuality(version ? (sentencesByVersion.get(Number(version.id)) ?? []) : [], spec.canonicalSentence);
      const sentences = version ? (sentencesByVersion.get(Number(version.id)) ?? []) : [];
      const validations = sentences.map((sentence) => validatePoolCandidate(sentence, spec));
      return {
        fingerprint: spec.fingerprint, subject: spec.subject, unit: spec.unit, domain: spec.domain,
        assessmentIndex: spec.assessmentIndex, level: spec.level,
        status: quality.reusable ? "ready" : "needs_generation",
        approvedCount: Number(version?.approved_count ?? 0), qualityIssues: quality.issues,
        qualityWarnings: quality.warnings,
        reviewCount: validations.filter((result) => result.issues.length > 0).length,
        diversity: {
          uniqueCount: quality.uniqueCount,
          openingCount: quality.openingCount,
          openingRatio: quality.openingRatio,
          clusteredPairs: quality.clusteredPairs,
          totalPairs: quality.totalPairs,
          clusterRatio: quality.clusterRatio,
          averageNearestSimilarity: quality.averageNearestSimilarity,
          averageLength: quality.averageLength,
        },
        targetCount: COMMENT_POOL_TARGET, poolVersionId: version ? Number(version.id) : null,
      };
    });
    const detailFingerprint = params.get("fingerprint");
    const detailSpec = detailFingerprint ? specs.find((spec) => spec.fingerprint === detailFingerprint) : undefined;
    const detailVersion = detailSpec ? linkedVersionFor(detailSpec) : undefined;
    const sentences = detailVersion ? await selectRows<{ id: number; sentence: string }>("comment_pool_sentences", {
      pool_version_id: eq(detailVersion.id), status: eq("approved"), order: "id.asc", limit: COMMENT_POOL_TARGET,
    }) : [];
    const detailValidations = detailSpec
      ? sentences.map((row) => ({ ...row, issues: validatePoolCandidate(row.sentence, detailSpec).issues }))
      : [];
    const activeJob = (await selectRows<Record<string, unknown>>("generation_jobs", {
      owner_id: eq(user.id), class_id: eq(classId), job_type: eq("comment-pools"), status: "in.(queued,running)", order: "updated_at.desc", limit: 1,
    }))[0];
    if (activeJob) queueRunner(request, String(activeJob.id));
    return Response.json({
      groups,
      summary: {
        total: groups.length,
        ready: groups.filter((group) => group.status === "ready").length,
        usable: groups.filter((group) => group.approvedCount > 0).length,
        needsGeneration: groups.filter((group) => group.status !== "ready").length,
        approved: groups.reduce((sum, group) => sum + group.approvedCount, 0),
        reviewCount: groups.reduce((sum, group) => sum + group.reviewCount, 0),
        warningPools: groups.filter((group) => group.qualityWarnings.length > 0).length,
      },
      activeJob: activeJob ? publicJob(activeJob) : null,
      sentences: detailValidations.map((row) => ({ id: Number(row.id), sentence: row.sentence, issues: row.issues })),
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
      refresh?: unknown; fullRefresh?: unknown; freeFallbackOnly?: unknown;
    };
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
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
    const refresh = body.refresh === true;
    const fullRefresh = body.fullRefresh === true;
    const freeFallbackOnly = body.freeFallbackOnly === true;
    if (fullRefresh && body.labOnly !== true) {
      return Response.json({ error: "전체 새 버전 제작은 실험실 제한 검증에서만 사용할 수 있습니다." }, { status: 403 });
    }
    if (fullRefresh && (refresh || targetFingerprints.length || subject)) {
      return Response.json({ error: "전체 새 버전 제작에는 과목·개별 묶음·단일 새 버전 옵션을 함께 사용할 수 없습니다." }, { status: 400 });
    }
    if (targetFingerprints.length && body.labOnly !== true && !refresh) {
      return Response.json({ error: "개별 문장 풀 지정은 실험실 제한 검증에서만 사용할 수 있습니다." }, { status: 403 });
    }
    if (refresh && targetFingerprints.length !== 1) {
      return Response.json({ error: "새 버전으로 다시 제작할 문장 풀 한 개를 지정해야 합니다." }, { status: 400 });
    }
    const requestedMaxGroups = Number(body.maxGroups);
    const maxGroups = Number.isInteger(requestedMaxGroups) && requestedMaxGroups > 0
      ? Math.min(requestedMaxGroups, 15)
      : Number.POSITIVE_INFINITY;
    const allSpecs = await currentSpecs(user.id, classId);
    if (fullRefresh && allSpecs.length !== 75) {
      return Response.json({ error: `실험실 전체 새 버전 제작 범위가 75개가 아닙니다. (${allSpecs.length}개)` }, { status: 409 });
    }
    const subjectSpecs = subject ? allSpecs.filter((spec) => spec.subject === subject) : allSpecs;
    const specs = targetFingerprints.length
      ? subjectSpecs.filter((spec) => targetFingerprints.includes(spec.fingerprint))
      : subjectSpecs;
    if (!specs.length) return Response.json({ error: "저장된 평가계획이 없습니다." }, { status: 400 });
    if (targetFingerprints.length !== 0 && specs.length !== targetFingerprints.length) {
      return Response.json({ error: "지정한 문장 풀 중 현재 평가계획과 일치하지 않는 항목이 있습니다." }, { status: 400 });
    }
    const currentLinked = await linkedVersions(user.id, classId);
    if (fullRefresh) {
      const refreshNonce = Date.now();
      const versions = await insertRows<PoolVersionRow>("comment_pool_versions", specs.map((spec, index) => ({
        fingerprint: createHash("sha256")
          .update(`${spec.fingerprint}|full-refresh|${user.id}|${classId}|${refreshNonce}|${index}`)
          .digest("hex"),
        subject: spec.subject, unit: spec.unit, domain: spec.domain,
        level: spec.level, criterion: spec.criterion, level_criteria: spec.levelCriteria,
        canonical_sentence: spec.canonicalSentence, target_count: COMMENT_POOL_TARGET,
        generator_version: `${COMMENT_POOL_GENERATOR_VERSION}-full-refresh`, created_by: user.id,
        updated_at: new Date().toISOString(),
      })));
      if (versions.length !== specs.length) {
        return Response.json({ error: "새 문장 풀 버전을 모두 준비하지 못했습니다." }, { status: 500 });
      }
      const batches = specs.map((spec, index) => ({
        spec,
        poolVersionId: Number(versions[index].id),
        maxAttempts: 2,
        activateWhenReady: true,
        previousPoolVersionIds: currentLinked.links
          .filter((link) => Number(link.assessment_plan_id) === spec.assessmentPlanId)
          .map((link) => currentLinked.versionById.get(Number(link.pool_version_id)))
          .filter((version): version is PoolVersionRow => Boolean(version && versionMatchesSpec(version, spec)))
          .map((version) => Number(version.id)),
      }));
      const jobs = await insertRows<{ id: string }>("generation_jobs", [{
        owner_id: user.id, owner_email: user.email, class_id: classId, job_type: "comment-pools",
        status: "queued", batches, current_batch: 0, total_batches: batches.length,
        total_items: batches.length, completed_items: 0, failed_items: 0, error_message: "",
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }]);
      queueRunner(request, jobs[0].id);
      return Response.json({
        jobId: jobs[0].id, subject: "전체", total: batches.length,
        maxAiCalls: batches.length * 2, reused: 0, fullRefresh: true,
      }, { status: 202 });
    }
    if (refresh) {
      const spec = specs[0];
      const previousPoolVersionIds = currentLinked.links
        .filter((link) => Number(link.assessment_plan_id) === spec.assessmentPlanId)
        .map((link) => currentLinked.versionById.get(Number(link.pool_version_id)))
        .filter((version): version is PoolVersionRow => Boolean(version && versionMatchesSpec(version, spec)))
        .map((version) => Number(version.id));
      if (!previousPoolVersionIds.length) return Response.json({ error: "다시 제작할 기존 문장 풀을 찾을 수 없습니다." }, { status: 404 });
      const refreshFingerprint = createHash("sha256")
        .update(`${spec.fingerprint}|refresh|${user.id}|${classId}|${Date.now()}`)
        .digest("hex");
      const version = (await insertRows<PoolVersionRow>("comment_pool_versions", [{
        fingerprint: refreshFingerprint, subject: spec.subject, unit: spec.unit, domain: spec.domain,
        level: spec.level, criterion: spec.criterion, level_criteria: spec.levelCriteria,
        canonical_sentence: spec.canonicalSentence, target_count: COMMENT_POOL_TARGET,
        generator_version: `${COMMENT_POOL_GENERATOR_VERSION}-refresh`, created_by: user.id,
        updated_at: new Date().toISOString(),
      }]))[0];
      const jobs = await insertRows<{ id: string }>("generation_jobs", [{
        owner_id: user.id, owner_email: user.email, class_id: classId, job_type: "comment-pools",
        status: "queued", batches: [{
          spec, poolVersionId: Number(version.id), maxAttempts: 2, activateWhenReady: true,
          previousPoolVersionIds,
        }], current_batch: 0, total_batches: 1, total_items: 1, completed_items: 0,
        failed_items: 0, error_message: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }]);
      queueRunner(request, jobs[0].id);
      return Response.json({ jobId: jobs[0].id, subject: subject || "전체", total: 1, maxAiCalls: 2, reused: 0, refresh: true }, { status: 202 });
    }
    const currentSentences = await approvedSentencesByVersion([...currentLinked.versionById.keys()]);
    const reusableVersionFor = (spec: (typeof specs)[number]) => currentLinked.links
      .filter((link) => Number(link.assessment_plan_id) === spec.assessmentPlanId)
      .map((link) => currentLinked.versionById.get(Number(link.pool_version_id)))
      .find((version): version is PoolVersionRow => Boolean(
        version
        && versionMatchesSpec(version, spec)
        && commentPoolQuality(currentSentences.get(Number(version.id)) ?? [], spec.canonicalSentence).reusable,
      ));
    const specsToCreate = specs.filter((spec) => !reusableVersionFor(spec));
    if (!specsToCreate.length) return Response.json({ ready: true, reused: specs.length });
    const versions = await upsertRows<PoolVersionRow>("comment_pool_versions", specsToCreate.map((spec) => ({
      fingerprint: spec.fingerprint, subject: spec.subject, unit: spec.unit, domain: spec.domain,
      level: spec.level, criterion: spec.criterion, level_criteria: spec.levelCriteria,
      canonical_sentence: spec.canonicalSentence, target_count: COMMENT_POOL_TARGET,
      generator_version: COMMENT_POOL_GENERATOR_VERSION, created_by: user.id, updated_at: new Date().toISOString(),
    })), "fingerprint");
    const byFingerprint = new Map(versions.map((row) => [row.fingerprint, row]));
    const sentencesByVersion = await approvedSentencesByVersion(versions.map((version) => Number(version.id)));
    await upsertRows("assessment_plan_pool_links", specsToCreate.flatMap((spec) => {
      const version = byFingerprint.get(spec.fingerprint);
      return version ? [{
        owner_id: user.id, owner_email: user.email, class_id: classId,
        assessment_plan_id: spec.assessmentPlanId, pool_version_id: Number(version.id),
      }] : [];
    }), "owner_id,class_id,assessment_plan_id,pool_version_id");
    let freeCompleted = 0;
    for (const spec of specsToCreate) {
      const version = byFingerprint.get(spec.fingerprint);
      if (!version) continue;
      const versionId = Number(version.id);
      const existing = sentencesByVersion.get(versionId) ?? [];
      if (!existing.length || commentPoolQuality(existing, spec.canonicalSentence).reusable) continue;
      const fallbacks = buildValidatedMinimumPoolFallbacks(spec, existing);
      if (!fallbacks.length) continue;
      await upsertRows("comment_pool_sentences", fallbacks.map((sentence) => ({
        pool_version_id: versionId, sentence, normalized_sentence: normalizedPoolSentence(sentence),
        status: "approved", source: "canonical", updated_at: new Date().toISOString(),
      })), "pool_version_id,normalized_sentence");
      const completedSentences = [...existing, ...fallbacks].slice(0, COMMENT_POOL_TARGET);
      sentencesByVersion.set(versionId, completedSentences);
      const quality = commentPoolQuality(completedSentences, spec.canonicalSentence);
      await updateRows("comment_pool_versions", { id: eq(versionId) }, {
        status: quality.reusable ? "ready" : "usable", approved_count: completedSentences.length,
        updated_at: new Date().toISOString(),
      });
      if (quality.reusable) freeCompleted += 1;
    }
    const pending = specsToCreate.flatMap((spec) => {
      const version = byFingerprint.get(spec.fingerprint);
      const quality = commentPoolQuality(version ? (sentencesByVersion.get(Number(version.id)) ?? []) : [], spec.canonicalSentence);
      return version && !quality.reusable
        ? [{ spec, poolVersionId: Number(version.id), maxAttempts: canonicalOnly ? 0 : 2 }]
        : [];
    }).slice(0, maxGroups);
    if (!pending.length) return Response.json({ ready: true, reused: specs.length });
    if (freeFallbackOnly) {
      return Response.json({ ready: false, needsAi: pending.length, freeCompleted, reused: specs.length - pending.length });
    }
    const jobs = await insertRows<{ id: string }>("generation_jobs", [{
      owner_id: user.id, owner_email: user.email, class_id: classId, job_type: "comment-pools",
      status: "queued", batches: pending, current_batch: 0, total_batches: pending.length,
      total_items: pending.length, completed_items: 0, failed_items: 0, error_message: "",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }]);
    queueRunner(request, jobs[0].id);
    return Response.json({ jobId: jobs[0].id, subject: subject || "전체", total: pending.length, maxAiCalls: pending.reduce((sum, batch) => sum + batch.maxAttempts, 0), reused: specs.length - pending.length }, { status: 202 });
  } catch (error) {
    return dataError(error, "AI 평어 제작을 시작하지 못했습니다.");
  }
}
