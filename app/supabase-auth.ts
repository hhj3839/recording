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
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const { data, error } = await createAuthClient().auth.getUser(token);
  if (error || !data.user?.email) return null;
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
