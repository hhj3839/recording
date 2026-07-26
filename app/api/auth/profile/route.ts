import { cookies } from "next/headers";
import { eq, updateRows } from "../../../../db/supabase";
import { dataError, getDataScope } from "../../../data-scope";
import { ACCESS_COOKIE, REFRESH_COOKIE, createAuthClient } from "../../../supabase-auth";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const displayName = String(body.displayName ?? "").trim().slice(0, 40);
    if (displayName.length < 2 || /[\u0000-\u001f\u007f]/.test(displayName)) {
      return Response.json({ error: "교사 이름은 2~40자로 입력해 주세요." }, { status: 400 });
    }
    const { user } = await getDataScope();
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
    const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
    if (!accessToken || !refreshToken) return Response.json({ error: "로그인 인증이 필요합니다." }, { status: 401 });
    const client = createAuthClient();
    const session = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (session.error) return Response.json({ error: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 });
    const { error } = await client.auth.updateUser({ data: { display_name: displayName } });
    if (error) return Response.json({ error: "교사 프로필을 변경하지 못했습니다." }, { status: 400 });
    await updateRows("teachers", { user_id: eq(user.id) }, { display_name: displayName });
    return Response.json({ displayName });
  } catch (error) {
    return dataError(error, "교사 프로필을 변경하지 못했습니다.");
  }
}
