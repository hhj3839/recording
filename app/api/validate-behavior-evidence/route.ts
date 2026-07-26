import { createHash } from "node:crypto";
import { eq, updateRows } from "../../../db/supabase";
import { checkAiUsage, recordAiUsage } from "../../ai-usage";
import { dataError, getDataScope, requireOwnedStudentIds } from "../../data-scope";

function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("").trim();
}

const evidenceHash = (characteristic: string, behavior: string) =>
  createHash("sha256").update(JSON.stringify({ characteristic, behavior })).digest("hex");

export async function POST(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    const usage = await checkAiUsage(user.id);
    if (!usage.allowed) return Response.json({ error: usage.reason === "monthly" ? "이번 달 AI 생성 한도를 모두 사용했습니다." : "요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    const body = await request.json() as { studentId?: unknown; characteristic?: unknown; behavior?: unknown };
    const studentId = Number(body.studentId);
    const characteristic = typeof body.characteristic === "string" ? body.characteristic.trim().slice(0, 4000) : "";
    const behavior = typeof body.behavior === "string" ? body.behavior.trim().slice(0, 8000) : "";
    if (!Number.isInteger(studentId) || !characteristic || !behavior) return Response.json({ error: "관찰 사실과 행동특성을 모두 확인해 주세요." }, { status: 400 });
    await requireOwnedStudentIds([studentId], user.id, classId);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "AI 검수 설정이 완료되지 않았습니다." }, { status: 503 });
    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
        reasoning: { effort: "low" },
        store: false,
        max_output_tokens: 350,
        input: [
          { role: "system", content: [{ type: "input_text", text: "행동특성 문장이 교사가 제공한 관찰 사실만으로 뒷받침되는지 엄격히 검수한다. 관찰 사실에 없는 활동, 성격, 관계, 성취, 변화, 빈도, 감정, 능력을 찾아낸다. 문체와 맞춤법은 판단하지 않는다. 일반적인 연결 표현은 허용하되 사실을 새로 만들면 안 된다. JSON만 출력한다: {\"status\":\"pass\" 또는 \"review\",\"issues\":[\"근거 없는 표현과 이유\"]}. 모두 근거가 있으면 pass와 빈 배열을 반환한다." }] },
          { role: "user", content: [{ type: "input_text", text: `교사가 입력한 관찰 사실:\n${characteristic}\n\n검수할 행동특성:\n${behavior}` }] },
        ],
        text: { verbosity: "low" },
      }),
    });
    const payload = await aiResponse.json() as unknown;
    if (!aiResponse.ok) return Response.json({ error: "AI 사실 검수를 처리하지 못했습니다." }, { status: 502 });
    let parsed: { status?: unknown; issues?: unknown };
    try {
      parsed = JSON.parse(extractOutputText(payload).replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      return Response.json({ error: "AI 검수 결과를 해석하지 못했습니다. 다시 시도해 주세요." }, { status: 502 });
    }
    const status = parsed.status === "pass" ? "pass" : "review";
    const issues = Array.isArray(parsed.issues) ? parsed.issues.filter((item): item is string => typeof item === "string").slice(0, 10) : [];
    const validatedAt = new Date().toISOString();
    await updateRows("student_behaviors", {
      owner_id: eq(user.id), class_id: eq(classId), student_id: eq(studentId),
    }, { evidence_status: status, evidence_issues: issues, evidence_hash: evidenceHash(characteristic, behavior), evidence_validated_at: validatedAt });
    await recordAiUsage({ ownerId: user.id, ownerEmail: user.email, classId, feature: "behavior-evidence-validation" });
    return Response.json({ status, issues, validatedAt });
  } catch (error) {
    return dataError(error, "행동특성 사실 검수 중 오류가 발생했습니다.");
  }
}
