import { primaryAiModel } from "./ai-model-policy.ts";
import { commentEvidenceInstructions, commentLengthTarget, commentPredicatePolicy, criterionSemanticIssues, levelAppropriatenessIssues, positiveGrowthCriterion, repairSafeNominalEnding, evidenceBlockingIssues, evidenceGroundingWarnings, validateGeneratedCommentPart } from "./comment-generation-policy.ts";
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
  levelCriteria?: CommentEvidenceItem["levelCriteria"];
  repairIssues: string[];
  members: PoolMember[];
};

const normalizedSentence = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").replace(/[.!?。！？]/g, "");

export function commentPoolCandidateCount(requiredCount: number) {
  if (!Number.isInteger(requiredCount) || requiredCount < 1) return 0;
  if (requiredCount <= 5) return requiredCount + 2;
  const reserveRate = requiredCount <= 10 ? 0.3 : 0.2;
  return requiredCount + Math.ceil(requiredCount * reserveRate);
}

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("").trim();
}

export function buildCommentPoolGroups(evidence: CommentEvidence[], isolateMembers = false): CommentPoolGroup[] {
  const groups = new Map<string, Omit<CommentPoolGroup, "poolId">>();
  for (const entry of evidence) {
    for (const item of entry.items) {
      const criterion = positiveGrowthCriterion(item.level, item.criterion ?? item.text);
      const key = JSON.stringify([entry.subject, item.assessmentIndex, item.level ?? "", item.text, criterion, isolateMembers ? entry.studentId : ""]);
      const member = {
        studentId: entry.studentId,
        subject: entry.subject,
        item,
        variation: entry.itemVariations?.[item.assessmentIndex] ?? entry.variation,
      };
      const current = groups.get(key);
      if (current) {
        current.members.push(member);
        current.repairIssues = [...new Set([
          ...current.repairIssues,
          ...(entry.repairIssues?.[item.assessmentIndex] ?? []),
        ])];
      }
      else groups.set(key, {
        subject: entry.subject,
        assessmentIndex: item.assessmentIndex,
        level: item.level ?? "",
        evidence: item.text,
        criterion,
        levelCriteria: item.levelCriteria,
        repairIssues: entry.repairIssues?.[item.assessmentIndex] ?? [],
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
    levelCriteria: group.levelCriteria,
    levelRules: commentEvidenceInstructions(group.criterion).instruction,
    predicatePolicy: commentPredicatePolicy(group.criterion),
    repairIssues: group.repairIssues,
    lengthTarget: commentLengthTarget(group.criterion).label,
    requiredCount: group.members.length,
    candidateCount: commentPoolCandidateCount(group.members.length),
    variantPlans: createCommentVariations(commentPoolCandidateCount(group.members.length))
      .map((variation, index) => ({ variant: index + 1, ...variation })),
  }));
}

export function assignUniquePoolCandidates(
  group: CommentPoolGroup,
  rawCandidates: string[],
  referenceCandidates: string[] = [],
  allowReferenceFallback = false,
) {
  const issues = new Set<string>();
  const validated = rawCandidates.flatMap((candidate, index) => {
    const text = repairSafeNominalEnding(candidate);
    const format = validateGeneratedCommentPart(text, group.criterion);
    if (!format.valid) {
      issues.add("문장 형식 또는 명사형 종결 검수 미통과");
      return [];
    }
    const levelIssues = levelAppropriatenessIssues(text, group.level, group.criterion);
    if (levelIssues.length) {
      levelIssues.forEach((issue) => issues.add(issue));
      return [];
    }
    const groundingEvidence = `${group.evidence} | 생성용 기준: ${group.criterion}`;
    const blocking = evidenceBlockingIssues(text, groundingEvidence, group.criterion);
    if (blocking.length) {
      blocking.forEach((issue) => issues.add(issue));
      return [];
    }
    const semantic = criterionSemanticIssues(text, group.criterion, group.levelCriteria);
    if (semantic.length) {
      semantic.forEach((issue) => issues.add(issue));
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
  const referenceFallbacks: typeof validated = [];
  const deduplicated = validated.filter((candidate) => {
    const key = normalizedSentence(candidate.text);
    if (!key || seen.has(key)) {
      issues.add("완전히 같은 문장 후보 중복");
      return false;
    }
    seen.add(key);
    if (referenceKeys.has(key)) {
      issues.add("완전히 같은 문장 후보 중복");
      referenceFallbacks.push(candidate);
      return false;
    }
    return true;
  });
  // 구조 유사도는 저장 차단 사유가 아니다. 동일한 평가기준에서는 근거를
  // 보존할수록 문장 구조가 닮을 수 있으므로, 아래 후보는 우선 저장하고
  // 작업 후반의 다양성 검사에서 겹친 영역만 한 번 재생성하거나 경고한다.
  const fallbackCandidates = allowReferenceFallback
    ? referenceFallbacks.slice(0, Math.max(0, group.members.length - deduplicated.length))
    : [];
  return {
    candidates: [...deduplicated, ...fallbackCandidates].map((candidate) => candidate.text),
    fallbackKeys: new Set(fallbackCandidates.map((candidate) => normalizedSentence(candidate.text))),
    issues: [...issues],
  };
}

export async function generateCommentPoolBatch(
  evidence: CommentEvidence[],
  avoidComments: string[] = [],
  repair = false,
  model = primaryAiModel(),
  allowDuplicateFallback = false,
  isolateMembers = false,
): Promise<CommentBatchResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI 생성 설정이 아직 완료되지 않았습니다.");
  const groups = buildCommentPoolGroups(evidence, isolateMembers);
  const poolSchemas = Object.fromEntries(groups.map((group) => [group.poolId, {
    type: "object",
    additionalProperties: false,
    required: ["poolId", "candidates"],
    properties: {
      poolId: { type: "string", enum: [group.poolId] },
      candidates: {
        type: "array",
        minItems: commentPoolCandidateCount(group.members.length),
        maxItems: commentPoolCandidateCount(group.members.length),
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
          content: [{ type: "input_text", text: "당신은 초등학교 학교생활기록부 교과 평어의 검증 문장 풀을 작성한다. 학생 개인정보나 학생별 결과를 작성하지 않는다. 각 pool은 하나의 과목·평가영역·평가수준·평가기준에 대응한다. 서버가 검수 후 requiredCount개를 고를 수 있도록 candidateCount만큼 서로 다른 완성 문장을 정확히 작성한다. 모든 후보는 동일한 평가기준의 필수 수행 요소와 수준 의미를 빠짐없이 보존한다. levelCriteria의 상·중·하 전체를 비교하되 선택된 level의 criterion만 학생이 실제 수행한 근거이다. 다른 수준에만 있는 도움·일부 수행·구체적 표현 방법·방법 선택·바른 자세·말하기·활동은 절대 가져오지 않는다. 비교적·대체로·도움을 받아·일부·정확하게처럼 수행 정도를 나타내는 말은 선택 기준과 같은 강도로 유지한다. 알고 있음·이해함·다짐함·탐색함·표현함·실천함·씀은 서로 다른 수행이므로 다양성을 위해 깨달음·알게 됨·갖추어 감·의지가 돋보임·노력함 같은 다른 결과로 바꾸지 않는다. 특히 글을 실제로 쓰는 기준을 방법을 알고 있음이나 쓰려는 태도로 약화하지 않고, 느낀 부분과 까닭을 쓰는 기준에서 읽기·정리하기로 수행을 바꾸지 않는다. 뛰어남·돋보임·인상적임·깊이·충분히는 선택 기준에 같은 평가 정도가 있을 때만 사용한다. 선택 기준에 ‘다양한 방법’이 있을 때만 evidence에 실제 제시된 그림·시 등의 방법을 사용할 수 있으며, 보통·노력 요함 기준에 없는 그림·시·노래·만화는 쓰지 않는다. 상 기준의 정확하게·실감 나게·다양한 방법·이해하기 쉽게 같은 핵심 수행 정도는 약화하거나 생략하지 않는다. evidence의 목표와 관점은 criterion을 이해하는 문맥으로만 사용하며 학생이 수행한 사실로 추가하지 않는다. variantPlans는 사실을 추가하는 지시가 아니라 시작 방식·어순·동사 위치·문장 구조·명사형 종결을 서로 다르게 만드는 설계표이다. 후보끼리 완전히 같은 문장과 같은 첫 구절은 피하되 정확성과 자연스러움이 다양성보다 우선한다. 같은 핵심 단어를 그대로 둔 채 절의 순서만 바꾸는 것은 새로운 문형이 아니다. 같은 pool 후보의 3분의 1을 넘는 문장을 평가기준과 같은 첫 구절로 시작하지 말고, 수행 대상·과정·결과 중 근거에 있는 요소의 제시 순서를 분산한다. 수행 대상과 동사의 관계를 바꾸지 않는다. 예를 들어 문장을 나누고 자료 내용을 표현한다는 기준을 자료 내용을 나눈다고 바꾸지 않는다. 서술어는 ‘자료를 만듦.’, ‘조사함.’, ‘글로 표현함.’, ‘마음을 전하는 글을 씀.’처럼 직접 종결한다. ‘만드는 모습임.’, ‘표현하는 과정임.’, ‘까닭을 작품을 읽고 씀.’, ‘방법을 알고 활용하여’, ‘대화 표현에 힘씀.’, ‘마음을 전하는 글로 표현함.’, ‘글을 함.’, ‘글로 활용함.’, ‘쓰는 데서 드러남.’, ‘표현해 감.’, ‘도움 없이가 아니라’, ‘조사하여 정리하여’, 쉼표로 두 완성 문장을 잇는 표현은 사용하지 않는다. 각 문장은 자연스러운 관찰 기반 명사형 종결과 마침표로 끝낸다. 함·음·임 같은 직접 명사형을 기본으로 사용하고, 뛰어남·돋보임·인상적임은 선택 기준에 같은 우수 정도가 있을 때만 사용한다. 하였다·합니다·입니다·할 수 있다 같은 서술형은 사용하지 않는다. 길이는 목표일 뿐이며 사실성과 자연스러움을 우선한다. 제목·번호·설명은 출력하지 않는다." }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: `${repair ? "이전 생성에서 후보가 검수를 통과하지 못했다. 각 pool의 repairIssues 원인을 바로잡아 부족한 후보만 새로 작성한다." : "각 문장 풀을 작성한다."}\n문장 풀 요청: ${JSON.stringify(requestPools)}\n이미 사용했으므로 그대로 쓰지 않을 문장: ${JSON.stringify(avoidSentences)}` }],
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
    const assigned = assignUniquePoolCandidates(group, rawCandidates, avoidSentences, allowDuplicateFallback);
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
        warnings: [
          ...evidenceGroundingWarnings(text, `${member.item.text} | 생성용 기준: ${group.criterion}`),
          ...(assigned.fallbackKeys.has(normalizedSentence(text))
            ? ["완전히 같은 문장을 임시 저장하여 다양화 또는 교사 확인이 필요함"]
            : []),
        ],
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
