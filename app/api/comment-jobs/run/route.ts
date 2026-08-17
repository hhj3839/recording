import { waitUntil } from "@vercel/functions";
import { eq, selectRows, updateRows } from "../../../../db/supabase";
import { getAiUsage, MONTHLY_AI_LIMIT, recordAiUsage } from "../../../ai-usage";
import { selectMostDiverseComments } from "../../../comment-diversity";
import { CommentEvidence, GeneratedComment, GeneratedCommentPart, saveGeneratedCommentParts, saveGeneratedComments, signCommentJob, verifyCommentJob } from "../../../comment-generation";
import { generateCommentPoolBatch } from "../../../comment-pool-generation";
import { generationModel } from "../../../ai-model-policy";
import { batchCommentRepairs, MAX_COMMENT_AI_CALLS_PER_BATCH, MAX_COMMENT_DIVERSITY_CALLS_PER_BATCH } from "../../../comment-batching";
import { CommentAreaPart, findCommentAreaOverlaps } from "../../../comment-area-diversity";

export const maxDuration = 300;
const MAX_GENERATION_ATTEMPTS = 4;

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
  const generatedThisRun = new Set<string>();
  const rejectionIssues = new Map<string, Set<string>>();
  let errorMessage = "";
  let pending = batch;
  let nonRetryableFailure = false;
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
  let aiCallCount = 0;
  let callLimitReached = false;
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS && pending.length; attempt += 1) {
    const usage = await getAiUsage(job.owner_id);
    if (usage.monthly >= MONTHLY_AI_LIMIT) {
      errorMessage = `월 AI 요청 한도 ${MONTHLY_AI_LIMIT}회를 사용하여 남은 항목의 자동 재시도를 중단했습니다.`;
      break;
    }
    const groups = attempt === 0
      ? [pending]
      : batchCommentRepairs(pending);
    for (const group of groups) {
      if (aiCallCount >= MAX_COMMENT_AI_CALLS_PER_BATCH) {
        callLimitReached = true;
        errorMessage = `이 생성 묶음의 AI 요청 상한 ${MAX_COMMENT_AI_CALLS_PER_BATCH}회에 도달하여 남은 영역은 빈칸으로 두었습니다.`;
        break;
      }
      const groupUsage = await getAiUsage(job.owner_id);
      if (groupUsage.monthly >= MONTHLY_AI_LIMIT) {
        errorMessage = `월 AI 요청 한도 ${MONTHLY_AI_LIMIT}회를 사용하여 남은 항목의 자동 재시도를 중단했습니다.`;
        break;
      }
      aiCallCount += 1;
      try {
        const generated = await generateCommentPoolBatch(
          group,
          // 제한된 금지 문장 목록에는 방금 생성·저장한 문장을 먼저 넣어
          // 현재 학급 작업 안의 중복 방지가 과거 기록 때문에 잘리지 않게 한다.
          [...[...generatedParts.values()].map((item) => item.text), ...avoidComments],
          attempt > 0,
          generationModel(attempt, MAX_GENERATION_ATTEMPTS),
          attempt === MAX_GENERATION_ATTEMPTS - 1,
        );
        for (const part of generated.parts) {
          const key = `${part.studentId}|${part.subject}|${part.assessmentIndex}`;
          generatedParts.set(key, part);
          generatedThisRun.add(key);
          rejectionIssues.delete(key);
        }
        for (const rejection of generated.rejections) {
          const key = `${rejection.studentId}|${rejection.subject}|${rejection.assessmentIndex}`;
          const issues = rejectionIssues.get(key) ?? new Set<string>();
          rejection.issues.forEach((issue) => issues.add(issue));
          rejectionIssues.set(key, issues);
        }
        await saveGeneratedCommentParts({
          ownerId: job.owner_id,
          ownerEmail: job.owner_email,
          classId: Number(job.class_id),
          parts: generated.parts.map((part) => ({ ...part, attempts: attempt + 1 })),
        });
        await recordAiUsage({
          ownerId: job.owner_id, ownerEmail: job.owner_email, classId: Number(job.class_id),
          feature: `all-comments-attempt-${attempt + 1}`,
          ...generated.usage,
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "AI 생성 오류";
        nonRetryableFailure = errorMessage.includes("(insufficient_quota)")
          || errorMessage.includes("(invalid_api_key)")
          || errorMessage.includes("(model_not_found)");
        await recordAiUsage({
          ownerId: job.owner_id, ownerEmail: job.owner_email, classId: Number(job.class_id),
          feature: `all-comments-attempt-${attempt + 1}`,
          model: generationModel(attempt, MAX_GENERATION_ATTEMPTS),
        });
      }
      if (nonRetryableFailure) break;
    }
    pending = batch.flatMap((item) => {
      const missingItems = item.items.filter((evidenceItem) =>
        !generatedParts.has(`${item.studentId}|${item.subject}|${evidenceItem.assessmentIndex}`));
      return missingItems.length ? [{ ...item, items: missingItems }] : [];
    });
    if (nonRetryableFailure || callLimitReached) break;
  }

  const diversityCandidates = [...generatedParts.entries()]
    .filter(([key]) => generatedThisRun.has(key))
    .map(([, part]) => part satisfies CommentAreaPart);
  const diversityReferences = savedParts.flatMap((saved) => {
    const key = `${saved.student_id}|${saved.subject}|${saved.assessment_index}`;
    return generatedThisRun.has(key) || !saved.sentence ? [] : [{
      studentId: Number(saved.student_id), subject: saved.subject,
      assessmentIndex: Number(saved.assessment_index), evidence: saved.evidence, text: saved.sentence,
    } satisfies CommentAreaPart];
  });
  const overlaps = findCommentAreaOverlaps({ candidates: diversityCandidates, references: diversityReferences });
  const overlapKeys = new Set(overlaps.map((item) => item.key));
  const diversityTargets = batch.flatMap((item) => {
    const items = item.items.filter((entry) => overlapKeys.has(`${item.studentId}|${item.subject}|${entry.assessmentIndex}`));
    return items.length ? [{ ...item, items }] : [];
  });
  if (diversityTargets.length && MAX_COMMENT_DIVERSITY_CALLS_PER_BATCH > 0) {
    const markDiversityReview = async (message: string) => {
      const reviewParts = [...overlapKeys].flatMap((key) => {
        const current = generatedParts.get(key);
        if (!current) return [];
        const updated = { ...current, warnings: [...new Set([...current.warnings, message])] };
        generatedParts.set(key, updated);
        return [{ ...updated, attempts: Math.max(1, aiCallCount), status: "warning" as const, issues: updated.warnings }];
      });
      if (reviewParts.length) {
        await saveGeneratedCommentParts({
          ownerId: job.owner_id, ownerEmail: job.owner_email, classId: Number(job.class_id), parts: reviewParts,
        });
      }
    };
    const usage = await getAiUsage(job.owner_id);
    if (aiCallCount >= MAX_COMMENT_AI_CALLS_PER_BATCH || usage.monthly >= MONTHLY_AI_LIMIT) {
      await markDiversityReview("같은 평가영역·수준에서 유사한 표현이 있어 교사 확인이 필요함");
    } else {
      aiCallCount += 1;
      const fixedReferences = [
        ...diversityReferences,
        ...diversityCandidates.filter((part) => !overlapKeys.has(`${part.studentId}|${part.subject}|${part.assessmentIndex}`)),
      ];
      try {
        const regenerated = await generateCommentPoolBatch(
          diversityTargets,
          [
            ...fixedReferences.map((part) => part.text),
            ...diversityCandidates.map((part) => part.text),
            ...avoidComments,
          ],
          true,
          generationModel(1, MAX_GENERATION_ATTEMPTS),
        );
        const returnedKeys = new Set(regenerated.parts.map((part) => `${part.studentId}|${part.subject}|${part.assessmentIndex}`));
        const remainingOverlaps = findCommentAreaOverlaps({ candidates: regenerated.parts, references: fixedReferences });
        const remainingKeys = new Set(remainingOverlaps.map((item) => item.key));
        const repairedParts = regenerated.parts.map((part) => {
          const key = `${part.studentId}|${part.subject}|${part.assessmentIndex}`;
          return remainingKeys.has(key)
            ? { ...part, warnings: [...new Set([...part.warnings, "재생성 후에도 유사한 표현이 있어 교사 확인이 필요함"])] }
            : part;
        });
        for (const part of repairedParts) {
          generatedParts.set(`${part.studentId}|${part.subject}|${part.assessmentIndex}`, part);
        }
        for (const key of overlapKeys) {
          if (returnedKeys.has(key)) continue;
          const current = generatedParts.get(key);
          if (current) generatedParts.set(key, {
            ...current, warnings: [...new Set([...current.warnings, "유사 표현 재생성이 완료되지 않아 교사 확인이 필요함"])],
          });
        }
        const savedRepairs = [...overlapKeys].flatMap((key) => {
          const part = generatedParts.get(key);
          return part ? [{
            ...part, attempts: aiCallCount,
            status: part.warnings.length ? "warning" as const : "complete" as const,
            issues: part.warnings,
          }] : [];
        });
        await saveGeneratedCommentParts({
          ownerId: job.owner_id, ownerEmail: job.owner_email, classId: Number(job.class_id), parts: savedRepairs,
        });
        await recordAiUsage({
          ownerId: job.owner_id, ownerEmail: job.owner_email, classId: Number(job.class_id),
          feature: "all-comments-diversity-retry", ...regenerated.usage,
        });
      } catch {
        await markDiversityReview("유사 표현 재생성이 완료되지 않아 교사 확인이 필요함");
        await recordAiUsage({
          ownerId: job.owner_id, ownerEmail: job.owner_email, classId: Number(job.class_id),
          feature: "all-comments-diversity-retry", model: generationModel(1, MAX_GENERATION_ATTEMPTS),
        });
      }
    }
  }
  comments = batch.flatMap((item) => {
    const sentences = (item.subjectItems ?? item.items).map((evidenceItem) =>
      generatedParts.get(`${item.studentId}|${item.subject}|${evidenceItem.assessmentIndex}`)?.text ?? "");
    const available = sentences.filter(Boolean);
    return available.length
      ? [{
          studentId: item.studentId,
          subject: item.subject,
          comment: available.join(" "),
          candidates: [available.join(" ")],
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
  if (failedInBatch) {
    const detail = `${subject} 평가영역 배치 ${batchIndex + 1}: ${failedInBatch}개 문장이 생성 후에도 검수를 통과하지 못해 확인 필요로 표시했습니다. 성공한 문장은 저장되었습니다.`;
    errorMessage = [job.error_message, errorMessage, detail].filter(Boolean).join(" ").slice(-1800);
  }
  const nextBatch = batchIndex + 1;
  const failedItems = Number(job.failed_items) + failedInBatch;
  const completedItems = Number(job.completed_items) + batch.length - failedInBatch;
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
