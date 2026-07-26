import { NextResponse } from "next/server";
import { GOOGLE_ACCESS_COOKIE, googleAccessToken, googleApi } from "../../../google-oauth";
import { getAuthUser } from "../../../supabase-auth";

export async function GET() {
  if (!await getAuthUser()) return NextResponse.json({ connected: false }, { status: 401 });
  const token = await googleAccessToken();
  if (!token) return NextResponse.json({ connected: false });
  try {
    const profile = await googleApi<{ email?: string }>("https://www.googleapis.com/oauth2/v2/userinfo", token);
    return NextResponse.json({ connected: true, email: profile.email ?? "" });
  } catch {
    const response = NextResponse.json({ connected: false });
    response.cookies.delete(GOOGLE_ACCESS_COOKIE);
    return response;
  }
}

export async function DELETE() {
  const response = NextResponse.json({ connected: false });
  response.cookies.delete(GOOGLE_ACCESS_COOKIE);
  return response;
}
