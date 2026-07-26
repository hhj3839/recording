export type ParsedAssessmentPlan = {
  subject: string;
  unit: string;
  goal: string;
  domain: string;
  type: string;
  perspective: string;
  high: string;
  middle: string;
  low: string;
  caution: string;
};

const headerNames = ["과목", "단원", "평가목표", "영역", "평가유형", "평가관점", "상", "중", "하", "평가상의유의점"];

export function parseAssessmentPlanText(value: string) {
  const rows = value.split(/\r?\n/).filter((line) => line.trim())
    .map((line) => line.split("\t").map((cell) => cell.trim()));
  const hasHeader = rows[0]?.length === 10
    && rows[0].every((cell, index) => cell.replace(/\s+/g, "") === headerNames[index]);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  if (!dataRows.length) return { plans: [], error: "붙여넣은 평가계획이 없습니다." };
  const invalidIndex = dataRows.findIndex((row) => row.length !== 10);
  if (invalidIndex >= 0) {
    return { plans: [], error: `${invalidIndex + 1}행의 열이 ${dataRows[invalidIndex].length}개입니다. 과목부터 유의점까지 10개 열을 탭으로 구분해 주세요.` };
  }
  const plans = dataRows.map((row) => ({
    subject: row[0], unit: row[1], goal: row[2], domain: row[3], type: row[4],
    perspective: row[5], high: row[6], middle: row[7], low: row[8], caution: row[9],
  }));
  return { plans, error: "" };
}
