import { NextRequest } from "next/server";
import { createAuthClient } from "../../../supabase-auth";
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from "../../../password-policy";
import { validateSignupProfile } from "../../../signup-policy";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  if (body.termsAccepted !== true) {
    return Response.json({ error: "서비스 이용약관과 개인정보 처리방침 동의가 필요합니다." }, { status: 400 });
  }
  if (!email) {
    return Response.json({ error: "이메일을 입력해 주세요." }, { status: 400 });
  }
  if (!isStrongPassword(password)) {
    return Response.json({ error: PASSWORD_POLICY_MESSAGE }, { status: 400 });
  }
  const profile = {
    displayName: String(body.displayName ?? "").trim(),
    schoolName: String(body.schoolName ?? "").trim(),
    schoolYear: Number(body.schoolYear),
    semester: Number(body.semester),
    grade: Number(body.grade),
    classNumber: Number(body.classNumber),
  };
  const profileError = validateSignupProfile(profile);
  if (profileError) return Response.json({ error: profileError }, { status: 400 });
  const origin = request.nextUrl.origin;
  const { data, error } = await createAuthClient().auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      data: {
        display_name: profile.displayName,
        school_name: profile.schoolName,
        school_year: profile.schoolYear,
        semester: profile.semester,
        grade: profile.grade,
        class_number: profile.classNumber,
      },
    },
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({
    confirmed: Boolean(data.session),
    message: data.session ? "가입과 로그인이 완료되었습니다." : "인증 메일을 보냈습니다. 메일의 확인 링크를 눌러 주세요.",
  });
}
