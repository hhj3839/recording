import { upsertRows } from "../db/supabase";
import { recordAiUsage } from "./ai-usage";
import { BehaviorVariation } from "./behavior-variation";
import { archiveBehavior } from "./record-revisions";
import { validateBehaviorSource } from "./record-validation";

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

export async function generateBehaviorBatch(inputs: BehaviorInput[], avoidBehaviors: string[] = []) {
  if (inputs.some((item) => !validateBehaviorSource(item.characteristic).valid)) {
    throw new Error("금지 내용이나 개인정보가 포함된 관찰 사실은 AI로 전송할 수 없습니다.");
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI 생성 설정이 아직 완료되지 않았습니다.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
      reasoning: { effort: "low" },
      store: false,
      max_output_tokens: Math.min(5000, Math.max(1800, inputs.length * 700)),
      input: [
        { role: "system", content: [{ type: "input_text", text: "대한민국 초등학교 담임교사로서 학생별 행동특성 및 발달상황을 작성한다. 입력된 특성만 활용하고 새로운 사실을 만들지 않는다. 학생 이름·성별·가정환경·수상·사교육·비교 표현을 포함하지 않는다. 각 입력의 variation에 지정된 문장 구조·시작 방식·특성 순서를 따르되 관찰 사실에 없는 내용을 만들지 않는다. 같은 묶음의 학생끼리 첫 구절, 핵심 동사, 문장 구조, 종결 표현이 겹치지 않게 적극적으로 분산하고 avoidBehaviors의 문장을 복사하거나 비슷하게 바꾸어 쓰지 않는다. 각 입력의 options에 지정된 sentenceCount와 maxBytes에 최대한 맞춘다. emphasis가 strength이면 장점을, growth이면 변화와 발전 가능성을, balanced이면 전체 특성을 균형 있게 연결한다. 모든 문장을 명사형 종결어미로 끝낸다. 반드시 JSON 배열만 출력하며 각 원소는 studentId와 behavior 필드를 가진다." }] },
        { role: "user", content: [{ type: "input_text", text: `다음 학생 식별번호별 특성을 바탕으로 각각 행동특성을 작성해 줘.\n입력: ${JSON.stringify(inputs)}\n피해야 할 기존 행동특성: ${JSON.stringify(avoidBehaviors.slice(0, 30).map((item) => item.slice(0, 800)))}` }] },
      ],
      text: { verbosity: "low" },
    }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error("AI 생성 요청을 처리하지 못했습니다.");
  const raw = outputText(payload).replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(raw) as Array<{ studentId?: unknown; behavior?: unknown }>;
  const inputMap = new Map(inputs.map((item) => [item.studentId, item.characteristic]));
  const behaviors = Array.isArray(parsed) ? parsed.flatMap((item) => {
    const studentId = Number(item.studentId);
    const behavior = typeof item.behavior === "string" ? item.behavior.trim() : "";
    return inputMap.has(studentId) && behavior ? [{ studentId, characteristic: inputMap.get(studentId)!, behavior }] : [];
  }) : [];
  if (!behaviors.length) throw new Error("AI가 행동특성을 반환하지 않았습니다.");
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
  await recordAiUsage({ ownerId: input.ownerId, ownerEmail: input.ownerEmail, classId: input.classId, feature: "all-behaviors-background" });
}
