export type AssessmentPlanPolicyInput = {
  subject: string;
  unit: string;
  goal: string;
  domain: string;
  type?: string;
  perspective: string;
  high: string;
  middle: string;
  low: string;
  caution?: string;
};

export const standardElementarySubjects = new Set([
  "국어", "수학", "사회", "과학", "도덕", "체육", "음악", "미술", "영어", "실과",
  "통합교과", "바른 생활", "슬기로운 생활", "즐거운 생활", "창의적 체험활동",
]);

const limits: Record<keyof AssessmentPlanPolicyInput, number> = {
  subject: 30, unit: 200, goal: 600, domain: 100, type: 200,
  perspective: 800, high: 1000, middle: 1000, low: 1000, caution: 1000,
};

export function validateAssessmentPlanRow(row: AssessmentPlanPolicyInput) {
  const required = [row.subject, row.unit, row.goal, row.domain, row.perspective, row.high, row.middle, row.low];
  if (required.some((value) => !value.trim())) {
    return "과목, 단원, 평가목표, 영역, 평가관점, 상·중·하 기준은 필수입니다.";
  }
  for (const [field, limit] of Object.entries(limits) as Array<[keyof AssessmentPlanPolicyInput, number]>) {
    if ((row[field] ?? "").trim().length > limit) return `${field} 항목이 최대 ${limit}자를 초과했습니다.`;
  }
  if (new Set([row.high.trim(), row.middle.trim(), row.low.trim()]).size < 3) {
    return "상·중·하 평가 기준은 서로 달라야 합니다.";
  }
  return "";
}

export function assessmentPlanWarnings(row: AssessmentPlanPolicyInput) {
  const warnings: string[] = [];
  if (row.subject && !standardElementarySubjects.has(row.subject.trim())) {
    warnings.push(`‘${row.subject}’은 표준 초등 과목명인지 확인해 주세요.`);
  }
  if (row.goal.trim() === row.perspective.trim()) warnings.push("평가목표와 평가관점이 같습니다.");
  if (row.domain.trim().length > 50) warnings.push("평가영역이 50자를 넘어 영역명이 맞는지 확인해 주세요.");
  return warnings;
}
