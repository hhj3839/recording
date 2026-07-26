import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { eq, selectRows, supabaseRequest, upsertRows } from "../../../../db/supabase";
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
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const attemptKey = createHash("sha256").update(`${forwarded}|${email.toLowerCase()}`).digest("hex");
  const now = Date.now();
  const existing = (await selectRows<{ attempts: number; window_started_at: string; blocked_until: string | null }>(
    "auth_login_attempts", { attempt_key: eq(attemptKey), limit: 1 },
  ))[0];
  if (existing?.blocked_until && Date.parse(existing.blocked_until) > now) {
    return NextResponse.json({ error: "로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429 });
  }
  const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    const withinWindow = existing && now - Date.parse(existing.window_started_at) < 15 * 60 * 1000;
    const attempts = withinWindow ? Number(existing.attempts) + 1 : 1;
    await upsertRows("auth_login_attempts", [{
      attempt_key: attemptKey,
      attempts,
      window_started_at: withinWindow ? existing.window_started_at : new Date(now).toISOString(),
      blocked_until: attempts >= 5 ? new Date(now + 15 * 60 * 1000).toISOString() : null,
      updated_at: new Date(now).toISOString(),
    }], "attempt_key");
    return NextResponse.json(
      { error: attempts >= 5 ? "로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요." : "이메일 또는 비밀번호를 확인해 주세요." },
      { status: attempts >= 5 ? 429 : 401 },
    );
  }
  await supabaseRequest("auth_login_attempts", { method: "DELETE", query: { attempt_key: eq(attemptKey) } });
  const response = NextResponse.json({ returnTo: safeReturnTo(body.returnTo) });
  response.cookies.set(ACCESS_COOKIE, data.session.access_token, authCookieOptions(data.session.expires_in));
  response.cookies.set(REFRESH_COOKIE, data.session.refresh_token, authCookieOptions(60 * 60 * 24 * 30));
  return response;
}
