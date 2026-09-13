export function PoolRecoveryNotice({ count, error, busy, onRetry }: {
  count: number; error: string; busy: boolean; onRetry: () => void;
}) {
  const delayed = /504|gateway\s*timeout|timed?\s*out|timeout/i.test(error);
  return <section className="pool-recovery" aria-label="AI 평어 보완 안내">
    <div className="pool-recovery-copy">
      <h3>{count > 0 ? `${count}개 묶음 보완이 필요해요` : "제작 결과를 확인해 주세요"}</h3>
      <p>{delayed ? "저장 응답이 지연돼 완료 여부를 확인하지 못했어요." : "일부 묶음의 제작을 완료하지 못했어요. 저장된 문장은 유지됩니다."}</p>
      <small>저장된 결과를 먼저 확인하고, 부족한 문장만 제작합니다.</small>
      {error && <details><summary>오류 상세</summary><p>{error}</p></details>}
    </div>
    {count > 0 && <button type="button" disabled={busy} onClick={onRetry}>{busy ? "결과 확인 중…" : "확인 후 이어서 제작"}</button>}
  </section>;
}
