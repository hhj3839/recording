import { upsertRows } from "../db/supabase";
import { BehaviorVariation } from "./behavior-variation";
import { archiveBehavior } from "./record-revisions";
import { validateBehaviorSource, validateRecord } from "./record-validation";
import { primaryAiModel } from "./ai-model-policy";

export type BehaviorOptions = { sentenceCount: number; maxBytes: number; emphasis: "balanced" | "strength" | "growth" };
export type BehaviorInput = { studentId: number; characteristic: string; options?: BehaviorOptions; variation?: BehaviorVariation };
export type GeneratedBehavior = BehaviorInput & { behavior: string };

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
      max_output_tokens: Math.min(7000, Math.max(1800, inputs.length * 700)),
      input: [
        { role: "system", content: [{ type: "input_text", text: "너는 대한민국 초등학교 담임교사이며 학생별 행동특성 및 발달상황을 작성한다. 교사가 입력한 학습 태도, 교우관계, 책임감, 생활 습관, 의사소통, 협력, 자기관리, 성장 모습 등의 관찰 사실만 활용한다. 학생의 장점과 발전 가능성이 구체적으로 드러나게 하고, 부정적인 내용은 사실을 바꾸지 않는 범위에서 변화와 성장 중심으로 순화한다. 활동을 단순 나열하지 말고 행동의 특징·과정·변화를 자연스럽게 연결한다. 입력된 사실을 과장하거나 새로운 사실을 만들지 않으며 학생 이름·성별·학생 간 비교를 쓰지 않는다. 대회·수상 실적, 사교육, 공인시험, 특정 기관명, 부모 직업·사회경제적 배경 등 기재 금지 내용을 포함하지 않는다. variation의 문장 구조·시작 방식·특성 순서를 따르고 같은 묶음 학생 및 avoidBehaviors와 첫 구절, 핵심 동사, 문장 구조가 겹치지 않게 분산한다. 각 학생 결과는 UTF-8 기준 반드시 500바이트 이상 550바이트 이하로 작성하고, 모든 문장은 글자 그대로 ‘음’ 또는 ‘임’으로 끝낸다. 출력 전 분량, 종결어미, 표현 반복, 구체적인 변화·성장, 금지 내용, 맞춤법과 띄어쓰기를 스스로 검수한다. 반드시 JSON 배열만 출력하며 각 원소는 studentId와 behavior 필드를 가진다." }] },
        { role: "user", content: [{ type: "input_text", text: `다음 학생 식별번호별 특성을 바탕으로 각각 행동특성을 작성해 줘.\n입력: ${JSON.stringify(inputs)}\n피해야 할 기존 시작 표현: ${JSON.stringify(avoidanceHints)}` }] },
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
  const parsed = JSON.parse(raw) as Array<{ studentId?: unknown; behavior?: unknown }>;
  const inputMap = new Map(inputs.map((item) => [item.studentId, item.characteristic]));
  const behaviors = Array.isArray(parsed) ? parsed.flatMap((item) => {
    const studentId = Number(item.studentId);
    const behavior = typeof item.behavior === "string" ? item.behavior.trim() : "";
    return inputMap.has(studentId) && behavior && validateRecord(behavior, true).valid
      ? [{ studentId, characteristic: inputMap.get(studentId)!, behavior }]
      : [];
  }) : [];
  if (!behaviors.length) throw new Error("AI 결과가 500~550바이트·음/임 종결·성장·금지어 검수를 통과하지 못했습니다.");
  return behaviors;
}

export async function saveGeneratedBehaviors(input: {
  ownerId: string;
  ownerEmail: string;
  classId: number;
  behaviors: GeneratedBehavior[];
}) {
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
