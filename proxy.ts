import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE } from "./app/supabase-auth";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const publicPath =
    pathname === "/login" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/auth/callback" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/comment-jobs/pump" ||
    pathname === "/api/comment-jobs/run" ||
    pathname === "/api/behavior-jobs/run" ||
    pathname.startsWith("/_next/") ||
    pathname.includes(".");
  if (publicPath || request.cookies.has(ACCESS_COOKIE)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?returnTo=${encodeURIComponent(`${pathname}${search}`)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
