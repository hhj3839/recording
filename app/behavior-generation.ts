import { upsertRows } from "../db/supabase";
import { BehaviorVariation } from "./behavior-variation";
import { archiveBehavior } from "./record-revisions";
import { validateBehaviorSource, validateRecord } from "./record-validation";
import { primaryAiModel } from "./ai-model-policy";
import { AiTokenUsage } from "./ai-usage";
import { assertStrictGeneratedBehaviors, selectBehaviorCandidate } from "./behavior-persistence-policy";

export type BehaviorOptions = { sentenceCount: number; maxBytes: number; emphasis: "balanced" | "strength" | "growth" };
export type BehaviorInput = {
  studentId: number;
  characteristic: string;
  options?: BehaviorOptions;
  variation?: BehaviorVariation;
  repairHint?: string;
  previousBehavior?: string;
  repairTargets?: [number, number];
};
export type GeneratedBehavior = BehaviorInput & { behavior: string };
export type BehaviorFailure = BehaviorInput & { behavior: string; issues: string[]; bytes: number; recoverable: boolean };
export type BehaviorBatchResult = { behaviors: GeneratedBehavior[]; failures: BehaviorFailure[]; usage: AiTokenUsage };

const behaviorSystemPrompt = "너는 대한민국 초등학교 담임교사이며 학기말 학교생활기록부의 행동특성 및 종합의견을 작성하는 전문가이다. 교사가 입력한 학습 태도, 교우관계, 생활 습관, 수업 참여, 책임감, 협력성, 자기관리, 의사소통, 성장 모습 등 학교생활 관찰 사실만 활용하여 학생의 학교생활 전반이 종합적으로 이해되게 작성한다. 장점, 노력, 변화가 긍정적이고 균형 있게 드러나게 하되 입력에 없는 장점·노력·변화·발전 가능성을 절대 만들지 않는다. 정확히 4문장으로 구성한다. 1문장은 입력 근거에 있는 학습 태도나 수업 참여, 2문장은 교우관계나 협력, 3문장은 책임감·생활 습관·자기관리, 4문장은 입력된 변화·성장 또는 남은 핵심 특성을 다룬다. 특정 영역의 입력 근거가 없으면 그 영역을 추측하지 말고 입력된 다른 특성을 배치한다. 각 문장은 최소 한 가지 입력 사실에 직접 대응해야 한다. 부정적인 내용은 사실을 바꾸지 않는 범위에서 관찰 가능한 노력과 변화 중심으로 순화하고 과장·단정·학생 간 비교를 피한다. ‘가능성이 크다고 보임’, ‘흐름을 해치지 않음’, ‘문제 행동을 보이지 않음’, ‘항상’, ‘완벽하게’, ‘매우 우수함’ 같은 평가적·우회적 표현을 쓰지 않는다. 학생 이름과 성별을 쓰지 않는다. 성적·등수·수상 실적·대회·사교육·공인시험·특정 기관명·가정환경·부모 직업·사회경제적 배경·신체조건·학교폭력·징계·질병을 포함하지 않는다. 활동을 나열하지 말고 행동의 특징, 과정, 변화를 자연스럽게 연결한다. variation의 문장 구조·시작 방식·특성 순서를 따르고 같은 묶음 학생 및 avoidBehaviors와 첫 구절, 핵심 동사, 문장 구조가 겹치지 않게 분산한다. 각 후보는 정확히 4문장인 한 문단으로 작성하며 줄바꿈 없이 문장 사이를 한 칸으로 구분한다. UTF-8 510~540바이트를 목표로 작성하되 서버 허용 범위는 500~600바이트이다. 모든 문장은 ‘참여함.’, ‘향상됨.’, ‘돋보임.’처럼 자연스러운 명사형 종결어미로 끝낸다. 출력 전 분량, 문장 수, 종결어미, 표현 반복, 입력 사실과의 일치, 변화·성장, 금지 내용, 맞춤법과 띄어쓰기를 스스로 검수한다. 반드시 JSON 배열만 출력하며 각 원소는 studentId와 candidates 필드를 가지고 candidates에는 서로 다른 완성 문장 2개를 넣는다.";

function outputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("").trim();
}

export async function generateBehaviorBatch(inputs: BehaviorInput[], avoidBehaviors: string[] = [], model = primaryAiModel()) {
  if (inputs.some((item) => !validateBehaviorSource(item.characteristic).valid)) {
    throw new Error("금지 내용이나 개인정보가 포함된 관찰 사실은 AI로 전송할 수 없습니다.");
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI 생성 설정이 아직 완료되지 않았습니다.");
  const avoidanceHints = [...new Set(avoidBehaviors.map((item) => item.split(/[.!?]/)[0]?.trim().slice(0, 110)).filter(Boolean))].slice(0, 20);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      store: false,
      max_output_tokens: Math.min(7000, Math.max(2400, inputs.length * 1200)),
      input: [
        { role: "system", content: [{ type: "input_text", text: behaviorSystemPrompt }] },
        { role: "user", content: [{ type: "input_text", text: `다음 학생 식별번호별 특성을 바탕으로 각각 행동특성 후보를 정확히 2개 작성해 줘. 최초 생성은 첫 후보 510~525바이트, 둘째 후보 526~540바이트를 목표로 한다. repairTargets가 있으면 최초 목표보다 repairTargets의 두 숫자를 각각 후보 1·2의 정확한 목표로 우선 적용한다. repairHint와 previousBehavior가 있으면 previousBehavior를 그대로 바탕으로 목표까지 필요한 부분만 서로 다르게 최소 수정하고, 전체를 새로 쓰지 않는다. 각 후보의 UTF-8 바이트를 따로 계산하고 500~600바이트가 아니면 출력 전에 미세 조정한다. 부족하면 이미 언급된 행동의 방법·과정만 구체화하고, 길면 중복 연결어와 수식어만 줄인다. 문장 수와 핵심 사실은 유지하며 새로운 사실은 절대 추가하지 않는다. 정확히 네 문장을 줄바꿈 없는 한 문단으로 만들고, 각 문장의 마침표 직전 글자가 받침 ㅁ인 ‘음/임/함/됨’ 형태인지 검사한다.\n입력: ${JSON.stringify(inputs)}\n피해야 할 기존 시작 표현: ${JSON.stringify(avoidanceHints)}` }] },
      ],
      text: { verbosity: "low" },
    }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const apiError = payload as { error?: { code?: string; type?: string } };
    if (apiError.error?.code === "insufficient_quota" || apiError.error?.type === "insufficient_quota") {
      throw new Error("OpenAI API 크레딧 또는 사용 한도가 소진되었습니다. 결제와 프로젝트 한도를 확인해 주세요.");
    }
    if (response.status === 429) throw new Error("OpenAI API 요청이 일시적으로 많습니다. 잠시 후 다시 시도해 주세요.");
    if (response.status === 401) throw new Error("OpenAI API 인증 설정을 확인해 주세요.");
    throw new Error("AI 생성 요청을 처리하지 못했습니다.");
  }
  const raw = outputText(payload).replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(raw) as Array<{ studentId?: unknown; behavior?: unknown; candidates?: unknown }>;
  const inputMap = new Map(inputs.map((item) => [item.studentId, item.characteristic]));
  const failures: BehaviorFailure[] = [];
  const behaviors = Array.isArray(parsed) ? parsed.flatMap((item) => {
    const studentId = Number(item.studentId);
    const candidates = Array.isArray(item.candidates) ? item.candidates : [item.behavior];
    const selected = selectBehaviorCandidate(candidates);
    const behavior = selected?.behavior ?? "";
    const source = inputs.find((input) => input.studentId === studentId);
    if (!source || !inputMap.has(studentId) || !behavior) return [];
    const validation = selected?.validation ?? validateRecord(behavior, true);
    if (validation.valid) return [{ ...source, behavior }];
    const issues = [
      ...(!validation.lengthOk ? [`현재 ${validation.bytes}바이트이며 500~600바이트로 조정 필요`] : []),
      ...(!validation.sentenceCountOk ? ["정확히 4문장으로 조정 필요"] : []),
      ...(!validation.endingsOk ? ["모든 문장을 음 또는 임으로 종결 필요"] : []),
      ...(!validation.growthIncluded ? ["입력된 성장·변화 사실을 결과에 반영 필요"] : []),
      ...validation.forbidden.map((term) => `금지 표현 '${term}' 제거 필요`),
      ...validation.styleIssues,
      ...validation.repeated.map(() => "반복 문장 제거 필요"),
      ...validation.spellingIssues,
    ];
    failures.push({
      ...source,
      behavior,
      issues,
      bytes: validation.bytes,
      recoverable: validation.bytes >= 350 && validation.bytes <= 700
        && validation.sentenceCountOk && validation.endingsOk && validation.growthIncluded
        && !validation.forbidden.length && !validation.styleIssues.length
        && !validation.repeated.length && validation.spellingOk,
    });
    return [];
  }) : [];
  const responseUsage = payload && typeof payload === "object"
    ? (payload as { usage?: { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } } }).usage
    : undefined;
  return {
    behaviors,
    failures,
    usage: {
      model,
      inputTokens: Number(responseUsage?.input_tokens) || 0,
      cachedInputTokens: Number(responseUsage?.input_tokens_details?.cached_tokens) || 0,
      outputTokens: Number(responseUsage?.output_tokens) || 0,
      totalTokens: Number(responseUsage?.total_tokens) || 0,
    },
  } satisfies BehaviorBatchResult;
}

export async function saveGeneratedBehaviors(input: {
  ownerId: string;
  ownerEmail: string;
  classId: number;
  behaviors: GeneratedBehavior[];
}) {
  assertStrictGeneratedBehaviors(input.behaviors);
  const updatedAt = new Date().toISOString();
  await Promise.all(input.behaviors.map((item) => archiveBehavior({
    ownerId: input.ownerId, ownerEmail: input.ownerEmail, classId: input.classId, studentId: item.studentId,
    nextContent: item.behavior, nextCharacteristic: item.characteristic, source: "ai-regeneration",
  })));
  await upsertRows("student_behaviors", input.behaviors.map((item) => ({
    student_id: item.studentId,
    characteristic: item.characteristic,
    behavior: item.behavior,
    confirmed: false,
    confirmed_at: null,
    updated_at: updatedAt,
    owner_email: input.ownerEmail,
    owner_id: input.ownerId,
    class_id: input.classId,
  })), "class_id,student_id");
}
