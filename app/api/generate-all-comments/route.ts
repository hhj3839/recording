import { eq, selectRows, upsertRows } from "../../../db/supabase";
import { dataError, getDataScope, requireOwnedStudentIds } from "../../data-scope";

type Level = "상" | "중" | "하" | "-";
type ScoreStudent = { studentId: number; levels: Level[] };

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
    const body = await request.json() as { scores?: unknown };
    if (!body.scores || typeof body.scores !== "object" || Array.isArray(body.scores)) {
      return Response.json({ error: "평가 수준을 다시 확인해 주세요." }, { status: 400 });
    }
    const { user, classId } = await getDataScope();
    const rows = await selectRows<Record<string, string | number>>("assessment_plans", {
      owner_id: eq(user.id), class_id: eq(classId), order: "sort_order.asc",
    });
    const plan = rows.map((row) => ({
      subject: String(row.subject), unit: String(row.unit), goal: String(row.goal), domain: String(row.domain),
      perspective: String(row.perspective), high: String(row.high), middle: String(row.middle), low: String(row.low),
    }));
    const scores = body.scores as Record<string, ScoreStudent[]>;
    const evidence: Array<{ studentId: number; subject: string; items: string[] }> = [];

    for (const subject of [...new Set(plan.map((item) => item.subject))]) {
      const subjectPlan = plan.filter((item) => item.subject === subject);
      const subjectScores = Array.isArray(scores[subject]) ? scores[subject] : [];
      for (const student of subjectScores) {
        if (!Number.isInteger(student.studentId) || !Array.isArray(student.levels) || student.levels.length !== subjectPlan.length) continue;
        const items = subjectPlan.flatMap((item, index) => {
          const level = student.levels[index];
          if (!["상", "중", "하"].includes(level)) return [];
          const criterion = level === "상" ? item.high : level === "중" ? item.middle : item.low;
          return [`${item.unit} | ${item.domain} | 목표: ${item.goal} | 관점: ${item.perspective} | 수준: ${level} | 기준: ${criterion}`];
        });
        if (items.length) evidence.push({ studentId: student.studentId, subject, items });
      }
    }
    if (!evidence.length) return Response.json({ error: "전 과목 중 평가 수준을 한 개 이상 입력해 주세요." }, { status: 400 });
    await requireOwnedStudentIds(evidence.map((item) => item.studentId), user.id, classId);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "AI 생성 설정이 아직 완료되지 않았습니다." }, { status: 503 });
    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
        reasoning: { effort: "low" },
        store: false,
        max_output_tokens: Math.min(10000, Math.max(1200, evidence.length * 220)),
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: "대한민국 초등학교 교과학습발달상황 작성 전문가이다. 제공된 평가계획과 수준만 활용한다. 학생 이름·성별·추측·학생 간 비교를 쓰지 않는다. 하 수준도 성장 중심으로 표현한다. 각 결과는 2~3문장으로 자연스럽게 연결하고 모든 문장을 함·됨·보임·돋보임 등의 명사형으로 끝낸다. 반드시 JSON 배열만 출력하며 각 원소는 studentId, subject, comment 필드를 가진다." }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: `다음 학생 식별번호별·과목별 근거로 각각 교과 평어를 작성해 줘.\n${JSON.stringify(evidence)}` }],
          },
        ],
        text: { verbosity: "low" },
      }),
    });
    const payload = await openAIResponse.json() as unknown;
    if (!openAIResponse.ok) return Response.json({ error: "AI 생성 요청을 처리하지 못했습니다." }, { status: 502 });
    const raw = extractOutputText(payload).replace(/^```json\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(raw) as Array<{ studentId?: unknown; subject?: unknown; comment?: unknown }>;
    const allowed = new Set(evidence.map((item) => `${item.studentId}|${item.subject}`));
    const comments = Array.isArray(parsed) ? parsed.flatMap((item) => {
      const studentId = Number(item.studentId);
      const subject = typeof item.subject === "string" ? item.subject : "";
      const comment = typeof item.comment === "string" ? item.comment.trim() : "";
      return allowed.has(`${studentId}|${subject}`) && comment ? [{ studentId, subject, comment }] : [];
    }) : [];
    if (!comments.length) return Response.json({ error: "AI가 평어를 반환하지 않았습니다." }, { status: 502 });
    const updatedAt = new Date().toISOString();
    await upsertRows("generated_comments", comments.map((item) => ({
      student_id: item.studentId,
      subject: item.subject,
      comment: item.comment,
      updated_at: updatedAt,
      owner_email: user.email,
      owner_id: user.id,
      class_id: classId,
    })), "class_id,student_id,subject");
    return Response.json({ comments });
  } catch (error) {
    return dataError(error, "전 과목 교과 평어 생성 중 오류가 발생했습니다.");
  }
}
