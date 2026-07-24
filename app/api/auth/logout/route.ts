import { NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../../supabase-auth";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
