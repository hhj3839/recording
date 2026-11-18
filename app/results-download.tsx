"use client";

import { useState } from "react";
import { readApiJson } from "./api-response";

export function ResultsDownload({ roster }: { roster: Array<{ id: number; number?: number; name: string }> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const download = async () => {
    setBusy(true);
    setMessage("");
    try {
      const [commentResponse, behaviorResponse] = await Promise.all([
        fetch("/api/generated-comments", { cache: "no-store" }),
        fetch("/api/student-behaviors", { cache: "no-store" }),
      ]);
      const comments = await readApiJson<{ comments: Array<{ studentId: number; subject: string; comment: string; confirmed: boolean }> }>(commentResponse, "교과평어를 불러오지 못했습니다.");
      const behaviors = await readApiJson<{ behaviors: Array<{ studentId: number; behavior: string; confirmed: boolean }> }>(behaviorResponse, "행동특성을 불러오지 못했습니다.");
      if (!commentResponse.ok || !behaviorResponse.ok || !Array.isArray(comments.comments) || !Array.isArray(behaviors.behaviors)) throw new Error("자료를 모두 불러오지 못해 다운로드하지 않았습니다.");
      const students = roster.map((student) => ({
        number: student.number ?? student.id,
        name: student.name,
        comments: comments.comments.filter((row) => Number(row.studentId) === student.id).map((row) => ({ subject: row.subject, text: row.comment, confirmed: row.confirmed })),
        behavior: behaviors.behaviors.filter((row) => Number(row.studentId) === student.id).map((row) => ({ text: row.behavior, confirmed: row.confirmed })),
      }));
      const blob = new Blob([JSON.stringify({ format: "giroksam-results-v1", exportedAt: new Date().toISOString(), students }, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `기록샘_전체결과_${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("전체 결과 파일을 만들었습니다. 학생 개인정보가 포함되므로 안전한 위치에 보관하세요. 자동 복원용 DB 백업은 아닙니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "내려받지 못했습니다.");
    } finally { setBusy(false); }
  };
  return <section><button className="secondary result-copy-button" disabled={busy || !roster.length} onClick={() => void download()}>{busy ? "자료 확인 중…" : "전체 결과 내려받기"}</button><p>현재 학급의 전 과목 평어와 행동특성을 미확정 자료까지 JSON 파일로 보관합니다. 나이스 업로드 파일은 아닙니다.</p>{message && <p role="status">{message}</p>}</section>;
}
