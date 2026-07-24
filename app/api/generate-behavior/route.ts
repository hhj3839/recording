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
    const body = await request.json() as { observation?: unknown };
    const observation = typeof body.observation === "string" ? body.observation.trim().slice(0, 4000) : "";
    if (!observation) return Response.json({ error: "관찰 사실을 입력해 주세요." }, { status: 400 });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "AI 생성 설정이 아직 완료되지 않았습니다." }, { status: 503 });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
        reasoning: { effort: "low" },
        store: false,
        max_output_tokens: 1200,
        input: [
          { role: "system", content: [{ type: "input_text", text: "대한민국 초등학교 담임교사로서 행동특성 및 발달상황을 작성한다. 입력된 관찰 사실만 활용하고 새로운 사실을 만들지 않는다. 학생 이름·성별·가정환경·수상·사교육·비교 표현을 포함하지 않는다. 장점과 성장 가능성을 구체적으로 연결하고 모든 문장을 명사형 종결어미로 끝낸다. 3~5문장, UTF-8 약 500~550바이트로 작성하며 제목이나 설명 없이 본문만 출력한다." }] },
          { role: "user", content: [{ type: "input_text", text: `다음 관찰 사실을 바탕으로 행동특성을 작성해 줘.\n${observation}` }] },
        ],
        text: { verbosity: "low" },
      }),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) return Response.json({ error: "AI 생성 요청을 처리하지 못했습니다." }, { status: 502 });
    const behavior = extractOutputText(payload);
    if (!behavior) return Response.json({ error: "AI가 문장을 반환하지 않았습니다." }, { status: 502 });
    return Response.json({ behavior });
  } catch (error) {
    console.error("Behavior generation failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "행동특성 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
