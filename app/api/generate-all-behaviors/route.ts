import { upsertRows } from "../../../db/supabase";
import { dataError, getDataScope, requireOwnedStudentIds } from "../../data-scope";
import { checkAiUsage, MONTHLY_AI_LIMIT, recordAiUsage } from "../../ai-usage";
import { archiveBehavior } from "../../record-revisions";
import { validateBehaviorSource, validateRecord } from "../../record-validation";
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
    if (!usage.allowed) return Response.json({ error: usage.reason === "monthly" ? `이번 달 AI 생성 한도 ${MONTHLY_AI_LIMIT}회를 모두 사용했습니다.` : "요청이 너무 빠릅니다. 1분 후 다시 시도해 주세요.", usage }, { status: 429 });
    const body = await request.json() as { students?: unknown };
    if (!Array.isArray(body.students)) return Response.json({ error: "학생 특성을 다시 확인해 주세요." }, { status: 400 });
    const inputs = body.students.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const studentId = Number(record.studentId);
      const characteristic = typeof record.characteristic === "string" ? record.characteristic.trim().slice(0, 4000) : "";
      return Number.isInteger(studentId) && characteristic ? [{ studentId, characteristic }] : [];
    });
    if (!inputs.length) return Response.json({ error: "한 명 이상의 특성을 입력해 주세요." }, { status: 400 });
    const blocked = inputs.flatMap((item) => {
      const validation = validateBehaviorSource(item.characteristic);
      return validation.valid ? [] : [{ studentId: item.studentId, issues: [...validation.forbidden, ...validation.sensitive] }];
    });
    if (blocked.length) return Response.json({
      error: `${blocked.length}명의 관찰 사실에 금지 내용 또는 개인정보가 있어 AI 생성을 시작하지 않았습니다.`,
      blocked,
    }, { status: 400 });
    await requireOwnedStudentIds(inputs.map((item) => item.studentId), user.id, classId);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "AI 생성 설정이 아직 완료되지 않았습니다." }, { status: 503 });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: primaryAiModel(),
        reasoning: { effort: "low" },
        store: false,
        max_output_tokens: Math.min(10000, Math.max(1800, inputs.length * 650)),
        input: [
          { role: "system", content: [{ type: "input_text", text: "너는 대한민국 초등학교 담임교사이며 학생별 행동특성 및 발달상황을 작성한다. 입력된 학습 태도, 교우관계, 책임감, 생활 습관, 의사소통, 협력, 자기관리, 성장 모습 등 교사의 관찰 사실만 활용한다. 장점·노력·변화·성장은 입력에 있는 경우에만 구체적으로 드러내고, 부정적인 내용은 사실을 바꾸지 않는 범위에서 관찰 가능한 모습으로 순화한다. 사실을 과장하거나 만들지 않고 학생 이름·성별·학생 간 비교를 쓰지 않는다. 대회·수상 실적, 사교육, 공인시험, 특정 기관명, 부모 직업·사회경제적 배경을 포함하지 않는다. 문장 수를 고정하지 않고 학생별 UTF-8 500~600바이트의 한 문단으로 작성하며 모든 문장은 ‘음/임/함/됨’ 형태의 자연스러운 명사형으로 끝낸다. 출력 전 분량·종결·반복·입력 사실 일치·금지 내용·맞춤법을 검수한다. 반드시 JSON 배열만 출력하며 각 원소는 studentId와 behavior 필드를 가진다." }] },
          { role: "user", content: [{ type: "input_text", text: `다음 학생 식별번호별 특성을 바탕으로 각각 행동특성을 작성해 줘.\n${JSON.stringify(inputs)}` }] },
        ],
        text: { verbosity: "low" },
      }),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) return Response.json({ error: "AI 생성 요청을 처리하지 못했습니다." }, { status: 502 });
    const raw = extractOutputText(payload).replace(/^```json\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(raw) as Array<{ studentId?: unknown; behavior?: unknown }>;
    const inputMap = new Map(inputs.map((item) => [item.studentId, item.characteristic]));
    const behaviors = Array.isArray(parsed) ? parsed.flatMap((item) => {
      const studentId = Number(item.studentId);
      const behavior = typeof item.behavior === "string" ? item.behavior.trim() : "";
      return inputMap.has(studentId) && behavior && validateRecord(behavior, true).valid
        ? [{ studentId, characteristic: inputMap.get(studentId)!, behavior }]
        : [];
    }) : [];
    if (!behaviors.length) return Response.json({ error: "AI가 행동특성을 반환하지 않았습니다." }, { status: 502 });
    const updatedAt = new Date().toISOString();
    await Promise.all(behaviors.map((item) => archiveBehavior({
      ownerId: user.id, ownerEmail: user.email, classId, studentId: item.studentId,
      nextContent: item.behavior, nextCharacteristic: item.characteristic, source: "ai-regeneration",
    })));
    await upsertRows("student_behaviors", behaviors.map((item) => ({
      student_id: item.studentId,
      characteristic: item.characteristic,
      behavior: item.behavior,
      confirmed: false,
      confirmed_at: null,
      updated_at: updatedAt,
      owner_email: user.email,
      owner_id: user.id,
      class_id: classId,
    })), "class_id,student_id");
    await recordAiUsage({ ownerId: user.id, ownerEmail: user.email, classId, feature: "all-behaviors" });
    return Response.json({ behaviors, updatedAt });
  } catch (error) {
    return dataError(error, "행동특성 일괄 생성 중 오류가 발생했습니다.");
  }
}
