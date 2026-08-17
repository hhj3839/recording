import { dataError, getDataScope } from "../../data-scope";
import { checkAiUsage, MONTHLY_AI_LIMIT, recordAiUsage } from "../../ai-usage";
import { createCommentVariations } from "../../comment-variation";
import { eq, selectRows } from "../../../db/supabase";
import { primaryAiModel } from "../../ai-model-policy";
import { normalizeGeneratedCommentWhitespace, replaceSelectedCommentText, validateGeneratedComment } from "../../comment-generation-policy";

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
    if (!usage.allowed) return Response.json({ error: usage.reason === "monthly" ? `이번 달 AI 생성 한도 ${MONTHLY_AI_LIMIT}회를 모두 사용했습니다.` : "요청이 너무 빠릅니다. 1분 후 다시 시도해 주세요.", usage }, { status: 429 });
    const body = await request.json() as {
      studentId?: unknown;
      levels?: unknown;
      plan?: unknown;
      mode?: unknown;
      currentComment?: unknown;
      selectedText?: unknown;
      selectionStart?: unknown;
      selectionEnd?: unknown;
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
    const mode = ["regenerate", "shorter", "specific", "selection"].includes(String(body.mode)) ? String(body.mode) : "new";
    const currentComment = typeof body.currentComment === "string" ? body.currentComment.slice(0, 4000) : "";
    const selectedText = typeof body.selectedText === "string" ? body.selectedText.trim().slice(0, 2000) : "";
    const selectionStart = Number(body.selectionStart);
    const selectionEnd = Number(body.selectionEnd);
    const studentId = Number(body.studentId);
    if (["shorter", "specific", "selection"].includes(mode) && !currentComment.trim()) {
      return Response.json({ error: "다시 작성할 기존 평어가 없습니다." }, { status: 400 });
    }
    if (mode === "selection" && !selectedText) return Response.json({ error: "다시 생성할 문장을 먼저 선택해 주세요." }, { status: 400 });
    if (mode === "selection"
      && (!Number.isInteger(selectionStart) || !Number.isInteger(selectionEnd)
        || currentComment.slice(selectionStart, selectionEnd).trim() !== selectedText)) {
      return Response.json({ error: "선택한 부분이 현재 평어와 달라졌습니다. 바꿀 부분을 다시 선택해 주세요." }, { status: 400 });
    }

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

    const activeEvidenceCount = levels.filter((level) => ["상", "중", "하"].includes(level)).length;
    const modeInstruction = mode === "regenerate"
      ? `이 학생의 기존 평어를 참고하거나 수정하지 말고, 아래 평가 근거만 사용하여 평어 전체를 처음부터 새로 작성해 줘. 평가 영역마다 정확히 1문장씩 총 ${activeEvidenceCount}문장을 작성하고, 각 문장은 60~80자를 목표로 하며 반드시 자연스러운 명사형 종결과 마침표로 끝내. 근거에 없는 행동·태도·과정을 추가하지 마.`
      : mode === "shorter"
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
              text: `당신은 초등학교 담임교사의 학생평가 작성 전문가이며 학교생활기록부 교과학습발달상황에 사용할 교과 평어를 작성한다. 입력된 평가계획과 평가 수준만 활용하며 학생 이름·성별·추측한 사실·비교 표현을 포함하지 않는다. 각 평가 영역의 문장은 평가기준을 그대로 복사하지 말고 성취기준·평가요소·수업 및 평가 활동의 수행 내용과 결과가 드러나는 관찰 가능한 행동으로 자연스럽게 바꾸어 쓴다. 학습 태도, 적극성, 자기주도성, 꾸준함, 협력, 교사의 도움은 평가 근거에서 확인되는 경우에만 쓴다. 상은 잘함, 중은 보통, 하는 노력 요함에 대응하되 입력된 해당 수준 기준만 사용한다. 상은 입력된 상 기준의 정확성·완성도·적용 능력, 중은 입력된 중 기준의 수행 범위·적용 정도, 하는 입력된 하 기준의 수행 과정·성장 가능성을 중심으로 쓰며 수준 이름만으로 태도나 도움 여부를 추측하지 않는다. 부족함·미흡함·못함·어려워함·이해하지 못함·소극적임·불성실함은 쓰지 않는다. variation의 문장 구조·시작 방식·근거 순서를 따르되 입력에 없는 영역·수준·사실을 만들지 않고 피해야 할 기존 평어와 첫 구절·핵심 동사·문장 구조가 겹치지 않게 작성한다. ${mode === "regenerate" ? `평가 영역마다 정확히 1문장씩 총 ${activeEvidenceCount}문장을 작성하고 각 문장은 서로 다른 내용과 문형의 60~80자 문장으로 쓴다. 모든 문장은 반드시 관찰 기반 명사형 종결 표현과 마침표로 끝낸다. 정확하게 설명함., 적극적으로 참여함., 자신의 생각을 구체적으로 표현함., 능력이 뛰어남., 태도가 돋보임., 모습이 인상적임. 같은 함·음·임 계열의 자연스러운 종결을 허용한다. 여기서 명사형은 문자 그대로 함.만 뜻하지 않는다. 하였다., 합니다., 입니다., 할 수 있다., 모습이다. 같은 서술형 종결은 절대 쓰지 않는다. 영역 순서대로 한 문단으로 이어 쓰고 마침표 뒤에는 한 칸만 띄운다.` : "현재 수정 요청의 범위만 평가 근거에 맞게 고치고 반드시 자연스러운 명사형 종결과 마침표를 사용한다."} 제목·번호·설명·따옴표·상중하 표시는 쓰지 않고 교과 평어 본문만 출력한다.`,
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

    const rawGeneratedText = extractOutputText(payload);
    const generatedText = mode === "regenerate"
      ? normalizeGeneratedCommentWhitespace(rawGeneratedText)
      : rawGeneratedText;
    if (!generatedText) return Response.json({ error: "AI가 문장을 반환하지 않았습니다. 다시 시도해 주세요." }, { status: 502 });
    if (mode === "regenerate" && !validateGeneratedComment(generatedText, activeEvidenceCount).valid) {
      return Response.json({ error: "새 평어가 영역별 문장 형식 검수를 통과하지 못했습니다. 다시 시도해 주세요." }, { status: 502 });
    }
    const comment = mode === "selection"
      ? replaceSelectedCommentText(currentComment, generatedText, selectionStart, selectionEnd)
      : generatedText;
    if (!comment) return Response.json({ error: "선택한 부분을 교체하지 못했습니다. 다시 선택해 주세요." }, { status: 400 });
    await recordAiUsage({ ownerId: user.id, ownerEmail: user.email, classId, feature: "single-comment" });
    return Response.json({ comment });
  } catch (error) {
    return dataError(error, "교과 평어 생성 중 오류가 발생했습니다.");
  }
}
