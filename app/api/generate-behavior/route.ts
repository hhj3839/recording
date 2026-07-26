import { dataError, getDataScope } from "../../data-scope";
import { checkAiUsage, recordAiUsage } from "../../ai-usage";
import { createBehaviorVariations } from "../../behavior-variation";
import { validateBehaviorSource } from "../../record-validation";
import { eq, selectRows } from "../../../db/supabase";

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
    const rawOptions = body.options && typeof body.options === "object" ? body.options as Record<string, unknown> : {};
    const options = {
      sentenceCount: Math.min(6, Math.max(2, Number(rawOptions.sentenceCount) || 4)),
      maxBytes: Math.min(700, Math.max(300, Number(rawOptions.maxBytes) || 550)),
      emphasis: rawOptions.emphasis === "strength" || rawOptions.emphasis === "growth" ? rawOptions.emphasis : "balanced",
    };
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
        model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
        reasoning: { effort: "low" },
        store: false,
        max_output_tokens: 1200,
        input: [
          { role: "system", content: [{ type: "input_text", text: "대한민국 초등학교 담임교사로서 행동특성 및 발달상황을 작성한다. 입력된 관찰 사실만 활용하고 새로운 사실을 만들지 않는다. 학생 이름·성별·가정환경·수상·사교육·비교 표현을 포함하지 않는다. 지정된 variation의 문장 구조·시작 방식·특성 순서를 따르며 피해야 할 기존 행동특성과 첫 구절, 핵심 동사, 문장 구조가 겹치지 않게 작성한다. 장점과 성장 가능성을 구체적으로 연결하고 모든 문장을 명사형 종결어미로 끝낸다. 3~5문장, UTF-8 약 500~550바이트로 작성하며 제목이나 설명 없이 본문만 출력한다." }] },
          { role: "user", content: [{ type: "input_text", text: mode === "length" && currentBehavior
            ? `다음 관찰 사실과 기존 문장만 활용하여 기존 행동특성을 UTF-8 500~550바이트로 다시 작성해 줘. 사실을 추가하거나 삭제하지 말고 자연스럽게 길이만 조정해 줘.\n\n관찰 사실:\n${observation}\n\n기존 행동특성:\n${currentBehavior}`
            : `다음 관찰 사실을 바탕으로 표현과 문장 구조가 다른 행동특성을 새로 작성해 줘. ${options.sentenceCount}문장, UTF-8 ${options.maxBytes}바이트 이내로 작성하고 작성 방향은 ${options.emphasis}임.\n표현 방식: ${JSON.stringify(variation)}\n피해야 할 기존 행동특성: ${JSON.stringify(avoidBehaviors.map((item) => item.slice(0, 800)))}\n관찰 사실: ${observation}` }] },
        ],
        text: { verbosity: "low" },
      }),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) return Response.json({ error: "AI 생성 요청을 처리하지 못했습니다." }, { status: 502 });
    const behavior = extractOutputText(payload);
    if (!behavior) return Response.json({ error: "AI가 문장을 반환하지 않았습니다." }, { status: 502 });
    await recordAiUsage({ ownerId: user.id, ownerEmail: user.email, classId, feature: "single-behavior" });
    return Response.json({ behavior });
  } catch (error) {
    return dataError(error, "행동특성 생성 중 오류가 발생했습니다.");
  }
}
