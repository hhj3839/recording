import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Supabase admin configuration is missing");

const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
const email = `lab-${stamp}@giroksam.test`;
const password = `Lab${randomBytes(12).toString("base64url")}9a`;
const client = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await client.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: {
    display_name: "실험실 교사",
    school_name: "기록샘 실험실",
    school_year: 2026,
    semester: 1,
    grade: 3,
    class_number: 1,
    account_type: "lab",
  },
});
if (error || !data.user) throw error ?? new Error("Lab account creation failed");

const createdAt = new Date().toISOString();
const { error: teacherError } = await client.from("teachers").upsert({
  email,
  user_id: data.user.id,
  display_name: "실험실 교사",
  created_at: createdAt,
}, { onConflict: "email" });
if (teacherError) throw teacherError;

const { error: classroomError } = await client.from("classrooms").insert({
  owner_id: data.user.id,
  owner_email: email,
  school_name: "기록샘 실험실",
  school_year: 2026,
  semester: 1,
  grade: 3,
  class_number: 1,
  created_at: createdAt,
});
if (classroomError) {
  await client.auth.admin.deleteUser(data.user.id);
  throw classroomError;
}

const outputDirectory = path.resolve(process.cwd(), ".local-secrets");
const outputPath = path.join(outputDirectory, `lab-account-${stamp}.txt`);
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, [
  "기록샘 실험실 계정",
  `웹앱: https://giroksam-recording.vercel.app/login`,
  `이메일: ${email}`,
  `초기 비밀번호: ${password}`,
  "학교·학급: 기록샘 실험실 · 2026학년도 1학기 · 3학년 1반",
  "보안 안내: 최초 로그인 후 개인정보·설정에서 비밀번호를 변경하세요.",
  "",
].join("\n"), { encoding: "utf8", mode: 0o600 });

console.log(`Lab account created: ${email}`);
console.log(`Credentials saved: ${outputPath}`);
