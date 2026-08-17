import { primaryAiModel } from "./ai-model-policy.ts";
import { commentEvidenceInstructions, commentLengthTarget, ensureGeneratedCommentPeriod, evidenceBlockingIssues, evidenceGroundingWarnings, validateGeneratedCommentPart } from "./comment-generation-policy.ts";
import type { AiTokenUsage } from "./ai-usage.ts";
import type { CommentEvidence, CommentEvidenceItem, CommentBatchResult, GeneratedCommentPart, GeneratedCommentRejection } from "./comment-generation.ts";
import { createCommentVariations, type CommentVariation } from "./comment-variation.ts";

type PoolMember = {
  studentId: number;
  subject: string;
  item: CommentEvidenceItem;
  variation?: CommentVariation;
};

export type CommentPoolGroup = {
  poolId: string;
  subject: string;
  assessmentIndex: number;
  level: string;
  evidence: string;
  criterion: string;
  members: PoolMember[];
};

const normalizedSentence = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").replace(/[.!?。！？]/g, "");

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("").trim();
}

export function buildCommentPoolGroups(evidence: CommentEvidence[]): CommentPoolGroup[] {
  const groups = new Map<string, Omit<CommentPoolGroup, "poolId">>();
  for (const entry of evidence) {
    for (const item of entry.items) {
      const criterion = item.criterion ?? item.text;
      const key = JSON.stringify([entry.subject, item.assessmentIndex, item.level ?? "", item.text, criterion]);
      const member = {
        studentId: entry.studentId,
        subject: entry.subject,
        item,
        variation: entry.itemVariations?.[item.assessmentIndex] ?? entry.variation,
      };
      const current = groups.get(key);
      if (current) current.members.push(member);
      else groups.set(key, {
        subject: entry.subject,
        assessmentIndex: item.assessmentIndex,
        level: item.level ?? "",
        evidence: item.text,
        criterion,
        members: [member],
      });
    }
  }
  return [...groups.values()].map((group, index) => {
    const members = [...group.members].sort((left, right) => left.studentId - right.studentId);
    const variations = createCommentVariations(members.length);
    return {
      ...group,
      poolId: `pool${index + 1}`,
      members: members.map((member, memberIndex) => ({ ...member, variation: variations[memberIndex] })),
    };
  });
}

export function buildPublicCommentPoolRequests(groups: CommentPoolGroup[]) {
  return groups.map((group) => ({
    poolId: group.poolId,
    subject: group.subject,
    assessmentIndex: group.assessmentIndex,
    level: group.level,
    evidence: group.evidence,
    criterion: group.criterion,
    levelRules: commentEvidenceInstructions(group.criterion).instruction,
    lengthTarget: commentLengthTarget(group.criterion).label,
    requiredCount: group.members.length,
    variantPlans: group.members.map((member, index) => ({ variant: index + 1, ...member.variation })),
  }));
}

export function assignUniquePoolCandidates(group: CommentPoolGroup, rawCandidates: string[], referenceCandidates: string[] = []) {
  const issues = new Set<string>();
  const validated = rawCandidates.flatMap((candidate, index) => {
    const text = ensureGeneratedCommentPeriod(candidate);
    const format = validateGeneratedCommentPart(text, group.criterion);
    if (!format.valid) {
      issues.add("문장 형식 또는 명사형 종결 검수 미통과");
      return [];
    }
    const blocking = evidenceBlockingIssues(text, group.evidence, group.criterion);
    if (blocking.length) {
      blocking.forEach((issue) => issues.add(issue));
      return [];
    }
    return [{
      studentId: index + 1,
      subject: group.subject,
      assessmentIndex: group.assessmentIndex,
      evidence: group.evidence,
      text,
    }];
  });
  const seen = new Set<string>();
  const referenceKeys = new Set(referenceCandidates.map(normalizedSentence).filter(Boolean));
  const deduplicated = validated.filter((candidate) => {
    const key = normalizedSentence(candidate.text);
    if (!key || seen.has(key) || referenceKeys.has(key)) {
      issues.add("완전히 같은 문장 후보 중복");
      return false;
    }
    seen.add(key);
    return true;
  });
  // 구조 유사도는 저장 차단 사유가 아니다. 동일한 평가기준에서는 근거를
  // 보존할수록 문장 구조가 닮을 수 있으므로, 아래 후보는 우선 저장하고
  // 작업 후반의 다양성 검사에서 겹친 영역만 한 번 재생성하거나 경고한다.
  return { candidates: deduplicated.map((candidate) => candidate.text), issues: [...issues] };
}

export async function generateCommentPoolBatch(
  evidence: CommentEvidence[],
  avoidComments: string[] = [],
  repair = false,
  model = primaryAiModel(),
): Promise<CommentBatchResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI 생성 설정이 아직 완료되지 않았습니다.");
  const groups = buildCommentPoolGroups(evidence);
  const poolSchemas = Object.fromEntries(groups.map((group) => [group.poolId, {
    type: "object",
    additionalProperties: false,
    required: ["poolId", "candidates"],
    properties: {
      poolId: { type: "string", enum: [group.poolId] },
      candidates: {
        type: "array",
        minItems: group.members.length,
        maxItems: group.members.length,
        items: { type: "string" },
      },
    },
  }]));
  const requestPools = buildPublicCommentPoolRequests(groups);
  const avoidSentences = [...new Set(avoidComments.flatMap((comment) => comment.split(/(?<=[.!?])\s+/))
    .map((item) => item.trim()).filter(Boolean))].slice(0, 50);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "none" },
      store: false,
      max_output_tokens: 10000,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "당신은 초등학교 학교생활기록부 교과 평어의 검증 문장 풀을 작성한다. 학생 개인정보나 학생별 결과를 작성하지 않는다. 각 pool은 하나의 과목·평가영역·평가수준·평가기준에 대응한다. requiredCount만큼 서로 다른 완성 문장을 정확히 작성한다. 모든 후보는 동일한 평가기준의 필수 수행 요소와 수준 의미를 빠짐없이 보존하되 평가기준에 없는 활동·태도·도움·정확성·적극성·수식어를 추가하지 않는다. 상·중·하는 각각 잘함·보통·노력 요함에 대응하지만 실제 표현은 전달된 criterion만 근거로 한다. variantPlans는 사실을 추가하는 지시가 아니라 시작 방식·어순·동사 위치·문장 구조·명사형 종결을 서로 다르게 만드는 설계표이다. 후보끼리 완전히 같은 문장, 같은 첫 구절, 같은 문장 뼈대를 반복하지 않는다. 수행 대상과 동사의 관계를 바꾸지 않는다. 예를 들어 문장을 나누고 자료 내용을 표현한다는 기준을 자료 내용을 나눈다고 바꾸지 않는다. 각 문장은 자연스러운 관찰 기반 명사형 종결과 마침표로 끝낸다. 함·음·임·뛰어남·돋보임·인상적임 같은 자연스러운 명사형은 허용하지만 하였다·합니다·입니다·할 수 있다 같은 서술형은 사용하지 않는다. 길이는 목표일 뿐이며 사실성과 자연스러움을 우선한다. 제목·번호·설명은 출력하지 않는다." }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: `${repair ? "이전 생성에서 고유하거나 검증된 후보가 부족했다. 부족한 후보 수만큼 새로운 문장을 작성한다." : "각 문장 풀을 작성한다."}\n문장 풀 요청: ${JSON.stringify(requestPools)}\n이미 사용했으므로 그대로 쓰지 않을 문장: ${JSON.stringify(avoidSentences)}` }],
        },
      ],
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "comment_sentence_pools",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["pools"],
            properties: {
              pools: {
                type: "object",
                additionalProperties: false,
                required: groups.map((group) => group.poolId),
                properties: poolSchemas,
              },
            },
          },
        },
      },
    }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const upstream = payload && typeof payload === "object"
      ? (payload as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
    const code = typeof upstream?.code === "string" ? upstream.code : `HTTP ${response.status}`;
    const message = typeof upstream?.message === "string" ? upstream.message.slice(0, 600) : "";
    throw new Error(`AI 생성 요청을 처리하지 못했습니다. (${code})${message ? ` ${message}` : ""}`);
  }
  const raw = extractOutputText(payload).replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const decoded = JSON.parse(raw) as { pools?: Record<string, { candidates?: unknown }> };
  const parts: GeneratedCommentPart[] = [];
  const rejections: GeneratedCommentRejection[] = [];
  for (const group of groups) {
    const poolCandidates = decoded.pools?.[group.poolId]?.candidates;
    const rawCandidates = Array.isArray(poolCandidates)
      ? poolCandidates.filter((item): item is string => typeof item === "string")
      : [];
    const assigned = assignUniquePoolCandidates(group, rawCandidates, avoidSentences);
    group.members.forEach((member, index) => {
      const text = assigned.candidates[index];
      if (!text) {
        rejections.push({
          studentId: member.studentId,
          subject: member.subject,
          assessmentIndex: member.item.assessmentIndex,
          issues: assigned.issues.length ? assigned.issues : ["검증된 고유 문장 후보 부족"],
        });
        return;
      }
      parts.push({
        studentId: member.studentId,
        subject: member.subject,
        assessmentIndex: member.item.assessmentIndex,
        evidence: member.item.text,
        text,
        warnings: evidenceGroundingWarnings(text, member.item.text),
      });
    });
  }
  const responseUsage = payload && typeof payload === "object"
    ? (payload as { usage?: { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } } }).usage
    : undefined;
  const usage: AiTokenUsage = {
    model,
    inputTokens: Number(responseUsage?.input_tokens) || 0,
    cachedInputTokens: Number(responseUsage?.input_tokens_details?.cached_tokens) || 0,
    outputTokens: Number(responseUsage?.output_tokens) || 0,
    totalTokens: Number(responseUsage?.total_tokens) || 0,
  };
  return { comments: [], parts, rejections, usage };
}
