import { NextRequest, NextResponse } from "next/server";
import {
  GOOGLE_ACCESS_COOKIE,
  GOOGLE_STATE_COOKIE,
  googleConfiguration,
  googleCookieOptions,
} from "../../../google-oauth";
import { getAuthUser } from "../../../supabase-auth";

function callbackPage(ok: boolean, message: string) {
  const payload = JSON.stringify({ type: "giroksam-google-oauth", ok, message }).replaceAll("<", "\\u003c");
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>Google 연결</title><body><p>${ok ? "Google 계정 연결이 완료되었습니다." : "Google 계정을 연결하지 못했습니다."}</p><script>if(window.opener){window.opener.postMessage(${payload},window.location.origin);window.close()}else{location.replace("/?google=${ok ? "connected" : "error"}")}</script></body></html>`, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return callbackPage(false, "기록샘 로그인이 필요합니다.");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  if (!code || !state || !storedState || state !== storedState) return callbackPage(false, "Google 연결 요청이 만료되었습니다.");
  try {
    const config = googleConfiguration(request.nextUrl.origin);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const token = await tokenResponse.json() as { access_token?: string; expires_in?: number; error_description?: string };
    if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || "Google token exchange failed");
    const response = new NextResponse(callbackPage(true, "Google 계정이 연결되었습니다.").body, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
    response.cookies.set(GOOGLE_ACCESS_COOKIE, token.access_token, googleCookieOptions(Math.max(60, (token.expires_in ?? 3600) - 60)));
    response.cookies.delete(GOOGLE_STATE_COOKIE);
    return response;
  } catch (error) {
    console.error("Google OAuth callback failed", error instanceof Error ? error.message : "unknown");
    return callbackPage(false, "Google 계정 연결 중 오류가 발생했습니다.");
  }
}
