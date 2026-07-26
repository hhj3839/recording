import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "../../../supabase-auth";
import { GOOGLE_STATE_COOKIE, googleConfiguration, googleCookieOptions } from "../../../google-oauth";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "기록샘 로그인이 필요합니다." }, { status: 401 });
  try {
    const config = googleConfiguration(request.nextUrl.origin);
    const state = randomBytes(24).toString("base64url");
    const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorize.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/spreadsheets",
      ].join(" "),
      state,
      access_type: "online",
      include_granted_scopes: "true",
      prompt: "select_account consent",
    }).toString();
    const response = NextResponse.redirect(authorize);
    response.cookies.set(GOOGLE_STATE_COOKIE, state, googleCookieOptions(10 * 60));
    return response;
  } catch {
    return NextResponse.json({ error: "Google OAuth 환경변수가 설정되지 않았습니다." }, { status: 503 });
  }
}
