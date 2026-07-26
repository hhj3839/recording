import { cookies } from "next/headers";
import { ACCESS_COOKIE, REFRESH_COOKIE, createAuthClient } from "../../../supabase-auth";
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from "../../../password-policy";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password ?? "");
  if (!isStrongPassword(password)) {
    return Response.json({ error: PASSWORD_POLICY_MESSAGE }, { status: 400 });
  }
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!accessToken || !refreshToken) return Response.json({ error: "로그인 인증이 필요합니다." }, { status: 401 });
  const client = createAuthClient();
  const session = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (session.error) return Response.json({ error: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 });
  const { error } = await client.auth.updateUser({ password });
  if (error) return Response.json({ error: "비밀번호를 변경하지 못했습니다." }, { status: 400 });
  return Response.json({ ok: true });
}
