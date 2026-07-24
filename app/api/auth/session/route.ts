import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, authCookieOptions, createAuthClient } from "../../../supabase-auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const accessToken = String(body.accessToken ?? "");
  const refreshToken = String(body.refreshToken ?? "");
  if (!accessToken || !refreshToken) return Response.json({ error: "인증 정보가 없습니다." }, { status: 400 });
  const { data, error } = await createAuthClient().auth.getUser(accessToken);
  if (error || !data.user) return Response.json({ error: "유효하지 않은 인증 정보입니다." }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, accessToken, authCookieOptions(60 * 60));
  response.cookies.set(REFRESH_COOKIE, refreshToken, authCookieOptions(60 * 60 * 24 * 30));
  return response;
}
