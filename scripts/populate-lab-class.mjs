import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const labEmail = process.env.LAB_ACCOUNT_EMAIL;
if (!url || !serviceKey || !labEmail) throw new Error("Supabase admin configuration or LAB_ACCOUNT_EMAIL is missing");

const client = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let page = 1;
let labUser;
while (!labUser) {
  const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw error;
  labUser = data.users.find((user) => user.email === labEmail);
  if (data.users.length < 100) break;
  page += 1;
}
if (!labUser) throw new Error("Lab account was not found");

const { data: targetClasses, error: targetError } = await client
  .from("classrooms")
  .select("*")
  .eq("owner_id", labUser.id)
  .eq("school_year", 2026)
  .eq("semester", 1)
  .eq("grade", 3)
  .order("id", { ascending: true });
if (targetError) throw targetError;
const target = targetClasses?.[0];
if (!target) throw new Error("The lab classroom was not found");

const { data: candidates, error: candidateError } = await client
  .from("classrooms")
  .select("*")
  .eq("school_year", 2026)
  .eq("semester", 1)
  .eq("grade", 3)
  .neq("owner_id", labUser.id);
if (candidateError) throw candidateError;

let source;
let sourcePlans = [];
for (const candidate of candidates ?? []) {
  const { data: plans, error } = await client
    .from("assessment_plans")
    .select("*")
    .eq("class_id", candidate.id)
    .eq("owner_id", candidate.owner_id)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  if ((plans?.length ?? 0) > sourcePlans.length) {
    source = candidate;
    sourcePlans = plans ?? [];
  }
}
if (!source || !sourcePlans.length) {
  throw new Error("No saved 2026 grade 3 semester 1 assessment plan was found");
}

const classTables = [
  "assessment_levels",
  "generated_comments",
  "student_behaviors",
  "record_revisions",
  "assessment_plans",
  "students",
  "ai_usage_events",
];
for (const table of classTables) {
  const { error } = await client.from(table).delete().eq("class_id", target.id).eq("owner_id", labUser.id);
  if (error) throw error;
}

const { error: planError } = await client.from("assessment_plans").insert(sourcePlans.map((plan) => ({
  subject: plan.subject,
  unit: plan.unit,
  goal: plan.goal,
  domain: plan.domain,
  assessment_type: plan.assessment_type,
  perspective: plan.perspective,
  high: plan.high,
  middle: plan.middle,
  low: plan.low,
  caution: plan.caution,
  sort_order: plan.sort_order,
  owner_email: labEmail,
  owner_id: labUser.id,
  class_id: target.id,
})));
if (planError) throw planError;

const { data: students, error: studentError } = await client.from("students").insert(
  Array.from({ length: 25 }, (_, index) => ({
    number: index + 1,
    name: `실험학생${String(index + 1).padStart(2, "0")}`,
    active: true,
    created_at: new Date().toISOString(),
    owner_email: labEmail,
    owner_id: labUser.id,
    class_id: target.id,
  })),
).select("id,number");
if (studentError) throw studentError;

const subjects = [...new Set(sourcePlans.map((plan) => plan.subject))];
const levels = ["상", "중", "하"];
const levelRows = [];
for (const student of students) {
  for (const [subjectIndex, subject] of subjects.entries()) {
    const subjectPlans = sourcePlans.filter((plan) => plan.subject === subject);
    for (let assessmentIndex = 0; assessmentIndex < subjectPlans.length; assessmentIndex += 1) {
      const levelIndex = (student.number * 17 + subjectIndex * 11 + assessmentIndex * 7 + student.number * assessmentIndex) % levels.length;
      levelRows.push({
        student_id: student.id,
        subject,
        assessment_index: assessmentIndex,
        level: levels[levelIndex],
        updated_at: new Date().toISOString(),
        owner_email: labEmail,
        owner_id: labUser.id,
        class_id: target.id,
      });
    }
  }
}
const { error: levelError } = await client.from("assessment_levels").insert(levelRows);
if (levelError) throw levelError;

console.log(`Lab classroom populated: ${labEmail}`);
console.log(`Source: ${source.school_name} / ${source.school_year}-${source.semester} / grade ${source.grade} class ${source.class_number}`);
console.log(`Assessment plans: ${sourcePlans.length}, subjects: ${subjects.length}`);
console.log(`Students: ${students.length}, assessment levels: ${levelRows.length}`);
