import { cookies } from "next/headers";
import { ACCESS_COOKIE, REFRESH_COOKIE, createAuthClient } from "../../../supabase-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password ?? "");
  if (password.length < 8) return Response.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!accessToken || !refreshToken) return Response.json({ error: "재설정 인증이 필요합니다." }, { status: 401 });
  const client = createAuthClient();
  const session = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (session.error) return Response.json({ error: "재설정 링크가 만료되었습니다." }, { status: 401 });
  const { error } = await client.auth.updateUser({ password });
  if (error) return Response.json({ error: "비밀번호를 변경하지 못했습니다." }, { status: 400 });
  return Response.json({ ok: true });
}
