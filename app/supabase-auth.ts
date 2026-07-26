import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  schoolName: string;
  schoolYear: number;
  semester: number;
  grade: number;
  classNumber: number;
};

export const ACCESS_COOKIE = "giroksam-access-token";
export const REFRESH_COOKIE = "giroksam-refresh-token";

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase Auth configuration is missing");
  return { url, key };
}

export function createAuthClient() {
  const { url, key } = config();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  let token = cookieStore.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const client = createAuthClient();
  const { data: initialData, error } = await client.auth.getUser(token);
  let data = initialData;
  if (error || !data.user?.email) {
    const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
    if (!refreshToken) return null;
    const refreshed = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (refreshed.error || !refreshed.data.session) return null;
    token = refreshed.data.session.access_token;
    data = { user: refreshed.data.user };
    try {
      cookieStore.set(ACCESS_COOKIE, token, authCookieOptions(refreshed.data.session.expires_in));
      cookieStore.set(REFRESH_COOKIE, refreshed.data.session.refresh_token, authCookieOptions(60 * 60 * 24 * 30));
    } catch {
      // 서버 컴포넌트 읽기 단계에서는 쿠키 갱신이 제한될 수 있음.
    }
  }
  if (!data.user?.email) return null;
  return {
    id: data.user.id,
    email: data.user.email,
    displayName:
      String(data.user.user_metadata?.display_name ?? data.user.user_metadata?.name ?? "") ||
      data.user.email,
    schoolName: String(data.user.user_metadata?.school_name ?? "학교 미등록"),
    schoolYear: Number(data.user.user_metadata?.school_year ?? new Date().getFullYear()),
    semester: Number(data.user.user_metadata?.semester ?? 1),
    grade: Number(data.user.user_metadata?.grade ?? 1),
    classNumber: Number(data.user.user_metadata?.class_number ?? 1),
  };
}

export function safeReturnTo(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

export function authCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
