export function openAiOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const value = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof value.output_text === "string") return value.output_text;
  return (value.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("\n");
}

export function parseFirstJsonObject<T extends object>(raw: string): T | null {
  const text = raw.replace(/^```json\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, index + 1)) as unknown;
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
