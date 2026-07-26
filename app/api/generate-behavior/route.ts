import { dataError, getDataScope } from "../../data-scope";
import { checkAiUsage, recordAiUsage } from "../../ai-usage";
import { createBehaviorVariations } from "../../behavior-variation";
import { validateBehaviorSource, validateRecord } from "../../record-validation";
import { eq, selectRows } from "../../../db/supabase";
import { primaryAiModel } from "../../ai-model-policy";

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("").trim();
}

export async function POST(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    const usage = await checkAiUsage(user.id);
    if (!usage.allowed) return Response.json({ error: usage.reason === "monthly" ? "이번 달 AI 생성 한도 300회를 모두 사용했습니다." : "요청이 너무 빠릅니다. 1분 후 다시 시도해 주세요.", usage }, { status: 429 });
    const body = await request.json() as { studentId?: unknown; observation?: unknown; currentBehavior?: unknown; mode?: unknown; options?: unknown };
    const studentId = Number(body.studentId);
    const observation = typeof body.observation === "string" ? body.observation.trim().slice(0, 4000) : "";
    const currentBehavior = typeof body.currentBehavior === "string" ? body.currentBehavior.trim().slice(0, 8000) : "";
    const mode = body.mode === "length" ? "length" : "regenerate";
    if (!observation) return Response.json({ error: "관찰 사실을 입력해 주세요." }, { status: 400 });
    const sourceValidation = validateBehaviorSource(observation);
    if (!sourceValidation.valid) return Response.json({
      error: "금지 내용이나 개인정보가 포함된 관찰 사실은 AI로 전송할 수 없습니다.",
      issues: [...sourceValidation.forbidden, ...sourceValidation.sensitive],
    }, { status: 400 });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "AI 생성 설정이 아직 완료되지 않았습니다." }, { status: 503 });
    const variation = createBehaviorVariations(1)[0];
    const existingBehaviors = Number.isInteger(studentId)
      ? await selectRows<{ student_id: number; behavior: string }>("student_behaviors", {
          owner_id: eq(user.id), class_id: eq(classId),
        })
      : [];
    const avoidBehaviors = existingBehaviors
      .filter((item) => Number(item.student_id) !== studentId)
      .map((item) => item.behavior)
      .filter(Boolean)
      .slice(0, 30);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: primaryAiModel(),
        reasoning: { effort: "low" },
        store: false,
        max_output_tokens: 1200,
        input: [
          { role: "system", content: [{ type: "input_text", text: "너는 대한민국 초등학교 담임교사이며 행동특성 및 발달상황을 작성한다. 입력된 학습 태도, 교우관계, 책임감, 생활 습관, 의사소통, 협력, 자기관리, 성장 모습 등 교사의 관찰 사실만 활용한다. 장점과 발전 가능성을 구체적으로 드러내고 부정적인 내용은 변화와 성장 중심으로 순화하며, 단순 나열보다 행동의 특징·과정·변화를 연결한다. 사실을 과장하거나 새로운 사실을 만들지 않고 학생 이름·성별·학생 간 비교를 쓰지 않는다. 대회·수상 실적, 사교육, 공인시험, 특정 기관명, 부모 직업·사회경제적 배경을 포함하지 않는다. variation을 따르되 기존 학생 문장과 표현을 반복하지 않는다. UTF-8 기준 반드시 500~550바이트로 작성하고 모든 문장은 글자 그대로 ‘음’ 또는 ‘임’으로 끝낸다. 출력 전 분량·종결·반복·성장·금지 내용·맞춤법을 검수하며 제목이나 설명 없이 본문만 출력한다." }] },
          { role: "user", content: [{ type: "input_text", text: mode === "length" && currentBehavior
            ? `다음 관찰 사실과 기존 문장만 활용하여 기존 행동특성을 UTF-8 500~550바이트로 다시 작성해 줘. 사실을 추가하거나 삭제하지 말고 자연스럽게 길이만 조정해 줘.\n\n관찰 사실:\n${observation}\n\n기존 행동특성:\n${currentBehavior}`
            : `다음 4~5가지 학생 특성을 바탕으로 표현과 문장 구조가 다른 행동특성을 작성해 줘. UTF-8 500~550바이트를 엄수해 줘.\n표현 방식: ${JSON.stringify(variation)}\n피해야 할 기존 행동특성: ${JSON.stringify(avoidBehaviors.map((item) => item.slice(0, 800)))}\n학생 특성: ${observation}` }] },
        ],
        text: { verbosity: "low" },
      }),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) {
      const apiError = payload as { error?: { code?: string; type?: string } };
      const quotaExhausted = apiError.error?.code === "insufficient_quota" || apiError.error?.type === "insufficient_quota";
      return Response.json({
        error: quotaExhausted
          ? "OpenAI API 크레딧 또는 사용 한도가 소진되었습니다. 결제와 프로젝트 한도를 확인해 주세요."
          : response.status === 429
            ? "OpenAI API 요청이 일시적으로 많습니다. 잠시 후 다시 시도해 주세요."
            : response.status === 401
              ? "OpenAI API 인증 설정을 확인해 주세요."
              : "AI 생성 요청을 처리하지 못했습니다.",
      }, { status: quotaExhausted ? 429 : 502 });
    }
    const behavior = extractOutputText(payload);
    if (!behavior) return Response.json({ error: "AI가 문장을 반환하지 않았습니다." }, { status: 502 });
    const validation = validateRecord(behavior, true);
    if (!validation.valid) return Response.json({
      error: "생성 결과가 500~550바이트·음/임 종결·성장·금지어 검수를 통과하지 못했습니다. 다시 생성해 주세요.",
      validation,
    }, { status: 502 });
    await recordAiUsage({ ownerId: user.id, ownerEmail: user.email, classId, feature: "single-behavior" });
    return Response.json({ behavior });
  } catch (error) {
    return dataError(error, "행동특성 생성 중 오류가 발생했습니다.");
  }
}
