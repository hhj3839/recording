type Level = "상" | "중" | "하" | "-";

const assessmentPlan = [
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
    const body = await request.json() as { studentId?: unknown; levels?: unknown };
    const levels = Array.isArray(body.levels) ? body.levels : [];
    const validLevels = levels.length === assessmentPlan.length && levels.every((level): level is Level => ["상", "중", "하", "-"].includes(String(level)));
    if (!validLevels) return Response.json({ error: "평가 수준을 다시 확인해 주세요." }, { status: 400 });
    if (levels.every((level) => level === "-")) return Response.json({ error: "평가 수준을 한 개 이상 입력해 주세요." }, { status: 400 });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "AI 생성 설정이 아직 완료되지 않았습니다." }, { status: 503 });

    const evidence = assessmentPlan
      .map((item, index) => {
        const level = levels[index];
        if (level === "-") return null;
        return `- 단원: ${item.unit}\n  영역: ${item.domain}\n  평가목표: ${item.goal}\n  수준: ${level}\n  수준 기준: ${item.criteria[level]}`;
      })
      .filter(Boolean)
      .join("\n");

    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
        reasoning: { effort: "low" },
        store: false,
        max_output_tokens: 300,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: "대한민국 초등학교 교과학습발달상황 작성 전문가로서 입력된 평가계획과 평가 수준만 활용한다. 학생 이름, 성별, 추측한 사실, 비교 표현을 포함하지 않는다. 하 수준도 부정적으로 단정하지 말고 수행 과정과 성장 가능성을 중심으로 쓴다. 여러 평가 항목을 단순 나열하지 말고 자연스럽게 연결한다. 2~3문장, 약 150~250바이트의 한국어로 작성하고 모든 문장을 '함', '됨', '보임', '돋보임' 같은 명사형 종결어미로 끝낸다. 설명이나 제목 없이 교과 평어 본문만 출력한다.",
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: `다음 국어 평가 근거를 종합하여 교과 평어를 작성해 줘.\n${evidence}`,
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

    const comment = extractOutputText(payload);
    if (!comment) return Response.json({ error: "AI가 문장을 반환하지 않았습니다. 다시 시도해 주세요." }, { status: 502 });
    return Response.json({ comment });
  } catch (error) {
    console.error("Comment generation failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "교과 평어 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
