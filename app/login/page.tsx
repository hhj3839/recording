"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const endpoint = mode === "forgot" ? "forgot-password" : mode;
    const response = await fetch(`/api/auth/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, termsAccepted: mode === "signup" ? accepted : undefined, returnTo: params.get("returnTo") ?? "/" }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(result.error ?? "처리하지 못했습니다.");
    if (mode === "login") window.location.href = result.returnTo ?? "/";
    else setMessage(result.message);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">기록샘</div>
        <h1>{mode === "login" ? "교사 로그인" : mode === "signup" ? "교사 회원가입" : "비밀번호 찾기"}</h1>
        <p>학급 자료는 로그인한 교사 계정별로 안전하게 분리됩니다.</p>
        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>로그인</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>회원가입</button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && <>
            <label>교사 이름<input name="displayName" minLength={2} maxLength={40} required autoComplete="name" /></label>
            <label>학교<input name="schoolName" minLength={2} maxLength={100} required placeholder="예: 서울하늘초등학교" /></label>
            <div className="auth-row">
              <label>학년도<input name="schoolYear" type="number" min="2000" max="2100" defaultValue={new Date().getFullYear()} required /></label>
              <label>학기<select name="semester" defaultValue="1"><option value="1">1학기</option><option value="2">2학기</option></select></label>
            </div>
            <div className="auth-row">
              <label>학년<input name="grade" type="number" min="1" max="6" required /></label>
              <label>반<input name="classNumber" type="number" min="1" max="99" required /></label>
            </div>
          </>}
          <label>이메일<input name="email" type="email" required autoComplete="email" /></label>
          {mode !== "forgot" && <label>비밀번호<input name="password" type="password" minLength={mode === "signup" ? 12 : 8} pattern={mode === "signup" ? "(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{12,}" : undefined} title={mode === "signup" ? "12자 이상이며 영문 대문자·소문자·숫자를 각각 포함해 주세요." : undefined} required autoComplete={mode === "login" ? "current-password" : "new-password"} />{mode === "signup" && <small>12자 이상 · 영문 대문자·소문자·숫자 포함</small>}</label>}
          {mode === "signup" && <label className="auth-consent"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required /><span><a href="/terms" target="_blank">서비스 이용약관</a>과 <a href="/privacy" target="_blank">개인정보 처리방침</a>을 확인했으며 필수 개인정보 처리에 동의합니다.</span></label>}
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="auth-submit" disabled={busy || (mode === "signup" && !accepted)}>{busy ? "처리 중..." : mode === "login" ? "로그인" : mode === "signup" ? "인증 메일 받기" : "재설정 메일 받기"}</button>
          {mode === "login" && <button type="button" className="auth-link" onClick={() => setMode("forgot")}>비밀번호를 잊으셨나요?</button>}
          {mode === "forgot" && <button type="button" className="auth-link" onClick={() => setMode("login")}>로그인으로 돌아가기</button>}
        </form>
        <footer className="auth-legal"><a href="/privacy">개인정보 처리방침</a><a href="/terms">서비스 이용약관</a></footer>
      </section>
    </main>
  );
}
