import { NextRequest } from "next/server";
import { createAuthClient } from "../../../supabase-auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  if (!email) return Response.json({ error: "이메일을 입력해 주세요." }, { status: 400 });
  const { error } = await createAuthClient().auth.resetPasswordForEmail(email, {
    redirectTo: `${request.nextUrl.origin}/auth/callback`,
  });
  if (error) return Response.json({ error: "비밀번호 재설정 메일을 보내지 못했습니다." }, { status: 400 });
  return Response.json({ message: "비밀번호 재설정 메일을 보냈습니다." });
}
