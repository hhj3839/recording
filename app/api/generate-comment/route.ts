import { dataError, getDataScope } from "../../data-scope";
import { checkAiUsage, recordAiUsage } from "../../ai-usage";
import { createCommentVariations } from "../../comment-variation";
import { eq, selectRows } from "../../../db/supabase";
import { primaryAiModel } from "../../ai-model-policy";

type Level = "상" | "중" | "하" | "미응시" | "평가 예정" | "-";

const defaultAssessmentPlan = [
  {
    unit: "1. 생생하게 표현해요",
    domain: "듣기·말하기",
    goal: "상황에 알맞은 표정과 몸짓, 목소리나 말투로 표현할 수 있다.",
    criteria: {
      상: "상황과 인물의 마음을 이해하고 표정, 몸짓, 목소리를 효과적으로 활용하여 실감 나게 표현함.",
      중: "상황에 어울리는 표정과 말투를 활용하여 대체로 알맞게 표현함.",
      하: "도움을 받아 상황에 알맞은 표정이나 말투로 표현하려고 노력함.",
    },
  },
  {
    unit: "2. 문장의 짜임",
    domain: "문법",
    goal: "문장의 기본 짜임을 이해하고 자신의 생각을 문장으로 표현할 수 있다.",
    criteria: {
      상: "문장의 짜임을 정확히 이해하고 자신의 생각을 분명하고 자연스럽게 표현함.",
      중: "문장의 기본 짜임을 이해하고 자신의 생각을 알맞은 문장으로 표현함.",
      하: "도움을 받아 문장의 짜임을 살피며 자신의 생각을 문장으로 표현함.",
    },
  },
  {
    unit: "3. 작품을 보고 느낌을 나누어요",
    domain: "문학",
    goal: "작품에 대한 느낌과 생각을 근거를 들어 표현할 수 있다.",
    criteria: {
      상: "작품의 내용을 깊이 이해하고 느낌과 생각을 구체적인 근거와 함께 표현함.",
      중: "작품의 내용을 이해하고 느낌과 생각을 알맞게 표현함.",
      하: "작품의 내용을 떠올리며 자신의 느낌을 간단한 말로 표현하려고 노력함.",
    },
  },
] as const;

type UploadedPlanItem = {
  subject: string;
  unit: string;
  goal: string;
  domain: string;
  perspective: string;
  high: string;
  middle: string;
  low: string;
  caution: string;
};

function parsePlan(value: unknown): UploadedPlanItem[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return null;
  const fields: (keyof UploadedPlanItem)[] = ["subject", "unit", "goal", "domain", "perspective", "high", "middle", "low", "caution"];
  const parsed = value.map((item) => {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const result = Object.fromEntries(fields.map((field) => [field, typeof record[field] === "string" ? record[field].slice(0, 2000).trim() : ""])) as UploadedPlanItem;
    return result.subject && result.unit && result.goal && result.domain && result.high && result.middle && result.low ? result : null;
  });
  return parsed.every(Boolean) ? parsed as UploadedPlanItem[] : null;
}

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("")
    .trim();
}

export async function POST(request: Request) {
  try {
    const { user, classId } = await getDataScope();
    const usage = await checkAiUsage(user.id);
    if (!usage.allowed) return Response.json({ error: usage.reason === "monthly" ? "이번 달 AI 생성 한도 300회를 모두 사용했습니다." : "요청이 너무 빠릅니다. 1분 후 다시 시도해 주세요.", usage }, { status: 429 });
    const body = await request.json() as {
      studentId?: unknown;
      levels?: unknown;
      plan?: unknown;
      mode?: unknown;
      currentComment?: unknown;
      selectedText?: unknown;
    };
    const uploadedPlan = parsePlan(body.plan);
    const plan = uploadedPlan ?? defaultAssessmentPlan.map((item) => ({
      subject: "국어", unit: item.unit, goal: item.goal, domain: item.domain, perspective: "",
      high: item.criteria.상, middle: item.criteria.중, low: item.criteria.하, caution: "",
    }));
    const levels = Array.isArray(body.levels) ? body.levels : [];
    const validLevels = levels.length === plan.length && levels.every((level): level is Level => ["상", "중", "하", "미응시", "평가 예정", "-"].includes(String(level)));
    if (!validLevels) return Response.json({ error: "평가 수준을 다시 확인해 주세요." }, { status: 400 });
    if (!levels.some((level) => ["상", "중", "하"].includes(level))) {
      return Response.json({ error: "평어 생성에 사용할 상·중·하 평가 수준이 없습니다." }, { status: 400 });
    }
    const mode = ["shorter", "specific", "selection"].includes(String(body.mode)) ? String(body.mode) : "new";
    const currentComment = typeof body.currentComment === "string" ? body.currentComment.trim().slice(0, 4000) : "";
    const selectedText = typeof body.selectedText === "string" ? body.selectedText.trim().slice(0, 2000) : "";
    const studentId = Number(body.studentId);
    if (mode !== "new" && !currentComment) return Response.json({ error: "다시 작성할 기존 평어가 없습니다." }, { status: 400 });
    if (mode === "selection" && !selectedText) return Response.json({ error: "다시 생성할 문장을 먼저 선택해 주세요." }, { status: 400 });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "AI 생성 설정이 아직 완료되지 않았습니다." }, { status: 503 });

    const evidence = plan
      .map((item, index) => {
        const level = levels[index];
        if (!["상", "중", "하"].includes(level)) return null;
        const criteria = level === "상" ? item.high : level === "중" ? item.middle : item.low;
        return `- 과목: ${item.subject}\n  단원: ${item.unit}\n  영역: ${item.domain}\n  평가목표: ${item.goal}\n  평가 관점: ${item.perspective}\n  수준: ${level}\n  수준 기준: ${criteria}\n  유의점: ${item.caution}`;
      })
      .filter(Boolean)
      .join("\n");

    const modeInstruction = mode === "shorter"
      ? `기존 평어를 평가 근거에서 벗어나지 않게 더 짧고 간결하게 다시 작성해 줘.\n기존 평어: ${currentComment}`
      : mode === "specific"
        ? `기존 평어를 평가 근거에 나타난 단원·영역·수행 기준이 더 구체적으로 드러나게 다시 작성해 줘. 근거에 없는 행동은 추가하지 마.\n기존 평어: ${currentComment}`
        : mode === "selection"
          ? `기존 평어에서 선택한 부분만 평가 근거에 맞는 자연스러운 문장으로 바꿔 줘. 반드시 교체할 문장만 출력해 줘.\n기존 평어: ${currentComment}\n선택한 부분: ${selectedText}`
          : "다음 평가 근거를 종합하여 교과 평어를 작성해 줘.";
    const variation = createCommentVariations(1)[0];
    const existingComments = Number.isInteger(studentId)
      ? await selectRows<{ student_id: number; comment: string }>("generated_comments", {
          owner_id: eq(user.id), class_id: eq(classId), subject: eq(plan[0]?.subject ?? ""),
        })
      : [];
    const avoidComments = existingComments
      .filter((item) => Number(item.student_id) !== studentId)
      .map((item) => item.comment)
      .filter(Boolean)
      .slice(0, 30);
    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: primaryAiModel(),
        reasoning: { effort: "low" },
        store: false,
        max_output_tokens: 300,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: "대한민국 초등학교 교과학습발달상황 작성 전문가로서 입력된 평가계획과 평가 수준만 활용한다. 학생 이름, 성별, 추측한 사실, 비교 표현을 포함하지 않는다. 하 수준도 부정적으로 단정하지 말고 수행 과정과 성장 가능성을 중심으로 쓴다. 지정된 variation의 문장 구조·시작 방식·근거 순서를 따르되 근거에 없는 사실을 만들지 않는다. 피해야 할 기존 평어와 첫 구절, 핵심 동사, 문장 구조가 겹치지 않게 작성한다. 여러 평가 항목을 단순 나열하지 말고 자연스럽게 연결한다. 2~3문장, 약 150~250바이트의 한국어로 작성하고 모든 문장을 '함', '됨', '보임', '돋보임' 같은 명사형 종결어미로 끝낸다. 설명이나 제목 없이 교과 평어 본문만 출력한다.",
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: `${modeInstruction}\n\n표현 방식: ${JSON.stringify(variation)}\n피해야 할 기존 평어: ${JSON.stringify(avoidComments.map((item) => item.slice(0, 500)))}\n\n평가 근거:\n${evidence}`,
            }],
          },
        ],
        text: { verbosity: "low" },
      }),
    });

    const payload = await openAIResponse.json() as unknown;
    if (!openAIResponse.ok) {
      const apiError = payload as { error?: { message?: string } };
      console.error("OpenAI response error", openAIResponse.status, apiError.error?.message ?? "unknown");
      return Response.json({ error: "AI 생성 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
    }

    const generatedText = extractOutputText(payload);
    if (!generatedText) return Response.json({ error: "AI가 문장을 반환하지 않았습니다. 다시 시도해 주세요." }, { status: 502 });
    const comment = mode === "selection" ? currentComment.replace(selectedText, generatedText) : generatedText;
    await recordAiUsage({ ownerId: user.id, ownerEmail: user.email, classId, feature: "single-comment" });
    return Response.json({ comment });
  } catch (error) {
    return dataError(error, "교과 평어 생성 중 오류가 발생했습니다.");
  }
}
