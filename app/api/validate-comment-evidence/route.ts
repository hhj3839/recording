import { createHash } from "node:crypto";
import { eq, selectRows, updateRows } from "../../../db/supabase";
import { checkAiUsage, recordAiUsage } from "../../ai-usage";
import { dataError, getDataScope, requireOwnedStudentIds } from "../../data-scope";

type PlanRow = {
  subject: string; unit: string; goal: string; domain: string; perspective: string;
  high: string; middle: string; low: string; caution: string; sort_order: number;
};

function extractOutputText(payload: unknown) {
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
    if (!usage.allowed) return Response.json({ error: usage.reason === "monthly" ? "이번 달 AI 생성 한도를 모두 사용했습니다." : "요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    const body = await request.json() as { studentId?: unknown; subject?: unknown; comment?: unknown };
    const studentId = Number(body.studentId);
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 4000) : "";
    if (!Number.isInteger(studentId) || !subject || !comment) return Response.json({ error: "검수할 평어 정보를 확인해 주세요." }, { status: 400 });
    await requireOwnedStudentIds([studentId], user.id, classId);

    const [plan, levels] = await Promise.all([
      selectRows<PlanRow>("assessment_plans", { owner_id: eq(user.id), class_id: eq(classId), subject: eq(subject), order: "sort_order.asc" }),
      selectRows<{ assessment_index: number; level: string }>("assessment_levels", { owner_id: eq(user.id), class_id: eq(classId), student_id: eq(studentId), subject: eq(subject), order: "assessment_index.asc" }),
    ]);
    const levelMap = new Map(levels.map((item) => [Number(item.assessment_index), item.level]));
    const evidence = plan.map((item, index) => {
      const level = levelMap.get(index) ?? "-";
      if (!["상", "중", "하"].includes(level)) return null;
      const criteria = level === "상" ? item.high : level === "중" ? item.middle : item.low;
      return `${item.unit} | ${item.domain} | ${item.goal} | ${item.perspective} | ${level} | ${criteria}`;
    }).filter(Boolean);
    if (!evidence.length) return Response.json({ error: "검수에 사용할 상·중·하 평가 근거가 없습니다." }, { status: 400 });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "AI 검수 설정이 완료되지 않았습니다." }, { status: 503 });

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
        reasoning: { effort: "low" },
        store: false,
        max_output_tokens: 300,
        input: [
          { role: "system", content: [{ type: "input_text", text: "교과 평어가 제공된 평가 근거만으로 뒷받침되는지 엄격히 검수한다. 이름·성별·태도·행동·성과 등 근거에 없는 구체적 사실이나 과장을 찾는다. 문체나 맞춤법은 판단하지 않는다. JSON만 출력한다: {\"status\":\"pass\" 또는 \"review\",\"issues\":[\"근거 없는 표현과 이유\"]}. 모든 내용이 근거로 뒷받침되면 pass와 빈 배열을 반환한다." }] },
          { role: "user", content: [{ type: "input_text", text: `평가 근거:\n${evidence.join("\n")}\n\n검수할 평어:\n${comment}` }] },
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
    const hash = createHash("sha256").update(comment).digest("hex");
    const validatedAt = new Date().toISOString();
    await updateRows("generated_comments", {
      owner_id: eq(user.id), class_id: eq(classId), student_id: eq(studentId), subject: eq(subject),
    }, { evidence_status: status, evidence_issues: issues, evidence_hash: hash, evidence_validated_at: validatedAt });
    await recordAiUsage({ ownerId: user.id, ownerEmail: user.email, classId, feature: "comment-evidence-validation" });
    return Response.json({ status, issues, validatedAt });
  } catch (error) {
    return dataError(error, "평어 사실 검수 중 오류가 발생했습니다.");
  }
}
