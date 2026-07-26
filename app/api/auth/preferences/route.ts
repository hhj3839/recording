import { cookies } from "next/headers";
import { dataError, getDataScope } from "../../../data-scope";
import { ACCESS_COOKIE, REFRESH_COOKIE, createAuthClient } from "../../../supabase-auth";

type Preferences = {
  comments?: { candidateCount?: number; sentenceCount?: number; maxBytes?: number; emphasis?: string };
  behaviors?: { sentenceCount?: number; maxBytes?: number; emphasis?: string };
};

async function sessionClient() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!accessToken || !refreshToken) return null;
  const client = createAuthClient();
  const session = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  return session.error ? null : { client, user: session.data.user };
}

export async function GET() {
  try {
    await getDataScope();
    const session = await sessionClient();
    if (!session) return Response.json({ error: "로그인 인증이 필요합니다." }, { status: 401 });
    return Response.json({ preferences: session.user?.user_metadata?.generation_preferences ?? {} });
  } catch (error) {
    return dataError(error, "생성 설정을 불러오지 못했습니다.");
  }
}

export async function PUT(request: Request) {
  try {
    await getDataScope();
    const session = await sessionClient();
    if (!session) return Response.json({ error: "로그인 인증이 필요합니다." }, { status: 401 });
    const body = await request.json().catch(() => ({})) as { preferences?: Preferences };
    const input = body.preferences ?? {};
    const current = session.user?.user_metadata?.generation_preferences ?? {};
    const preferences = {
      ...current,
      ...(input.comments ? { comments: {
        candidateCount: Math.min(3, Math.max(1, Number(input.comments.candidateCount) || 1)),
        sentenceCount: Math.min(4, Math.max(1, Number(input.comments.sentenceCount) || 2)),
        maxBytes: Math.min(1500, Math.max(150, Number(input.comments.maxBytes) || 500)),
        emphasis: input.comments.emphasis === "strength" ? "strength" : "balanced",
      } } : {}),
      ...(input.behaviors ? { behaviors: {
        sentenceCount: Math.min(6, Math.max(2, Number(input.behaviors.sentenceCount) || 4)),
        maxBytes: Math.min(700, Math.max(300, Number(input.behaviors.maxBytes) || 550)),
        emphasis: ["growth", "strength"].includes(String(input.behaviors.emphasis)) ? input.behaviors.emphasis : "balanced",
      } } : {}),
    };
    const { error } = await session.client.auth.updateUser({ data: { generation_preferences: preferences } });
    if (error) return Response.json({ error: "생성 설정을 저장하지 못했습니다." }, { status: 400 });
    return Response.json({ preferences });
  } catch (error) {
    return dataError(error, "생성 설정을 저장하지 못했습니다.");
  }
}
