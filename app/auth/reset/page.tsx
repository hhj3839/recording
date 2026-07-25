"use client";

import { FormEvent, useEffect, useState } from "react";

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("재설정 링크를 확인하고 있습니다.");

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (!accessToken || !refreshToken) {
      setMessage("재설정 링크가 올바르지 않거나 만료되었습니다.");
      return;
    }
    fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, refreshToken }),
    }).then((response) => {
      if (!response.ok) throw new Error();
      history.replaceState(null, "", "/auth/reset");
      setReady(true);
      setMessage("");
    }).catch(() => setMessage("재설정 링크가 만료되었습니다."));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const response = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error ?? "비밀번호를 변경하지 못했습니다.");
    window.location.replace("/");
  }

  return <main className="auth-shell"><section className="auth-card">
    <div className="auth-brand">기록샘</div><h1>비밀번호 재설정</h1>
    {message && <p role="status">{message}</p>}
    {ready && <form className="auth-form" onSubmit={submit}>
      <label>새 비밀번호<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label>
      <button className="auth-submit">비밀번호 변경</button>
    </form>}
  </section></main>;
}
