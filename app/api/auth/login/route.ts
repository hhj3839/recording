import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  authCookieOptions,
  createAuthClient,
  safeReturnTo,
} from "../../../supabase-auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return NextResponse.json(
      { error: error?.message === "Email not confirmed" ? "이메일 인증을 먼저 완료해 주세요." : "이메일 또는 비밀번호를 확인해 주세요." },
      { status: 401 },
    );
  }
  const response = NextResponse.json({ returnTo: safeReturnTo(body.returnTo) });
  response.cookies.set(ACCESS_COOKIE, data.session.access_token, authCookieOptions(data.session.expires_in));
  response.cookies.set(REFRESH_COOKIE, data.session.refresh_token, authCookieOptions(60 * 60 * 24 * 30));
  return response;
}
