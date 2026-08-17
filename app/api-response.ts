export async function readApiJson<T extends object>(response: Response, fallbackMessage: string) {
  const raw = await response.text();
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as T & { error?: string };
      }
    } catch {
      // Vercel and proxies can return an HTML error page. Never expose it as a JSON parse error.
    }
  }

  const error = response.status === 504
    ? "서버 응답 시간이 초과되었습니다. 생성 작업은 계속 진행 중일 수 있으니 잠시 후 다시 확인해 주세요."
    : [502, 503].includes(response.status)
      ? "생성 서버가 잠시 응답하지 않습니다. 잠시 후 생성 상태를 다시 확인해 주세요."
      : response.status === 401
        ? "로그인 시간이 만료되었습니다. 다시 로그인해 주세요."
        : `${fallbackMessage}${response.status ? ` (서버 응답 ${response.status})` : ""}`;
  return { error } as T & { error?: string };
}
