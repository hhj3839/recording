"use client";

import { useEffect, useRef } from "react";

export function FreshPoolDialog({ count, busy, disabled, error, onCancel, onStart }: {
  count: number; busy: boolean; disabled: boolean; error: string;
  onCancel: () => void; onStart: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  return <dialog ref={ref} className="fresh-pool-dialog" aria-label="전체 새로 제작 확인" aria-labelledby="fresh-pool-title" aria-describedby="fresh-pool-description" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <span className="fresh-pool-tag">AI 평어 제작</span>
    <h2 id="fresh-pool-title">AI 평어를 새로 제작할까요?</h2>
    <p id="fresh-pool-description">현재 평가계획의 <strong>{count}개 묶음</strong>을 새로 만듭니다.<br />기존 문장은 재사용하지 않으며 학생 기록은 유지됩니다.</p>
    <p className="fresh-pool-note">유료 제작 · 부족분 자동 보완 최대 2회</p>
    <details className="fresh-pool-cost"><summary>비용 안내</summary><p>묶음당 최초 1회와 보완 최대 2회, 총 최대 {count * 3}회 호출합니다. 실제 비용은 생성된 토큰에 따라 달라집니다. 다른 학급의 문장은 변경하지 않습니다.</p></details>
    {error && <p className="fresh-pool-error" role="alert">{error}</p>}
    <div className="fresh-pool-actions"><button autoFocus type="button" disabled={busy} onClick={onCancel}>취소</button><button type="button" className="fresh-pool-primary" disabled={busy || disabled} onClick={onStart}>{busy ? "제작 시작 중…" : "전체 새로 제작"}</button></div>
  </dialog>;
}
