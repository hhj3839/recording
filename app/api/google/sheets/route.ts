import { eq, selectRows } from "../../../../db/supabase";
import { dataError, getDataScope } from "../../../data-scope";
import { googleAccessToken, googleApi } from "../../../google-oauth";

type StudentRow = { id: number; number: number; name: string };
type CommentRow = { student_id: number; subject: string; comment: string; confirmed: boolean; updated_at: string };
type BehaviorRow = { student_id: number; characteristic: string; behavior: string; confirmed: boolean; updated_at: string };
type SheetData = { title: string; values: (string | number)[][] };

const safeSheetTitle = (value: string, used: Set<string>) => {
  const base = value.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 90) || "교과";
  let title = base;
  let index = 2;
  while (used.has(title)) title = `${base.slice(0, 85)} ${index++}`;
  used.add(title);
  return title;
};

export async function POST() {
  try {
    const token = await googleAccessToken();
    if (!token) return Response.json({ error: "Google 계정을 먼저 연결해 주세요.", reconnect: true }, { status: 401 });
    const { user, classId, classroom } = await getDataScope();
    const [students, comments, behaviors] = await Promise.all([
      selectRows<StudentRow>("students", { owner_id: eq(user.id), class_id: eq(classId), active: eq(true), order: "number.asc" }),
      selectRows<CommentRow>("generated_comments", { owner_id: eq(user.id), class_id: eq(classId), order: "subject.asc,student_id.asc" }),
      selectRows<BehaviorRow>("student_behaviors", { owner_id: eq(user.id), class_id: eq(classId), order: "student_id.asc" }),
    ]);
    const ordered = [...students].sort((a, b) => Number(a.number) - Number(b.number));
    const subjects = [...new Set(comments.map((item) => item.subject).filter(Boolean))];
    const commentMap = new Map(comments.map((item) => [`${item.student_id}|${item.subject}`, item]));
    const behaviorMap = new Map(behaviors.map((item) => [Number(item.student_id), item]));
    const used = new Set<string>();
    const sheets: SheetData[] = [];
    sheets.push({
      title: safeSheetTitle("작성현황", used),
      values: [
        ["번호", "이름", "교과 평어 작성", "교과 평어 확정", "행동특성 작성", "행동특성 확정"],
        ...ordered.map((student) => {
          const records = subjects.map((subject) => commentMap.get(`${student.id}|${subject}`));
          const behavior = behaviorMap.get(Number(student.id));
          return [student.number, student.name, records.filter((item) => item?.comment).length, records.filter((item) => item?.confirmed).length, behavior?.behavior ? "완료" : "미작성", behavior?.confirmed ? "확정" : "미확정"];
        }),
      ],
    });
    sheets.push({
      title: safeSheetTitle("교과평어 통합", used),
      values: [
        ["번호", "이름", "과목", "교과 평어", "상태", "최종 수정일"],
        ...subjects.flatMap((subject) => ordered.map((student) => {
          const item = commentMap.get(`${student.id}|${subject}`);
          return [student.number, student.name, subject, item?.comment ?? "", item?.confirmed ? "확정" : item?.comment ? "미확정" : "미작성", item?.updated_at ? new Date(item.updated_at).toLocaleString("ko-KR") : ""];
        })),
      ],
    });
    for (const subject of subjects) {
      sheets.push({
        title: safeSheetTitle(subject, used),
        values: [
          ["번호", "이름", "평어", "상태"],
          ...ordered.map((student) => {
            const item = commentMap.get(`${student.id}|${subject}`);
            return [student.number, student.name, item?.comment ?? "", item?.confirmed ? "확정" : item?.comment ? "미확정" : "미작성"];
          }),
        ],
      });
    }
    sheets.push({
      title: safeSheetTitle("행동특성", used),
      values: [
        ["번호", "이름", "입력 특성", "행동특성 및 발달상황", "상태", "최종 수정일"],
        ...ordered.map((student) => {
          const item = behaviorMap.get(Number(student.id));
          return [student.number, student.name, item?.characteristic ?? "", item?.behavior ?? "", item?.confirmed ? "확정" : item?.behavior ? "미확정" : "미작성", item?.updated_at ? new Date(item.updated_at).toLocaleString("ko-KR") : ""];
        }),
      ],
    });
    const title = `기록샘 ${classroom.school_name} ${classroom.school_year}학년도 ${classroom.grade}학년 ${classroom.class_number}반`;
    const created = await googleApi<{ spreadsheetId: string; spreadsheetUrl: string; sheets: { properties: { sheetId: number; title: string } }[] }>(
      "https://sheets.googleapis.com/v4/spreadsheets",
      token,
      { method: "POST", body: JSON.stringify({ properties: { title }, sheets: sheets.map((sheet) => ({ properties: { title: sheet.title } })) }) },
    );
    await googleApi(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(created.spreadsheetId)}/values:batchUpdate`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          valueInputOption: "RAW",
          data: sheets.map((sheet) => ({ range: `'${sheet.title.replaceAll("'", "''")}'!A1`, values: sheet.values })),
        }),
      },
    );
    await googleApi(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(created.spreadsheetId)}:batchUpdate`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          requests: created.sheets.flatMap((sheet) => [
            { updateSheetProperties: { properties: { sheetId: sheet.properties.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
            { repeatCell: { range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.39, blue: 0.78 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
            { autoResizeDimensions: { dimensions: { sheetId: sheet.properties.sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: Math.max(4, sheets.find((item) => item.title === sheet.properties.title)?.values[0]?.length ?? 4) } } },
          ]),
        }),
      },
    );
    return Response.json({ ok: true, spreadsheetUrl: created.spreadsheetUrl, spreadsheetId: created.spreadsheetId, title });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401) return Response.json({ error: "Google 연결이 만료되었습니다. 다시 연결해 주세요.", reconnect: true }, { status: 401 });
    return dataError(error, "Google 스프레드시트를 생성하지 못했습니다.");
  }
}
