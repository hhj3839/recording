export function PoolRecoveryNotice({ count, error, busy, onRetry }: {
  count: number; error: string; busy: boolean; onRetry: () => void;
}) {
  const delayed = /504|gateway\s*timeout|timed?\s*out|timeout/i.test(error);
  return <section className="pool-recovery" aria-label="AI 평어 보완 안내">
    <div className="pool-recovery-copy">
      <h3>{count > 0 ? `${count}개 묶음 보완 필요` : "제작 결과 확인"}</h3>
      <p>{delayed ? "저장 응답 지연 · 완료 여부 확인 필요" : "일부 묶음 미완료 · 저장 문장 유지"}</p>
      <small>저장 결과 확인 후 부족한 문장만 제작</small>
      {error && <details><summary>오류 상세</summary><p>{error}</p></details>}
    </div>
    {count > 0 && <button type="button" disabled={busy} onClick={onRetry}>{busy ? "결과 확인 중…" : "확인 후 이어서 제작"}</button>}
  </section>;
}
