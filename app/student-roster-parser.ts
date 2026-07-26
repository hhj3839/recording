export type ParsedRosterStudent = { number: number; name: string };

export function parseStudentRosterText(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const isHeader = (line: string) => /^번호[\s,\t]+(이름|학생명|성명)$/i.test(line);
  const dataLines = lines.filter((line) => !isHeader(line));
  const students = dataLines.flatMap((line) => {
    const match = line.match(/^(\d+)[\t,\s]+(.+)$/);
    if (!match) return [];
    const number = Number(match[1]);
    const name = match[2].trim();
    return Number.isInteger(number) && number > 0 && name ? [{ number, name }] : [];
  });
  if (!students.length || students.length !== dataLines.length) {
    return { students: [], error: "각 줄을 ‘번호 이름’ 형식으로 입력해 주세요. 예: 1 강예린" };
  }
  if (new Set(students.map((student) => student.number)).size !== students.length) {
    return { students: [], error: "입력한 명단에 중복 번호가 있습니다." };
  }
  return { students, error: "" };
}
