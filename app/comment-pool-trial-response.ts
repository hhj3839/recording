const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]!));

// Native form submissions need a document, not an unhandled JSON navigation.
// API clients still receive JSON. Neither rendering path runs or saves anything.
export function trialResponse(value: unknown, status = 200, accept = '') {
  const ranges = accept.toLowerCase().split(',').map((entry) => {
    const [type, ...params] = entry.trim().split(';');
    const weight = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const q = weight === undefined ? 1 : Number(weight.slice(2));
    return { type: type.trim(), q: Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0 };
  });
  const quality = (type: string) => {
    const match = ranges.find((r) => r.type === type)
      ?? ranges.find((r) => r.type === `${type.split('/')[0]}/*`)
      ?? ranges.find((r) => r.type === '*/*');
    return match?.q ?? 0;
  };
  const htmlPreferred = ranges.some((r) => r.type === 'text/html')
    && quality('text/html') > 0 && quality('text/html') >= quality('application/json');
  if (!htmlPreferred) return Response.json(value, {status, headers: {'Cache-Control':'no-store'}});
  const data = value as { error?: string; candidates?: string[]; before?: string[]; elapsedMs?: number; usage?: unknown; estimatedCostUsd?: number };
  const list = (items: string[] = []) => `<ol>${items.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`;
  const body = data.error ? `<p role="alert">${escapeHtml(data.error)}</p>` :
    `<p>생성 완료 · ${data.candidates?.length ?? 0}문장 · ${Math.round((data.elapsedMs ?? 0) / 1000)}초</p>
    <p>기존 문장 풀과 학생 자료에는 저장하지 않았습니다. 이 결과는 화면을 닫기 전에 따로 보관해 주세요.</p>
    <h2>새 후보</h2>${list(data.candidates)}<h2>기존 문장</h2>${list(data.before)}
    <details><summary>사용량 및 검수 결과</summary><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></details>`;
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>영어 문장 시험 결과</title><body><main><h1>영어 문장 시험 결과</h1>${body}<p>추가 호출은 자동으로 진행하지 않습니다.</p><a href="/">기록샘으로 돌아가기</a></main></body></html>`, {
    status, headers: {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff'},
  });
}
