"use client";

import { useEffect, useState } from "react";

export default function AuthCallback() {
  const [message, setMessage] = useState("이메일 인증을 확인하고 있습니다.");
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (!accessToken || !refreshToken) {
      setMessage("인증 정보가 없습니다. 인증 메일의 링크를 다시 열어 주세요.");
      return;
    }
    fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, refreshToken }),
    }).then(async (response) => {
      if (!response.ok) throw new Error();
      window.location.replace("/");
    }).catch(() => setMessage("인증을 완료하지 못했습니다. 다시 로그인해 주세요."));
  }, []);
  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand">기록샘</div><h1>이메일 인증</h1><p role="status">{message}</p></section></main>;
}
