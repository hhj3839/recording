"use client";

import { useRef, useState } from "react";

export function JobResumeNotice({ job }: { job: { id: string; status: string; canResume?: boolean; error?: string } | null }) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState(false);
  if (!job || !["queued", "running"].includes(job.status)) return null;
  const resume = async () => {
    if (inFlight.current || !job.canResume) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/generation-jobs/resume", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }), signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || !result.accepted || result.jobId !== job.id) {
        setMessage(response.status === 409 ? "작업 상태가 변경됐습니다. 최신 진행 상태를 확인해 주세요." : "재개 요청을 보내지 못했습니다. 상태를 확인한 뒤 다시 시도해 주세요.");
        return;
      }
      setAccepted(true);
      setMessage("기존 작업의 재개를 요청했습니다. 진행 상태가 갱신되는지 확인해 주세요.");
    } catch (error) {
      setMessage(error instanceof Error && error.name === "AbortError" ? "응답 시간이 초과됐습니다. 작업 상태를 확인한 뒤 다시 시도해 주세요." : "재개 요청을 보내지 못했습니다. 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      window.clearTimeout(timer);
      inFlight.current = false;
      setBusy(false);
    }
  };
  return <div className="job-resume-notice" role="status">
    <p>{job.canResume ? "진행이 멈췄다면 저장된 진행 위치에서 기존 작업을 재개할 수 있습니다." : "작업 상태를 확인 중입니다. 진행 중인 작업은 중복 실행하지 않습니다."}</p>
    <button className="secondary" disabled={busy || !job.canResume} onClick={() => void resume()}>{busy ? "재개 요청 중…" : accepted ? "기존 작업 다시 재개" : "기존 작업 재개"}</button>
    {message && <p>{message}</p>}
    {job.canResume && job.error && <p>{job.error}</p>}
  </div>;
}
