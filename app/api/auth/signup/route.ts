import { NextRequest } from "next/server";
import { createAuthClient } from "../../../supabase-auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  if (body.termsAccepted !== true) {
    return Response.json({ error: "서비스 이용약관과 개인정보 처리방침 동의가 필요합니다." }, { status: 400 });
  }
  if (!email || password.length < 8) {
    return Response.json({ error: "이메일과 8자 이상의 비밀번호를 입력해 주세요." }, { status: 400 });
  }
  const origin = request.nextUrl.origin;
  const { data, error } = await createAuthClient().auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      data: {
        display_name: String(body.displayName ?? "").trim() || email,
        school_name: String(body.schoolName ?? "").trim(),
        school_year: Number(body.schoolYear),
        semester: Number(body.semester),
        grade: Number(body.grade),
        class_number: Number(body.classNumber),
      },
    },
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({
    confirmed: Boolean(data.session),
    message: data.session ? "가입과 로그인이 완료되었습니다." : "인증 메일을 보냈습니다. 메일의 확인 링크를 눌러 주세요.",
  });
}
