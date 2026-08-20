import { waitUntil } from "@vercel/functions";
import { eq, selectRows, updateRows } from "../../../../db/supabase";
import { selectMostDiverseComments } from "../../../comment-diversity";
import { CommentEvidence, GeneratedComment, GeneratedCommentPart, saveGeneratedCommentParts, saveGeneratedComments, signCommentJob, verifyCommentJob } from "../../../comment-generation";
import { assignApprovedCommentPools } from "../../../comment-pool-generation";
import { assembleRotatedComment } from "../../../comment-assembly";

export const maxDuration = 300;

type JobRow = {
  id: string;
  owner_id: string;
  owner_email: string;
  class_id: number;
  status: string;
  batches: CommentEvidence[][];
  current_batch: number;
  total_batches: number;
  total_items: number;
  completed_items: number;
  failed_items: number;
  error_message: string;
  started_at: string | null;
  updated_at: string;
};

function queueNext(request: Request, jobId: string) {
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

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { jobId?: unknown; signature?: unknown };
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!jobId || !verifyCommentJob(jobId, signature)) {
    return Response.json({ error: "허용되지 않은 작업 요청입니다." }, { status: 403 });
  }

  const job = (await selectRows<JobRow>("generation_jobs", { id: eq(jobId), limit: 1 }))[0];
  if (!job) return Response.json({ ok: true, terminal: true });
  const lockAge = Date.now() - Date.parse(job.updated_at);
  if (job.status === "running" && lockAge < 360_000) {
    return Response.json({ ok: true, terminal: false, busy: true });
  }
  if (!["queued", "running"].includes(job.status)) return Response.json({ ok: true, terminal: true });
  const batchIndex = Number(job.current_batch);
  const batch = job.batches[batchIndex];
  if (!batch?.length) {
    await updateRows("generation_jobs", { id: eq(jobId) }, {
      status: job.failed_items ? "completed_with_errors" : "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return Response.json({ ok: true, terminal: true });
  }

  const claimed = await updateRows<JobRow>("generation_jobs", {
    id: eq(jobId), status: eq(job.status), updated_at: eq(job.updated_at),
  }, {
    status: "running",
    started_at: job.started_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (!claimed[0]) return Response.json({ ok: true, terminal: false, busy: true });

  let comments: GeneratedComment[] = [];
  const generatedParts = new Map<string, GeneratedCommentPart>();
  let errorMessage = "";
  let pending = batch;
  const subject = batch[0]?.subject ?? "";
  const batchStudentIds = new Set(batch.map((item) => item.studentId));
  const savedParts = subject ? await selectRows<{
    student_id: number; subject: string; assessment_index: number; evidence: string; sentence: string; status: string; issues: string[];
  }>("generated_comment_parts", {
    owner_id: eq(job.owner_id), class_id: eq(job.class_id), subject: eq(subject),
  }) : [];
  for (const saved of savedParts) {
    if (!batchStudentIds.has(Number(saved.student_id)) || !["complete", "warning"].includes(saved.status) || !saved.sentence) continue;
    const studentEvidence = batch.find((item) => item.studentId === Number(saved.student_id));
    if (studentEvidence?.forceRegenerateItems === true
      && studentEvidence.items.some((item) => item.assessmentIndex === Number(saved.assessment_index))) continue;
    const expected = (studentEvidence?.subjectItems ?? studentEvidence?.items ?? [])
      .find((item) => item.assessmentIndex === Number(saved.assessment_index));
    if (!expected || expected.text !== saved.evidence) continue;
    generatedParts.set(`${saved.student_id}|${saved.subject}|${saved.assessment_index}`, {
      studentId: Number(saved.student_id), subject: saved.subject,
      assessmentIndex: Number(saved.assessment_index), evidence: saved.evidence,
      text: saved.sentence, warnings: Array.isArray(saved.issues) ? saved.issues : [],
    });
  }
  pending = batch.flatMap((item) => {
    // 기존 저장 결과가 없는 영역은 학생별 생성이 아니라
    // 평가영역·수준별 공용 문장 풀 생성 대상으로 보낸다.
    const missingItems = item.items.filter((evidenceItem) =>
      !generatedParts.has(`${item.studentId}|${item.subject}|${evidenceItem.assessmentIndex}`));
    return missingItems.length ? [{ ...item, items: missingItems }] : [];
  });
  const existingComments = subject ? await selectRows<{ student_id: number; comment: string }>("generated_comments", {
    owner_id: eq(job.owner_id), class_id: eq(job.class_id), subject: eq(subject),
  }) : [];
  const avoidComments = existingComments
    .filter((item) => !batchStudentIds.has(Number(item.student_id)))
    .map((item) => item.comment)
    .filter(Boolean);
  // 학생 평어 생성 단계에서는 OpenAI를 호출하지 않는다. 평가계획 관리에서
  // 미리 제작·검수해 둔 영역·수준별 승인 문장만 읽어 순환 배정한다.
  const fingerprints = [...new Set(pending.flatMap((entry) => entry.items
    .map((item) => item.poolFingerprint)
    .filter((value): value is string => Boolean(value))))];
  const poolVersions = fingerprints.length ? await selectRows<{ id: number; fingerprint: string }>("comment_pool_versions", {
    fingerprint: `in.(${fingerprints.join(",")})`,
  }) : [];
  const versionIds = poolVersions.map((pool) => Number(pool.id));
  const poolSentences = versionIds.length ? await selectRows<{ pool_version_id: number; sentence: string }>("comment_pool_sentences", {
    pool_version_id: `in.(${versionIds.join(",")})`, status: eq("approved"), order: "id.asc",
  }) : [];
  const versionByFingerprint = new Map(poolVersions.map((pool) => [pool.fingerprint, Number(pool.id)]));
  const sentencesByVersion = new Map<number, string[]>();
  for (const row of poolSentences) {
    const sentences = sentencesByVersion.get(Number(row.pool_version_id)) ?? [];
    if (row.sentence) sentences.push(row.sentence);
    sentencesByVersion.set(Number(row.pool_version_id), sentences);
  }
  const jobOffset = [...jobId].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const groupIndexes = new Map<string, number>();
  const assignedParts: Array<GeneratedCommentPart & { attempts: number; status: "complete"; issues: string[] }> = [];
  for (const entry of [...pending].sort((left, right) => left.studentId - right.studentId)) {
    for (const item of entry.items) {
      const versionId = item.poolFingerprint ? versionByFingerprint.get(item.poolFingerprint) : undefined;
      const candidates = versionId ? (sentencesByVersion.get(versionId) ?? []) : [];
      if (!candidates.length) continue;
      const group = item.poolFingerprint ?? `${entry.subject}|${item.assessmentIndex}|${item.level}`;
      const index = groupIndexes.get(group) ?? 0;
      groupIndexes.set(group, index + 1);
      const text = candidates[(jobOffset + index + item.assessmentIndex) % candidates.length];
      const part: GeneratedCommentPart = {
        studentId: entry.studentId,
        subject: entry.subject,
        assessmentIndex: item.assessmentIndex,
        evidence: item.text,
        text,
        warnings: [],
      };
      generatedParts.set(`${entry.studentId}|${entry.subject}|${item.assessmentIndex}`, part);
      assignedParts.push({ ...part, attempts: 1, status: "complete", issues: [] });
    }
  }
  if (assignedParts.length) {
    await saveGeneratedCommentParts({ ownerId: job.owner_id, ownerEmail: job.owner_email, classId: Number(job.class_id), parts: assignedParts });
  }
  pending = batch.flatMap((item) => {
    const missingItems = item.items.filter((evidenceItem) =>
      !generatedParts.has(`${item.studentId}|${item.subject}|${evidenceItem.assessmentIndex}`));
    return missingItems.length ? [{ ...item, items: missingItems }] : [];
  });

  // 모든 문장 풀 생성·검수 뒤에도 후보가 0개인 그룹만 평가기준에서 만든
  // 기준문장으로 채운다. 다양성보다 완전성을 우선하여 빈칸은 남기지 않는다.
  const fallbackParts: Array<GeneratedCommentPart & { attempts: number; status: "warning"; issues: string[] }> = [];
  for (const fallback of assignApprovedCommentPools(pending)) {
    const key = `${fallback.studentId}|${fallback.subject}|${fallback.assessmentIndex}`;
    if (generatedParts.has(key)) continue;
    const warning = "검증된 문장 풀 후보가 없어 평가기준 문장을 재사용함";
    const reused = { ...fallback, warnings: [warning] };
    generatedParts.set(key, reused);
    fallbackParts.push({ ...reused, attempts: 1, status: "warning", issues: [warning] });
  }
  if (fallbackParts.length) {
    await saveGeneratedCommentParts({
      ownerId: job.owner_id,
      ownerEmail: job.owner_email,
      classId: Number(job.class_id),
      parts: fallbackParts,
    });
  }

  comments = batch.flatMap((item) => {
    const available = (item.subjectItems ?? item.items).flatMap((evidenceItem) => {
      const text = generatedParts.get(`${item.studentId}|${item.subject}|${evidenceItem.assessmentIndex}`)?.text ?? "";
      return text ? [{ assessmentIndex: evidenceItem.assessmentIndex, text }] : [];
    });
    const assembled = assembleRotatedComment(available, item.studentId);
    return assembled
      ? [{
          studentId: item.studentId,
          subject: item.subject,
          comment: assembled,
          candidates: [assembled],
          generationLevels: (item.subjectItems ?? item.items).map((entry) => ({
            assessmentIndex: entry.assessmentIndex,
            level: entry.level ?? "-",
          })),
        }]
      : [];
  });
  comments = selectMostDiverseComments(comments, avoidComments)
    .map((item) => ({ ...item, candidates: item.candidates.slice(0, 1) }));
  const cancelledBeforeSave = (await selectRows<{ status: string }>("generation_jobs", { id: eq(jobId), limit: 1 }))[0]?.status === "cancelled";
  if (cancelledBeforeSave) {
    return Response.json({ ok: true, terminal: true, cancelled: true });
  }
  const unresolvedParts = batch.flatMap((item) => item.items.flatMap((evidenceItem) => {
    const key = `${item.studentId}|${item.subject}|${evidenceItem.assessmentIndex}`;
    return generatedParts.has(key) ? [] : [{
      studentId: item.studentId,
      subject: item.subject,
      assessmentIndex: evidenceItem.assessmentIndex,
      evidence: evidenceItem.text,
      text: "",
      warnings: [],
      attempts: MAX_GENERATION_ATTEMPTS,
      status: "needs_review" as const,
      issues: rejectionIssues.has(key)
        ? [...rejectionIssues.get(key)!]
        : ["AI가 해당 평가 영역의 문장을 반환하지 않아 교사 확인이 필요함"],
    }];
  }));
  if (unresolvedParts.length) {
    await saveGeneratedCommentParts({
      ownerId: job.owner_id,
      ownerEmail: job.owner_email,
      classId: Number(job.class_id),
      parts: unresolvedParts,
    });
  }
  if (comments.length) {
    await saveGeneratedComments({
      ownerId: job.owner_id,
      ownerEmail: job.owner_email,
      classId: Number(job.class_id),
      comments,
    });
  }

  const failedInBatch = batch.filter((item) => item.items.some((evidenceItem) =>
    !generatedParts.has(`${item.studentId}|${item.subject}|${evidenceItem.assessmentIndex}`))).length;
  const nextBatch = batchIndex + 1;
  const failedItems = Number(job.failed_items) + failedInBatch;
  const completedItems = Number(job.completed_items) + batch.length - failedInBatch;
  if (failedItems) {
    errorMessage = `${subject} 평어 ${completedItems}/${job.total_items}개 영역 저장 완료 · ${failedItems}개 영역 확인 필요`;
  }
  const terminal = nextBatch >= Number(job.total_batches);
  const latestStatus = (await selectRows<{ status: string }>("generation_jobs", { id: eq(jobId), limit: 1 }))[0]?.status;
  if (latestStatus === "cancelled") {
    return Response.json({ ok: true, terminal: true, cancelled: true, completedItems, failedItems });
  }
  await updateRows("generation_jobs", { id: eq(jobId) }, {
    status: terminal ? (failedItems ? "completed_with_errors" : "completed") : "queued",
    current_batch: nextBatch,
    completed_items: completedItems,
    failed_items: failedItems,
    error_message: failedItems ? (errorMessage || job.error_message) : "",
    completed_at: terminal ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  if (!terminal) queueNext(request, jobId);
  return Response.json({ ok: true, terminal, completedItems, failedItems });
}
