"use client";

import { useEffect, useState } from "react";
import { recordSimilarity, validateRecord } from "./record-validation";

type View = "dashboard" | "classes" | "students" | "plans" | "assessments" | "comments" | "behavior" | "export" | "settings";
type Level = "상" | "중" | "하" | "-";
type AssessmentPlan = {
  id?: number;
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
  sortOrder?: number;
};
type ClassroomInfo = {
  id?: number;
  schoolName: string;
  schoolYear: number;
  semester: number;
  grade: number;
  classNumber: number;
};

const defaultPlan: AssessmentPlan[] = [
  { subject: "국어", unit: "1단원", goal: "상황과 인물의 마음을 살려 표현하기", domain: "듣기·말하기", type: "수행평가", perspective: "표정, 몸짓, 목소리 활용", high: "실감 나게 표현함", middle: "알맞게 표현함", low: "도움을 받아 표현함", caution: "" },
  { subject: "국어", unit: "2단원", goal: "문장의 기본 짜임을 이해하기", domain: "문법", type: "서술형", perspective: "문장 짜임 이해", high: "정확히 나타냄", middle: "대체로 나타냄", low: "도움을 받아 나타냄", caution: "" },
  { subject: "국어", unit: "3단원", goal: "작품의 느낌과 생각 표현하기", domain: "문학", type: "서술형", perspective: "근거를 들어 표현", high: "구체적으로 표현함", middle: "알맞게 표현함", low: "도움을 받아 표현함", caution: "" },
];

const behaviorReferences = [
  { category: "학습 관련", strengths: ["과제에 끈기 있게 참여함", "탐구적 태도가 돋보임", "문제 해결 능력이 우수함", "자기주도적으로 학습함"], growth: ["기초를 차근차근 다지는 중임", "학습 몰입 시간을 늘려 가고 있음", "꾸준한 학습 습관을 형성하는 중임"] },
  { category: "수업 태도", strengths: ["바른 자세로 경청함", "수업 집중도가 높음", "과제를 성실히 수행함", "질문을 통해 문제를 해결함"], growth: ["집중을 유지하려고 노력함", "수업 참여 경험을 넓혀 가고 있음", "발표와 대화의 적절한 시기를 익혀 가는 중임"] },
  { category: "관계·사회성", strengths: ["친구를 배려하고 존중함", "모둠 활동에서 리더십을 발휘함", "소통 능력이 우수함", "친구들과 협력함"], growth: ["다른 의견을 조율하는 경험이 필요함", "협력적인 태도를 형성해 가고 있음", "또래 관계의 범위를 넓혀 가고 있음"] },
  { category: "성향·기질", strengths: ["긍정적으로 생각함", "책임감이 강함", "차분하고 침착함", "끈기와 인내심이 있음"], growth: ["감정을 차분히 표현하는 방법을 익혀 가고 있음", "행동하기 전에 생각하는 습관을 기르는 중임", "자신 있게 의견을 표현하는 경험이 필요함"] },
  { category: "성장·변화", strengths: ["스스로 발전하기 위해 노력함", "피드백을 적극적으로 수용함", "긍정적인 행동 변화가 돋보임", "잠재력을 꾸준히 발휘함"], growth: ["자신의 속도에 맞춰 꾸준히 노력함", "목표를 지속해서 실천하는 힘을 기르는 중임", "계획을 행동으로 옮기는 연습이 필요함"] },
  { category: "표현·창의", strengths: ["상상력이 풍부함", "창의적인 아이디어를 제시함", "독창적으로 표현함", "다양한 방법으로 문제에 접근함"], growth: ["생각을 구체화하는 연습이 필요함", "참고한 표현을 자신만의 방식으로 발전시키는 중임", "자신의 생각을 적극적으로 표현하는 경험이 필요함"] },
  { category: "예체능·특기", strengths: ["예술적 감수성이 풍부함", "신체 활동 능력이 우수함", "음악적 감각이 풍부함", "문화예술에 관심이 많음"], growth: ["자신의 소질을 꾸준히 계발할 필요가 있음", "예체능 활동에 적극적으로 참여하는 경험이 필요함", "관심과 흥미를 지속하는 태도를 기르는 중임"] },
  { category: "자기관리·생활", strengths: ["규칙을 잘 준수함", "시간을 계획적으로 관리함", "주변을 깨끗하게 정리함", "건강한 생활 습관을 실천함"], growth: ["정리정돈 습관을 형성해 가고 있음", "규칙을 스스로 지키려는 노력이 필요함", "계획한 일을 스스로 실천하는 힘을 기르는 중임"] },
];

const students = [
  { id: 1, name: "김도윤", assessments: ["상", "중", "상"] as Level[], status: "확정", note: "친구의 발표를 경청하고 자신의 생각을 또렷하게 표현함" },
  { id: 2, name: "이서아", assessments: ["중", "중", "상"] as Level[], status: "검토 중", note: "모둠 활동에서 역할을 끝까지 책임감 있게 수행함" },
  { id: 3, name: "박지후", assessments: ["하", "중", "-"] as Level[], status: "미생성", note: "교사의 도움을 받아 활동 과정을 차근차근 완성함" },
  { id: 4, name: "최하린", assessments: ["상", "상", "중"] as Level[], status: "확정", note: "상황에 알맞은 목소리와 표정으로 실감 나게 발표함" },
  { id: 5, name: "정시우", assessments: ["중", "상", "중"] as Level[], status: "검토 중", note: "새로운 문제에도 여러 방법을 시도하며 해결함" },
  { id: 6, name: "한예준", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 7, name: "윤서윤", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 8, name: "강민재", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 9, name: "조유나", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 10, name: "임도현", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 11, name: "신채원", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 12, name: "오준서", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 13, name: "서지아", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 14, name: "권하준", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 15, name: "황수빈", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 16, name: "송지호", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 17, name: "안다은", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 18, name: "류건우", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 19, name: "전소율", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 20, name: "홍현우", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 21, name: "문예린", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 22, name: "배도경", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 23, name: "백나윤", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 24, name: "남태윤", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
  { id: 25, name: "노가은", assessments: ["-", "-", "-"] as Level[], status: "미생성", note: "" },
];

const seededLevel = (studentId: number, subjectIndex: number, assessmentIndex: number): Level => {
  const levels: Level[] = ["상", "중", "하"];
  const mixed = (studentId * 17 + subjectIndex * 11 + assessmentIndex * 7 + studentId * assessmentIndex) % levels.length;
  return levels[mixed];
};

const withSampleLevels = (student: (typeof students)[number], subjectIndex: number, count: number): AssessmentStudent => ({
  ...student,
  assessments: Array.from({ length: count }, (_, assessmentIndex) => seededLevel(student.id, subjectIndex, assessmentIndex)),
});

const navItems: { id: View; label: string; icon: string }[] = [
  { id: "dashboard", label: "대시보드", icon: "⌂" },
  { id: "classes", label: "학급 관리", icon: "▣" },
  { id: "students", label: "학생 관리", icon: "♙" },
  { id: "plans", label: "평가계획 관리", icon: "▤" },
  { id: "assessments", label: "평가 수준 입력", icon: "▦" },
  { id: "comments", label: "교과 평어", icon: "✦" },
  { id: "behavior", label: "행동특성", icon: "◎" },
];

function Dashboard({ move, teacherName, classroom, studentCount, completedLevels, totalLevels, commentCount, expectedComments, behaviorCount }: {
  move: (view: View) => void;
  teacherName: string;
  classroom: ClassroomInfo | null;
  studentCount: number;
  completedLevels: number;
  totalLevels: number;
  commentCount: number;
  expectedComments: number;
  behaviorCount: number;
}) {
  const levelProgress = totalLevels ? Math.round((completedLevels / totalLevels) * 100) : 0;
  const commentProgress = expectedComments ? Math.round((commentCount / expectedComments) * 100) : 0;
  const behaviorProgress = studentCount ? Math.round((behaviorCount / studentCount) * 100) : 0;
  const cards = [
    { label: "학생", value: `${studentCount}명`, detail: "재적 학생", tone: "blue" },
    { label: "평가 입력", value: `${levelProgress}%`, detail: `${completedLevels} / ${totalLevels}개`, tone: "mint" },
    { label: "교과 평어", value: `${commentCount}건`, detail: `전체 ${expectedComments}건`, tone: "amber" },
    { label: "행동특성", value: `${behaviorCount}명`, detail: `전체 ${studentCount}명`, tone: "violet" },
  ];
  const tasks = [
    { title: "평가 수준 입력", detail: totalLevels ? `${Math.max(totalLevels - completedLevels, 0)}개 항목이 남았습니다.` : "평가계획과 학생 명단을 먼저 등록하세요.", action: levelProgress === 100 ? "확인하기" : "이어하기", view: "assessments" as View, progress: levelProgress },
    { title: "교과 평어 작성", detail: expectedComments ? `${Math.max(expectedComments - commentCount, 0)}건의 평어가 남았습니다.` : "평가계획과 학생 명단을 먼저 등록하세요.", action: commentProgress === 100 ? "검토하기" : "작성하기", view: "comments" as View, progress: commentProgress },
    { title: "행동특성 작성", detail: `${Math.max(studentCount - behaviorCount, 0)}명의 행동특성이 남았습니다.`, action: behaviorProgress === 100 ? "검토하기" : "기록하기", view: "behavior" as View, progress: behaviorProgress },
  ];

  return (
    <>
      <section className="welcome">
        <div>
          <p className="eyebrow">{classroom ? `${classroom.schoolYear}학년도 · ${classroom.semester}학기` : "학급 정보를 불러오는 중"}</p>
          <h1>{teacherName} 선생님, 안녕하세요.</h1>
          <p>오늘도 학생의 성장을 세심하게 기록해 볼까요?</p>
        </div>
        <button className="class-button" onClick={() => move("classes")}>{classroom ? `${classroom.schoolName} · ${classroom.grade}학년 ${classroom.classNumber}반` : "학급 정보 확인 중"} <span>⌄</span></button>
      </section>

      <section className="stats-grid" aria-label="학급 진행 현황">
        {cards.map((card) => (
          <article className={`stat-card ${card.tone}`} key={card.label}>
            <div className="stat-top"><span>{card.label}</span><span className="trend">↗</span></div>
            <strong>{card.value}</strong>
            <small>{card.detail}</small>
          </article>
        ))}
      </section>

      <div className="dashboard-grid">
        <section className="panel task-panel">
          <div className="section-heading">
            <div><p className="eyebrow">TO DO</p><h2>지금 할 일</h2></div>
            <button className="text-button">전체 보기 →</button>
          </div>
          <div className="task-list">
            {tasks.map((task) => (
              <article className="task-row" key={task.title}>
                <div className="task-check">✓</div>
                <div className="task-copy">
                  <strong>{task.title}</strong>
                  <span>{task.detail}</span>
                  <div className="progress"><i style={{ width: `${task.progress}%` }} /></div>
                </div>
                <button onClick={() => move(task.view)}>{task.action}</button>
              </article>
            ))}
          </div>
        </section>

        <aside className="panel quick-panel">
          <div className="section-heading"><div><p className="eyebrow">QUICK START</p><h2>빠른 시작</h2></div></div>
          <button onClick={() => move("assessments")}><span className="quick-icon">▦</span><span><b>평가 수준 입력</b><small>등록된 평가계획으로 시작하기</small></span><i>›</i></button>
          <button onClick={() => move("comments")}><span className="quick-icon">✦</span><span><b>교과 평어 생성</b><small>입력된 평가로 초안 만들기</small></span><i>›</i></button>
          <button onClick={() => move("behavior")}><span className="quick-icon">＋</span><span><b>학생 관찰 기록</b><small>특성과 성장 모습 남기기</small></span><i>›</i></button>
        </aside>
      </div>

      <section className="privacy-banner">
        <span>◈</span><div><strong>학생 정보는 안전하게 보호됩니다</strong><p>AI 문장 생성 시 학생 이름은 자동으로 비식별 처리되며, 입력하지 않은 사실은 문장에 포함하지 않습니다.</p></div>
        <button onClick={() => move("settings")}>보호 원칙 보기</button>
      </section>
    </>
  );
}

type ManagedClassroom = ClassroomInfo & { id: number };

function ClassroomManager({ current }: { current: ClassroomInfo | null }) {
  const [classrooms, setClassrooms] = useState<ManagedClassroom[]>([]);
  const [form, setForm] = useState({
    schoolName: current?.schoolName ?? "",
    schoolYear: current?.schoolYear ?? new Date().getFullYear(),
    semester: current?.semester ?? 1,
    grade: current?.grade ?? 1,
    classNumber: current?.classNumber ?? 1,
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const response = await fetch("/api/classrooms");
    const result = await response.json() as { classrooms?: ManagedClassroom[]; error?: string };
    if (!response.ok) return setMessage(result.error || "학급 목록을 불러오지 못했습니다.");
    setClassrooms(result.classrooms ?? []);
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!current) return;
    setForm({
      schoolName: current.schoolName,
      schoolYear: current.schoolYear,
      semester: current.semester,
      grade: current.grade,
      classNumber: current.classNumber,
    });
  }, [current]);
  const createClassroom = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/classrooms", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const result = await response.json() as { classroom?: ManagedClassroom; error?: string };
      if (!response.ok || !result.classroom) throw new Error(result.error || "학급을 추가하지 못했습니다.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학급을 추가하지 못했습니다.");
      setBusy(false);
    }
  };
  const selectClassroom = async (id: number) => {
    if (id === current?.id) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/classrooms", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "학급을 전환하지 못했습니다.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학급을 전환하지 못했습니다.");
      setBusy(false);
    }
  };
  const deleteClassroom = async (item: ManagedClassroom) => {
    const label = `${item.schoolName} ${item.schoolYear}학년도 ${item.semester}학기 ${item.grade}학년 ${item.classNumber}반`;
    if (!window.confirm(`${label}과 연결된 학생·평가·생성 문장을 모두 영구 삭제할까요?\n\n삭제한 자료는 복구할 수 없습니다.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/classrooms", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, confirmation: "학급삭제" }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "학급을 삭제하지 못했습니다.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학급을 삭제하지 못했습니다.");
      setBusy(false);
    }
  };
  const updateForm = (key: keyof typeof form, value: string) => setForm((currentForm) => ({
    ...currentForm,
    [key]: key === "schoolName" ? value : Number(value),
  }));
  return <section>
    <div className="page-heading"><div><p className="eyebrow">SCHOOL & CLASS</p><h1>학급 관리</h1><p>학년도·학기·학년·반별로 자료를 완전히 분리해 관리하세요.</p></div></div>
    {message && <p className="student-message">{message}</p>}
    <div className="classroom-layout">
      <section className="classroom-list-panel">
        <div className="section-heading"><div><p className="eyebrow">MY CLASSES</p><h2>내 학급 · {classrooms.length}개</h2></div></div>
        <div className="classroom-list">{classrooms.map((item) => {
          const active = item.id === current?.id;
          return <article className={active ? "active" : ""} key={item.id}>
            <button className="classroom-select" disabled={busy} onClick={() => void selectClassroom(item.id)}>
              <span className="classroom-icon">{item.grade}</span>
              <span><b>{item.schoolName}</b><small>{item.schoolYear}학년도 {item.semester}학기 · {item.grade}학년 {item.classNumber}반</small></span>
              <i>{active ? "사용 중" : "전환"}</i>
            </button>
            <button className="classroom-delete" disabled={busy || classrooms.length <= 1} title={classrooms.length <= 1 ? "새 학급을 추가한 뒤 삭제할 수 있습니다." : "학급과 연결 자료 삭제"} onClick={() => void deleteClassroom(item)}>삭제</button>
          </article>;
        })}</div>
      </section>
      <section className="classroom-create-panel">
        <div className="section-heading"><div><p className="eyebrow">NEW CLASS</p><h2>학급 추가</h2></div></div>
        <p>새 학급은 빈 학생 명단과 평가계획으로 시작합니다. 기존 학급 자료에는 영향을 주지 않습니다.</p>
        <form onSubmit={(event) => void createClassroom(event)}>
          <label className="wide"><span>학교명</span><input required value={form.schoolName} onChange={(event) => updateForm("schoolName", event.target.value)} /></label>
          <label><span>학년도</span><input type="number" min="2020" max="2100" required value={form.schoolYear} onChange={(event) => updateForm("schoolYear", event.target.value)} /></label>
          <label><span>학기</span><select value={form.semester} onChange={(event) => updateForm("semester", event.target.value)}><option value="1">1학기</option><option value="2">2학기</option></select></label>
          <label><span>학년</span><select value={form.grade} onChange={(event) => updateForm("grade", event.target.value)}>{[1, 2, 3, 4, 5, 6].map((grade) => <option value={grade} key={grade}>{grade}학년</option>)}</select></label>
          <label><span>반</span><input type="number" min="1" max="30" required value={form.classNumber} onChange={(event) => updateForm("classNumber", event.target.value)} /></label>
          <button className="wide" disabled={busy}>{busy ? "처리 중…" : "새 학급 추가 후 전환"}</button>
        </form>
      </section>
    </div>
  </section>;
}

function StudentManager({ roster, onAdded, onChanged, onDeleted, onImported }: {
  roster: AssessmentStudent[];
  onAdded: (student: { id: number; number: number; name: string }) => void;
  onChanged: (student: { id: number; number: number; name: string }) => void;
  onDeleted: (id: number) => void;
  onImported: (students: Array<{ id: number; number: number; name: string }>) => void;
}) {
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, { number: number; name: string }>>({});

  useEffect(() => {
    setDrafts(Object.fromEntries(roster.map((student) => [student.id, {
      number: student.number ?? student.id,
      name: student.name,
    }])));
  }, [roster]);

  async function addStudent(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number: Number(number), name }),
    });
    const result = await response.json() as { student?: { id: number; number: number; name: string }; error?: string };
    if (!response.ok || !result.student) return setMessage(result.error ?? "학생을 추가하지 못했습니다.");
    onAdded(result.student);
    setNumber("");
    setName("");
    setMessage(`${result.student.name} 학생을 추가했습니다.`);
  }

  async function saveStudent(id: number) {
    const draft = drafts[id];
    if (!draft) return;
    setMessage("");
    const response = await fetch("/api/students", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...draft }),
    });
    const result = await response.json() as { student?: { id: number; number: number; name: string }; error?: string };
    if (!response.ok || !result.student) return setMessage(result.error ?? "학생 정보를 수정하지 못했습니다.");
    onChanged(result.student);
    setMessage(`${result.student.name} 학생 정보를 저장했습니다.`);
  }

  async function uploadRoster(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const parsed = rows.flatMap((row) => {
        const rawNumber = row["번호"] ?? row["순번"] ?? row["No"] ?? row["no"];
        const rawName = row["이름"] ?? row["학생명"] ?? row["성명"] ?? row["name"];
        const studentNumber = Number(rawNumber);
        const studentName = String(rawName ?? "").trim();
        return Number.isInteger(studentNumber) && studentNumber > 0 && studentName
          ? [{ number: studentNumber, name: studentName }]
          : [];
      });
      if (!parsed.length) throw new Error("첫 행에 ‘번호’와 ‘이름’ 열이 있는지 확인해 주세요.");
      if (parsed.length !== rows.length) throw new Error("번호 또는 이름이 비어 있는 행이 있습니다.");
      if (new Set(parsed.map((row) => row.number)).size !== parsed.length) throw new Error("중복된 학생 번호가 있습니다.");
      const response = await fetch("/api/students", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ students: parsed }),
      });
      const result = await response.json() as { students?: Array<{ id: number; number: number; name: string }>; error?: string };
      if (!response.ok || !result.students) throw new Error(result.error ?? "명단을 저장하지 못했습니다.");
      onImported(result.students);
      setMessage(`${result.students.length}명의 명단을 저장했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "파일을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const csv = "\uFEFF번호,이름\n1,홍길동\n2,김하늘\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "기록샘_학생명단_양식.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return <section>
    <div className="page-heading"><div><p className="eyebrow">CLASS ROSTER</p><h1>학생 관리</h1><p>번호와 이름만 등록하며, 업로드한 파일은 브라우저에서 읽은 뒤 현재 학급에 저장됩니다.</p></div></div>
    <div className="student-tools">
      <form onSubmit={addStudent}>
        <input aria-label="추가할 학생 번호" type="number" min="1" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="번호" required />
        <input aria-label="추가할 학생 이름" value={name} onChange={(event) => setName(event.target.value)} placeholder="이름" required />
        <button type="submit">학생 추가</button>
      </form>
      <div>
        <button type="button" onClick={downloadTemplate}>CSV 양식 받기</button>
        <label className="file-upload-button">{busy ? "업로드 중…" : "Excel·CSV 명단 업로드"}<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void uploadRoster(event)} disabled={busy} /></label>
      </div>
    </div>
    {message && <p className="student-message" role="status">{message}</p>}
    <div className="table-wrap student-table-wrap"><table className="students-table">
      <thead><tr><th>번호</th><th>이름</th><th>관리</th></tr></thead>
      <tbody>{roster.length ? roster.map((student) => {
        const draft = drafts[student.id] ?? { number: student.number ?? student.id, name: student.name };
        return <tr key={student.id}>
          <td><input aria-label={`${student.name} 번호`} type="number" min="1" value={draft.number} onChange={(event) => setDrafts((current) => ({ ...current, [student.id]: { ...draft, number: Number(event.target.value) } }))} /></td>
          <td><input aria-label={`${student.name} 이름`} value={draft.name} onChange={(event) => setDrafts((current) => ({ ...current, [student.id]: { ...draft, name: event.target.value } }))} /></td>
          <td><button onClick={() => void saveStudent(student.id)}>저장</button><button className="danger-text" onClick={() => onDeleted(student.id)}>비활성화</button></td>
        </tr>;
      }) : <tr><td colSpan={3} className="empty-cell">등록된 학생이 없습니다. 직접 추가하거나 명단을 업로드해 주세요.</td></tr>}</tbody>
    </table></div>
  </section>;
}

const blankPlan = (): AssessmentPlan => ({
  subject: "", unit: "", goal: "", domain: "", type: "수행평가",
  perspective: "", high: "", middle: "", low: "", caution: "",
});

function PlanManager({ plan, onChanged }: { plan: AssessmentPlan[]; onChanged: (plan: AssessmentPlan[]) => void }) {
  const [draft, setDraft] = useState<AssessmentPlan>(blankPlan);
  const [preview, setPreview] = useState<AssessmentPlan[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const columns: Array<[keyof AssessmentPlan, string]> = [
    ["subject", "과목"], ["unit", "단원"], ["goal", "평가목표"], ["domain", "영역"],
    ["type", "평가 유형"], ["perspective", "평가 관점"], ["high", "상"], ["middle", "중"],
    ["low", "하"], ["caution", "평가상의 유의점"],
  ];
  const validatePlans = (rows: AssessmentPlan[]) => {
    const found: string[] = [];
    const keys = new Set<string>();
    rows.forEach((row, index) => {
      const required = [row.subject, row.unit, row.goal, row.domain, row.perspective, row.high, row.middle, row.low];
      if (required.some((value) => !value.trim())) found.push(`${index + 2}행: 필수 항목이 비어 있습니다.`);
      if (new Set([row.high.trim(), row.middle.trim(), row.low.trim()]).size < 3) found.push(`${index + 2}행: 상·중·하 기준은 서로 달라야 합니다.`);
      const key = `${row.subject.trim()}|${row.unit.trim()}|${row.goal.trim()}`;
      if (keys.has(key)) found.push(`${index + 2}행: 과목·단원·평가목표가 중복됩니다.`);
      keys.add(key);
    });
    return found;
  };
  const saveMany = async (rows: AssessmentPlan[]) => {
    const validation = validatePlans(rows);
    if (validation.length) return setErrors(validation);
    setBusy(true);
    setErrors([]);
    try {
      const response = await fetch("/api/assessment-plan", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: rows }),
      });
      const result = await response.json() as { plan?: AssessmentPlan[]; error?: string };
      if (!response.ok || !result.plan) throw new Error(result.error || "평가계획을 저장하지 못했습니다.");
      const merged = [...plan];
      result.plan.forEach((item) => {
        const index = merged.findIndex((current) => current.subject === item.subject && current.unit === item.unit && current.goal === item.goal);
        if (index >= 0) merged[index] = item; else merged.push(item);
      });
      onChanged(merged.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
      setPreview([]);
      setMessage(`${result.plan.length}개 평가계획을 저장했습니다.`);
      setDraft(blankPlan());
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "평가계획을 저장하지 못했습니다."]);
    } finally {
      setBusy(false);
    }
  };
  const updateItem = async (item: AssessmentPlan) => {
    setBusy(true);
    try {
      const response = await fetch("/api/assessment-plan", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item),
      });
      const result = await response.json() as { item?: AssessmentPlan; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || "수정하지 못했습니다.");
      onChanged(plan.map((current) => current.id === item.id ? result.item! : current));
      setMessage("평가계획을 수정했습니다.");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "수정하지 못했습니다."]);
    } finally { setBusy(false); }
  };
  const deleteItem = async (item: AssessmentPlan) => {
    if (!item.id || !window.confirm(`${item.subject} ${item.unit} 평가계획을 삭제할까요?`)) return;
    const response = await fetch(`/api/assessment-plan?id=${item.id}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) return setErrors([result.error || "삭제하지 못했습니다."]);
    onChanged(plan.filter((current) => current.id !== item.id));
    setMessage("평가계획을 삭제했습니다.");
  };
  const upload = async (file: File) => {
    setMessage("");
    setErrors([]);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const aliases: Record<string, keyof AssessmentPlan> = {
        "과목": "subject", "단원": "unit", "평가목표": "goal", "평가 목표": "goal", "영역": "domain",
        "평가유형": "type", "평가 유형": "type", "평가관점": "perspective", "평가 관점": "perspective",
        "상": "high", "중": "middle", "하": "low", "평가상의 유의점": "caution", "유의점": "caution",
      };
      const rows = raw.map((source) => {
        const row = blankPlan();
        Object.entries(source).forEach(([header, value]) => {
          const key = aliases[header.trim()];
          if (key && key !== "id" && key !== "sortOrder") row[key] = String(value ?? "").trim();
        });
        return row;
      }).filter((row) => Object.values(row).some(Boolean));
      if (!rows.length) throw new Error("첫 번째 시트에서 평가계획을 찾지 못했습니다.");
      if (rows.length > 200) throw new Error("한 번에 200개까지만 업로드할 수 있습니다.");
      const validation = validatePlans(rows);
      setPreview(rows);
      setErrors(validation);
      setMessage(validation.length ? "오류를 수정한 뒤 다시 업로드해 주세요." : `${rows.length}개 평가계획이 검증되었습니다. 내용을 확인하고 저장하세요.`);
    } catch (error) {
      setPreview([]);
      setErrors([error instanceof Error ? error.message : "파일을 읽지 못했습니다."]);
    }
  };
  const downloadTemplate = () => {
    const headers = columns.map(([, label]) => label).join(",");
    const sample = ["국어", "1단원", "상황에 알맞게 표현하기", "듣기·말하기", "수행평가", "표정과 목소리 활용", "실감 나게 표현함", "알맞게 표현함", "도움을 받아 표현함", ""]
      .map((value) => `"${value}"`).join(",");
    const blob = new Blob([`\uFEFF${headers}\n${sample}`], { type: "text/csv;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "평가계획_업로드_양식.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  const changePlan = (id: number | undefined, key: keyof AssessmentPlan, value: string) => {
    onChanged(plan.map((item) => item.id === id ? { ...item, [key]: value } : item));
  };
  return <section>
    <div className="page-heading">
      <div><p className="eyebrow">학급별 평가 기준</p><h1>평가계획 관리</h1><p>직접 입력하거나 Excel·CSV를 검증한 뒤 저장하세요.</p></div>
      <div className="heading-actions"><button className="secondary" onClick={downloadTemplate}>업로드 양식 받기</button><label className="file-upload-button">Excel/CSV 불러오기<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /></label></div>
    </div>
    <div className="plan-help"><strong>필수 열</strong> 과목 · 단원 · 평가목표 · 영역 · 평가 관점 · 상 · 중 · 하 <span>평가 유형과 유의점은 선택 항목입니다.</span></div>
    {message && <p className="student-message">{message}</p>}
    {!!errors.length && <div className="plan-errors"><strong>확인이 필요합니다.</strong>{errors.slice(0, 8).map((error) => <p key={error}>• {error}</p>)}</div>}
    {!!preview.length && <section className="plan-preview">
      <div className="section-heading"><div><p className="eyebrow">PREVIEW</p><h2>저장 전 미리보기 · {preview.length}개</h2></div><button disabled={busy || !!errors.length} onClick={() => void saveMany(preview)}>{busy ? "저장 중…" : "검증된 계획 저장"}</button></div>
      <div className="plan-preview-list">{preview.slice(0, 8).map((item, index) => <article key={`${item.subject}-${item.unit}-${index}`}><b>{item.subject} · {item.unit}</b><span>{item.goal}</span><small>{item.domain} / {item.type || "유형 미입력"}</small></article>)}</div>
    </section>}
    <section className="plan-entry">
      <div className="section-heading"><div><p className="eyebrow">DIRECT INPUT</p><h2>평가계획 직접 추가</h2></div><button disabled={busy} onClick={() => void saveMany([draft])}>＋ 계획 추가</button></div>
      <div className="plan-form">{columns.map(([key, label]) => <label key={key}><span>{label}</span><input value={String(draft[key] ?? "")} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}</div>
    </section>
    <section className="plan-list">
      <div className="section-heading"><div><p className="eyebrow">SAVED</p><h2>저장된 평가계획 · {plan.length}개</h2></div></div>
      {plan.map((item, index) => <article className="plan-card" key={item.id ?? `${item.subject}-${index}`}>
        <div className="plan-card-title"><strong>{index + 1}. {item.subject} · {item.unit}</strong><span>{item.domain}</span></div>
        <div className="plan-card-fields">{columns.slice(2).map(([key, label]) => <label key={key}><span>{label}</span><input value={String(item[key] ?? "")} onChange={(event) => changePlan(item.id, key, event.target.value)} /></label>)}</div>
        <div className="plan-card-actions"><button disabled={busy || !item.id} onClick={() => void updateItem(item)}>수정 저장</button><button className="danger-text" disabled={!item.id} onClick={() => void deleteItem(item)}>삭제</button></div>
      </article>)}
      {!plan.length && <p className="empty-cell">저장된 평가계획이 없습니다.</p>}
    </section>
  </section>;
}

type AssessmentStudent = {
  id: number;
  number?: number;
  name: string;
  assessments: Level[];
  status: string;
  note: string;
};

function Assessments({ data, setData, plan, activeSubject, setActiveSubject, onAddStudent, onDeleteStudent, onSave }: {
  data: AssessmentStudent[];
  setData: React.Dispatch<React.SetStateAction<AssessmentStudent[]>>;
  plan: AssessmentPlan[];
  activeSubject: string;
  setActiveSubject: (subject: string) => void;
  onAddStudent: () => void;
  onDeleteStudent: (id: number) => void;
  onSave: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [bulkLevel, setBulkLevel] = useState<Level>("중");
  const [message, setMessage] = useState("");
  const subjects = [...new Set(plan.map((item) => item.subject))];
  const visiblePlan = plan.filter((item) => item.subject === activeSubject);
  const completedCount = data.reduce((count, student) => count + student.assessments.filter((level) => level !== "-").length, 0);
  const expectedCount = data.length * visiblePlan.length;

  const changeSubject = (subject: string) => {
    setActiveSubject(subject);
    setSaved(false);
    setMessage("");
  };
  const cycle = (row: number, col: number) => {
    const order: Level[] = ["-", "상", "중", "하"];
    setData((current) => current.map((student, r) => r !== row ? student : {
      ...student,
      assessments: student.assessments.map((level, c) => c !== col ? level : order[(order.indexOf(level) + 1) % order.length]),
    }));
    setSaved(false);
    setDirty(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSave();
      setSaved(true);
      setDirty(false);
      setMessage("변경사항을 저장했습니다.");
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    if (!dirty || saving) return;
    const timer = window.setTimeout(() => void save(), 1500);
    return () => window.clearTimeout(timer);
  }, [dirty]);
  const applyToMissing = () => {
    let changed = 0;
    setData((current) => current.map((student) => ({
      ...student,
      assessments: student.assessments.map((level) => {
        if (level !== "-") return level;
        changed += 1;
        return bulkLevel;
      }),
    })));
    setDirty(true);
    setSaved(false);
    setMessage(`${changed}개의 미입력 칸에 '${bulkLevel}'을 적용했습니다.`);
  };
  const clearAll = () => {
    if (!window.confirm(`${activeSubject}의 현재 화면 평가수준을 모두 미입력으로 바꿀까요?`)) return;
    setData((current) => current.map((student) => ({ ...student, assessments: student.assessments.map(() => "-") })));
    setDirty(true);
    setSaved(false);
    setMessage(`${activeSubject} 평가수준을 모두 초기화했습니다.`);
  };
  const pasteLevels = async () => {
    setMessage("");
    try {
      const clipboard = await navigator.clipboard.readText();
      const rows = clipboard.trim().split(/\r?\n/).filter(Boolean).map((line) => line.split("\t").map((cell) => cell.trim()));
      if (!rows.length) throw new Error("클립보드에서 붙여넣을 내용을 찾지 못했습니다.");
      const allowed = new Set<Level>(["상", "중", "하", "-"]);
      const normalized = rows.map((cells) => {
        const direct = cells.slice(0, visiblePlan.length);
        if (direct.every((cell) => allowed.has(cell as Level))) return direct as Level[];
        const trailing = cells.slice(-visiblePlan.length);
        if (trailing.every((cell) => allowed.has(cell as Level))) return trailing as Level[];
        return null;
      });
      if (normalized.some((row) => !row)) throw new Error("붙여넣기 영역에는 상·중·하 또는 -만 입력해 주세요.");
      const usable = normalized.slice(0, data.length) as Level[][];
      setData((current) => current.map((student, rowIndex) => ({
        ...student,
        assessments: student.assessments.map((level, columnIndex) => usable[rowIndex]?.[columnIndex] ?? level),
      })));
      setDirty(true);
      setSaved(false);
      setMessage(`${usable.length}명 × ${visiblePlan.length}개 평가수준을 붙여넣었습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "클립보드 내용을 붙여넣지 못했습니다.");
    }
  };
  return (
    <section>
      <div className="page-heading">
        <div><p className="eyebrow">{activeSubject} · 1학기</p><h1>평가 수준 입력</h1><p>셀을 눌러 학생별 성취 수준을 빠르게 입력하세요.</p></div>
        <div className="heading-actions"><span className={`autosave-state ${saving ? "saving" : dirty ? "dirty" : "saved"}`}>{saving ? "자동 저장 중…" : dirty ? "저장 대기 중" : saved ? "자동 저장됨" : "변경 시 자동 저장"}</span><button className="secondary" onClick={onAddStudent}>＋ 학생 추가</button><button onClick={() => void save()} disabled={saving || !dirty}>{saving ? "저장 중…" : "지금 저장"}</button></div>
      </div>
      <div className="table-tools">
        <div className="subject-tabs">{subjects.map((subject) => <button className={subject === activeSubject ? "active" : ""} onClick={() => changeSubject(subject)} key={subject}>{subject}</button>)}</div>
        <span><i className="level high" /> 상 <i className="level middle" /> 중 <i className="level low" /> 하</span>
      </div>
      <div className="assessment-bulk-tools">
        <div><strong>일괄 입력</strong><select value={bulkLevel} onChange={(event) => setBulkLevel(event.target.value as Level)}><option>상</option><option>중</option><option>하</option></select><button onClick={applyToMissing}>미입력 전체 적용</button><button className="secondary" onClick={() => void pasteLevels()}>엑셀 표 붙여넣기</button><button className="danger-text" onClick={clearAll}>전체 초기화</button></div>
        <span>엑셀에서 학생별 상·중·하 영역만 복사하거나, 번호·이름을 포함한 표를 복사해도 됩니다.</span>
      </div>
      {message && <p className="student-message">{message}</p>}
      <div className="assessment-wrap">
        <table className="assessment-table">
          <thead><tr><th>번호</th><th>학생</th>{visiblePlan.map((item, index) => <th key={`${item.unit}-${item.domain}-${index}`} title={item.goal}><b>{item.unit}</b><small>{item.domain}</small></th>)}<th>관리</th></tr></thead>
          <tbody>{data.map((student, row) => <tr key={student.id}><td>{student.number ?? student.id}</td><td><strong>{student.name}</strong></td>{student.assessments.map((level, col) => <td key={col}><button aria-label={`${student.name} ${col + 1}단원 수준 ${level}`} className={`level-button level-${level}`} onClick={() => cycle(row, col)}>{level}</button></td>)}<td><button className="delete-student" onClick={() => onDeleteStudent(student.id)} aria-label={`${student.name} 삭제`}>삭제</button></td></tr>)}</tbody>
        </table>
      </div>
      <div className="bottom-action"><span>입력 완료 <strong>{completedCount} / {expectedCount}</strong> · 미입력 {Math.max(expectedCount - completedCount, 0)}개</span></div>
    </section>
  );
}

type RevisionItem = {
  id: number;
  content: string;
  characteristic: string;
  confirmed: boolean;
  source: string;
  createdAt: string;
};

function RevisionPanel({ title, revisions, onRestore, onClose }: { title: string; revisions: RevisionItem[]; onRestore: (revision: RevisionItem) => void; onClose: () => void }) {
  const sourceLabel: Record<string, string> = { "manual-edit": "직접 수정", "ai-regeneration": "AI 다시 생성", confirmation: "최종 확정" };
  return <aside className="revision-panel">
    <div className="revision-head"><div><p className="eyebrow">VERSION HISTORY</p><h3>{title} 이전 기록</h3></div><button onClick={onClose}>닫기</button></div>
    {revisions.length ? <div className="revision-list">{revisions.map((revision) => <article key={revision.id}>
      <div><span>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(revision.createdAt))}</span><small>{sourceLabel[revision.source] ?? revision.source}{revision.confirmed ? " · 확정본" : ""}</small></div>
      <p>{revision.content}</p>
      <button onClick={() => onRestore(revision)}>이 버전 복원</button>
    </article>)}</div> : <p className="revision-empty">저장된 이전 기록이 없습니다.</p>}
  </aside>;
}

function Comments({ assessmentDataBySubject, plan, roster }: { assessmentDataBySubject: Record<string, AssessmentStudent[]>; plan: AssessmentPlan[]; roster: AssessmentStudent[] }) {
  type CommentJob = { id: string; status: string; totalItems: number; completedItems: number; failedItems: number; totalBatches: number; currentBatch: number; error?: string; completedAt?: string | null };
  const subjects = [...new Set(plan.map((item) => item.subject))];
  const [selectedSubject, setSelectedSubject] = useState(subjects[0] ?? "국어");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [confirmedComments, setConfirmedComments] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [lastGeneratedAt, setLastGeneratedAt] = useState("");
  const [activeJob, setActiveJob] = useState<CommentJob | null>(null);
  const [history, setHistory] = useState<{ studentId: number; studentName: string; revisions: RevisionItem[] } | null>(null);
  useEffect(() => {
    setLastGeneratedAt(window.localStorage.getItem("giroksam:last-generated-at") ?? "");
  }, []);
  const loadGeneratedComments = async () => {
    try {
      const response = await fetch("/api/generated-comments");
      const result = await response.json() as { comments?: Array<{ studentId: number; subject: string; comment: string; confirmed: boolean; updatedAt: string }> };
      if (!response.ok || !result.comments?.length) return;
      setComments(Object.fromEntries(result.comments.map((item) => [`${item.studentId}|${item.subject}`, item.comment])));
      setConfirmedComments(Object.fromEntries(result.comments.map((item) => [`${item.studentId}|${item.subject}`, item.confirmed])));
      const latest = result.comments.map((item) => item.updatedAt).sort().at(-1);
      if (latest) {
        setLastGeneratedAt(latest);
        window.localStorage.setItem("giroksam:last-generated-at", latest);
      }
    } catch {
      // 저장된 결과를 불러오지 못해도 새 생성은 계속 사용할 수 있음.
    }
  };
  useEffect(() => {
    void loadGeneratedComments();
    fetch("/api/comment-jobs").then(async (response) => {
      const result = await response.json() as { job?: CommentJob | null };
      if (response.ok && result.job) {
        setActiveJob(result.job);
        if (["queued", "running"].includes(result.job.status)) setLoading(true);
      }
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!activeJob || !["queued", "running"].includes(activeJob.status)) return;
    setGenerationProgress(`${activeJob.completedItems}/${activeJob.totalItems}`);
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch("/api/comment-jobs");
        const result = await response.json() as { job?: CommentJob | null };
        if (!response.ok || !result.job) return;
        setActiveJob(result.job);
        setGenerationProgress(`${result.job.completedItems}/${result.job.totalItems}`);
        if (!["queued", "running"].includes(result.job.status)) {
          window.clearInterval(timer);
          setLoading(false);
          setGenerationProgress("");
          await loadGeneratedComments();
          if (result.job.failedItems) setError(`${result.job.failedItems}건이 생성되지 않았습니다. AI 평어 생성을 다시 누르면 전체 작업을 재시도합니다.`);
          else setError("");
          const generatedAt = result.job.completedAt || new Date().toISOString();
          setLastGeneratedAt(generatedAt);
          window.localStorage.setItem("giroksam:last-generated-at", generatedAt);
        }
      } catch {
        // 페이지 연결이 잠시 끊겨도 서버 작업은 계속 진행됨.
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeJob?.id, activeJob?.status]);
  const formattedLastGeneratedAt = lastGeneratedAt
    ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(lastGeneratedAt))
    : "";
  const copySubjectComments = async () => {
    const text = roster.map((student) => comments[`${student.id}|${selectedSubject}`] ?? "").join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("클립보드 복사 권한을 확인해 주세요.");
    }
  };
  const generateAllComments = async () => {
    setLoading(true);
    setError("");
    setGenerationProgress("작업 등록 중…");
    try {
      const scores = Object.fromEntries(Object.entries(assessmentDataBySubject).map(([subject, data]) => [
        subject,
        data.filter((student) => student.assessments.some((level) => level !== "-"))
          .map((student) => ({ studentId: student.id, levels: student.assessments })),
      ]));
      const response = await fetch("/api/comment-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scores }),
      });
      const result = await response.json() as { job?: CommentJob; error?: string };
      if (!response.ok || !result.job) throw new Error(result.error || "백그라운드 생성 작업을 시작하지 못했습니다.");
      setActiveJob(result.job);
      setGenerationProgress(`${result.job.completedItems}/${result.job.totalItems}`);
      setCopied(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "전 과목 교과 평어를 생성하지 못했습니다.");
      setLoading(false);
      setGenerationProgress("");
    }
  };
  const saveComment = async (studentId: number, subject: string, comment: string, confirmed = false) => {
    try {
      const response = await fetch("/api/generated-comments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, subject, comment, confirmed }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "평어를 저장하지 못했습니다.");
      setConfirmedComments((current) => ({ ...current, [`${studentId}|${subject}`]: confirmed }));
    } catch {
      setError(confirmed ? "검수 항목을 모두 통과한 평어만 확정할 수 있습니다." : "수정한 평어를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };
  const loadHistory = async (studentId: number, studentName: string) => {
    try {
      const response = await fetch(`/api/revisions?type=comment&studentId=${studentId}&subject=${encodeURIComponent(selectedSubject)}`);
      const result = await response.json() as { revisions?: RevisionItem[]; error?: string };
      if (!response.ok) throw new Error(result.error || "이전 기록을 불러오지 못했습니다.");
      setHistory({ studentId, studentName, revisions: result.revisions ?? [] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "이전 기록을 불러오지 못했습니다.");
    }
  };
  const restoreComment = async (revision: RevisionItem) => {
    if (!history) return;
    const key = `${history.studentId}|${selectedSubject}`;
    setComments((current) => ({ ...current, [key]: revision.content }));
    setConfirmedComments((current) => ({ ...current, [key]: false }));
    await saveComment(history.studentId, selectedSubject, revision.content, false);
    setHistory(null);
  };

  return (
    <section>
      <div className="page-heading"><div><p className="eyebrow">AI DRAFT</p><h1>전 과목 교과 평어</h1><p>과목을 선택하면 해당 과목의 학생별 평어를 한 화면에서 확인할 수 있습니다.</p></div><div className="ai-generate-actions">{formattedLastGeneratedAt && <span>마지막 사용 {formattedLastGeneratedAt}</span>}<button onClick={() => void generateAllComments()} disabled={loading}>{loading ? generationProgress || "전 과목 생성 중…" : "✦ AI 평어 생성"}</button></div></div>
      <div className="review-layout comments-review-layout">
        <div className="review-content">
          <div className="comments-toolbar">
            <div className="subject-tabs review-subject-tabs">{subjects.map((subject) => <button className={subject === selectedSubject ? "active" : ""} onClick={() => { setSelectedSubject(subject); setCopied(false); }} key={subject}>{subject}<small>{roster.filter((student) => comments[`${student.id}|${subject}`]).length}/{roster.length}</small></button>)}</div>
            <button className="copy-comments" onClick={() => void copySubjectComments()} disabled={!roster.some((student) => comments[`${student.id}|${selectedSubject}`])}>{copied ? "복사됨 ✓" : "평어만 복사하기"}</button>
          </div>
          {error && <p className="generation-error">! {error}</p>}
          {history && <RevisionPanel title={`${history.studentName} · ${selectedSubject}`} revisions={history.revisions} onRestore={(revision) => void restoreComment(revision)} onClose={() => setHistory(null)} />}
          {loading && <div className="comment-loading class-loading"><span>✦</span><p>모든 학생의 전 과목 평어를 생성하고 있어요.</p></div>}
          <div className="comments-table-wrap">
            <table className="comments-table">
              <thead><tr><th>번호</th><th>이름</th><th>평어</th><th>검수·확정</th></tr></thead>
              <tbody>{roster.map((student, index) => {
                const key = `${student.id}|${selectedSubject}`;
                const text = comments[key] ?? "";
                const assessment = assessmentDataBySubject[selectedSubject]?.[index];
                const hasLevel = assessment?.assessments.some((level) => level !== "-");
                const validation = validateRecord(text);
                const confirmed = confirmedComments[key] ?? false;
                const similarStudents = roster.filter((other) => other.id !== student.id && recordSimilarity(text, comments[`${other.id}|${selectedSubject}`] ?? "") >= 0.82);
                return <tr id={`comment-${student.id}`} key={student.id}>
                  <td>{student.number ?? student.id}</td>
                  <td><strong>{student.name}</strong><small>{text ? `${new TextEncoder().encode(text).length}B` : hasLevel ? "생성 대기" : "수준 미입력"}</small></td>
                  <td><textarea value={text} onChange={(event) => { setComments((current) => ({ ...current, [key]: event.target.value })); setConfirmedComments((current) => ({ ...current, [key]: false })); setCopied(false); }} onBlur={(event) => void saveComment(student.id, selectedSubject, event.target.value)} placeholder={hasLevel ? "AI 평어 생성 버튼을 누르면 결과가 표시됩니다." : "평가 수준이 입력되지 않았습니다."} /></td>
                  <td className="validation-cell"><div><span className={validation.endingsOk ? "pass" : "fail"}>종결 {validation.endingsOk ? "정상" : "확인"}</span><span className={!validation.forbidden.length ? "pass" : "fail"}>금지어 {!validation.forbidden.length ? "없음" : "확인"}</span><span className={!similarStudents.length ? "pass" : "fail"} title={similarStudents.map((item) => item.name).join(", ")}>중복 {!similarStudents.length ? "없음" : `${similarStudents.length}명`}</span></div><button className="history-button" disabled={!text} onClick={() => void loadHistory(student.id, student.name)}>이전 기록</button><button className={confirmed ? "confirmed" : ""} disabled={!validation.valid || !!similarStudents.length} onMouseDown={(event) => event.preventDefault()} onClick={() => void saveComment(student.id, selectedSubject, text, !confirmed)}>{confirmed ? "확정됨 ✓" : "최종 확정"}</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function Behavior({ roster }: { roster: AssessmentStudent[] }) {
  const [records, setRecords] = useState<Record<number, { characteristic: string; behavior: string; confirmed: boolean }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [lastGeneratedAt, setLastGeneratedAt] = useState("");
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(behaviorReferences[0].category);
  const [activeStudentId, setActiveStudentId] = useState<number | null>(roster[0]?.id ?? null);
  const [history, setHistory] = useState<{ studentId: number; studentName: string; revisions: RevisionItem[] } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/student-behaviors");
        const result = await response.json() as { behaviors?: Array<{ studentId: number; characteristic: string; behavior: string; confirmed: boolean; updatedAt: string }> };
        if (!response.ok || !result.behaviors) return;
        setRecords(Object.fromEntries(result.behaviors.map((item) => [item.studentId, { characteristic: item.characteristic, behavior: item.behavior, confirmed: item.confirmed }])));
        setLastGeneratedAt(result.behaviors.map((item) => item.updatedAt).sort().at(-1) ?? "");
      } catch {
        setError("저장된 행동특성을 불러오지 못했습니다.");
      }
    };
    void load();
  }, []);

  const updateRecord = (studentId: number, patch: Partial<{ characteristic: string; behavior: string; confirmed: boolean }>) => {
    setRecords((current) => ({ ...current, [studentId]: { ...(current[studentId] ?? { characteristic: "", behavior: "", confirmed: false }), ...patch } }));
    setCopied(false);
  };
  const addReferencePhrase = (phrase: string) => {
    if (activeStudentId === null) return setError("먼저 학생의 특성 입력칸을 선택해 주세요.");
    const current = records[activeStudentId]?.characteristic?.trim() ?? "";
    updateRecord(activeStudentId, { characteristic: current ? `${current} · ${phrase}` : phrase });
    setError("");
  };
  const generateAll = async () => {
    const inputs = roster.map((student) => ({ studentId: student.id, characteristic: records[student.id]?.characteristic ?? "" })).filter((item) => item.characteristic.trim());
    if (!inputs.length) return setError("한 명 이상의 특성을 입력해 주세요.");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/generate-all-behaviors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ students: inputs }),
      });
      const result = await response.json() as { behaviors?: Array<{ studentId: number; characteristic: string; behavior: string }>; updatedAt?: string; error?: string };
      if (!response.ok || !result.behaviors?.length) throw new Error(result.error || "행동특성을 생성하지 못했습니다.");
      setRecords((current) => ({
        ...current,
        ...Object.fromEntries(result.behaviors!.map((item) => [item.studentId, { characteristic: item.characteristic, behavior: item.behavior, confirmed: false }])),
      }));
      setLastGeneratedAt(result.updatedAt ?? new Date().toISOString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "행동특성을 생성하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };
  const copyBehaviors = async () => {
    try {
      await navigator.clipboard.writeText(roster.map((student) => records[student.id]?.behavior ?? "").join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("클립보드 복사 권한을 확인해 주세요.");
    }
  };
  const saveRecord = async (studentId: number, record: { characteristic: string; behavior: string; confirmed: boolean }, confirmed = false) => {
    try {
      const response = await fetch("/api/student-behaviors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, characteristic: record.characteristic, behavior: record.behavior, confirmed }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "행동특성을 저장하지 못했습니다.");
      updateRecord(studentId, { confirmed });
    } catch {
      setError(confirmed ? "검수 항목을 모두 통과한 행동특성만 확정할 수 있습니다." : "수정한 행동특성 내용을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };
  const formattedLastGeneratedAt = lastGeneratedAt
    ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(lastGeneratedAt))
    : "";
  const loadHistory = async (studentId: number, studentName: string) => {
    try {
      const response = await fetch(`/api/revisions?type=behavior&studentId=${studentId}`);
      const result = await response.json() as { revisions?: RevisionItem[]; error?: string };
      if (!response.ok) throw new Error(result.error || "이전 기록을 불러오지 못했습니다.");
      setHistory({ studentId, studentName, revisions: result.revisions ?? [] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "이전 기록을 불러오지 못했습니다.");
    }
  };
  const restoreBehavior = async (revision: RevisionItem) => {
    if (!history) return;
    const restored = { characteristic: revision.characteristic, behavior: revision.content, confirmed: false };
    updateRecord(history.studentId, restored);
    await saveRecord(history.studentId, restored, false);
    setHistory(null);
  };

  return (
    <section>
      <div className="page-heading">
        <div><p className="eyebrow">GROWTH NOTE</p><h1>행동특성 작성</h1><p>학생별 특성을 입력하고 한 번에 행동특성을 생성하세요.</p></div>
        <div className="ai-generate-actions">{formattedLastGeneratedAt && <span>마지막 사용 {formattedLastGeneratedAt}</span>}<button onClick={() => void generateAll()} disabled={loading}>{loading ? "전체 생성 중…" : "✦ AI 행특 생성"}</button></div>
      </div>
      <div className="review-content behavior-table-content">
        <div className="behavior-table-toolbar"><span>특성 입력 {roster.filter((student) => records[student.id]?.characteristic.trim()).length} / {roster.length}명</span><div><button className="reference-open-button" onClick={() => setReferenceOpen((current) => !current)}>{referenceOpen ? "참고자료 닫기" : "참고자료 열기"}</button><button className="copy-comments" onClick={() => void copyBehaviors()} disabled={!roster.some((student) => records[student.id]?.behavior)}>{copied ? "복사됨 ✓" : "행동특성만 복사하기"}</button></div></div>
        {error && <p className="generation-error">! {error}</p>}
        {history && <RevisionPanel title={history.studentName} revisions={history.revisions} onRestore={(revision) => void restoreBehavior(revision)} onClose={() => setHistory(null)} />}
        {loading && <div className="comment-loading class-loading"><span>✦</span><p>입력된 모든 학생의 행동특성을 생성하고 있어요.</p></div>}
        <div className={`behavior-work-area ${referenceOpen ? "with-reference" : ""}`}>
          <div className="comments-table-wrap">
            <table className="comments-table behavior-table">
              <thead><tr><th>번호</th><th>이름</th><th>특성</th><th>행동특성</th><th>검수·확정</th></tr></thead>
              <tbody>{roster.map((student) => {
                const record = records[student.id] ?? { characteristic: "", behavior: "", confirmed: false };
                const validation = validateRecord(record.behavior, true);
                const similarStudents = roster.filter((other) => other.id !== student.id && recordSimilarity(record.behavior, records[other.id]?.behavior ?? "") >= 0.82);
                return <tr className={activeStudentId === student.id ? "active-reference-row" : ""} key={student.id}><td>{student.number ?? student.id}</td><td><strong>{student.name}</strong></td><td><textarea value={record.characteristic} onFocus={() => setActiveStudentId(student.id)} onChange={(event) => updateRecord(student.id, { characteristic: event.target.value, confirmed: false })} onBlur={() => void saveRecord(student.id, records[student.id] ?? record)} placeholder="관찰한 행동과 변화 모습을 입력하세요." /></td><td><textarea value={record.behavior} onChange={(event) => updateRecord(student.id, { behavior: event.target.value, confirmed: false })} onBlur={() => void saveRecord(student.id, records[student.id] ?? record)} placeholder={record.characteristic ? "AI 행특 생성 버튼을 누르면 결과가 표시됩니다." : "특성을 먼저 입력해 주세요."} /><small>{record.behavior ? `${validation.bytes} bytes` : ""}</small></td><td className="validation-cell behavior-validation"><div><span className={validation.lengthOk ? "pass" : "fail"}>500~550B</span><span className={validation.endingsOk ? "pass" : "fail"}>종결</span><span className={validation.growthIncluded ? "pass" : "fail"}>성장</span><span className={!validation.forbidden.length ? "pass" : "fail"}>금지어</span><span className={!validation.repeated.length ? "pass" : "fail"}>반복</span><span className={!similarStudents.length ? "pass" : "fail"} title={similarStudents.map((item) => item.name).join(", ")}>유사 {!similarStudents.length ? "없음" : `${similarStudents.length}명`}</span></div><button className="history-button" disabled={!record.behavior} onClick={() => void loadHistory(student.id, student.name)}>이전 기록</button><button className={record.confirmed ? "confirmed" : ""} disabled={!validation.valid || !!similarStudents.length} onMouseDown={(event) => event.preventDefault()} onClick={() => void saveRecord(student.id, record, !record.confirmed)}>{record.confirmed ? "확정됨 ✓" : "최종 확정"}</button></td></tr>;
              })}</tbody>
            </table>
          </div>
          {referenceOpen && <aside className="behavior-reference-drawer">
            <button className="drawer-close" onClick={() => setReferenceOpen(false)} aria-label="참고자료 닫기">×</button>
            <div className="reference-guide"><div><strong>작성 참고자료</strong><p>실제로 관찰한 행동과 변화에 맞는 표현만 선택해 주세요.</p></div><span>현재 입력 대상: {activeStudentId ? `${roster.find((student) => student.id === activeStudentId)?.number ?? roster.find((student) => student.id === activeStudentId)?.id}번 ${roster.find((student) => student.id === activeStudentId)?.name}` : "특성 입력칸을 선택하세요"}</span></div>
            <div className="reference-tabs">{behaviorReferences.map((group) => <button className={activeCategory === group.category ? "active" : ""} onClick={() => setActiveCategory(group.category)} key={group.category}>{group.category}</button>)}</div>
            {behaviorReferences.filter((group) => group.category === activeCategory).map((group) => <div className="reference-groups" key={group.category}>
              <section><h3>강점 키워드</h3><div>{group.strengths.map((phrase) => <button onClick={() => addReferencePhrase(phrase)} key={phrase}>{phrase}</button>)}</div></section>
              <section className="growth"><h3>성장 지원 표현</h3><div>{group.growth.map((phrase) => <button onClick={() => addReferencePhrase(phrase)} key={phrase}>{phrase}</button>)}</div></section>
            </div>)}
          </aside>}
        </div>
      </div>
    </section>
  );
}

type ExportComment = { studentId: number; subject: string; comment: string; confirmed: boolean; updatedAt: string };
type ExportBehavior = { studentId: number; characteristic: string; behavior: string; confirmed: boolean; updatedAt: string };

function ExportResults({ roster, plan, classroom }: { roster: AssessmentStudent[]; plan: AssessmentPlan[]; classroom: ClassroomInfo | null }) {
  const [comments, setComments] = useState<ExportComment[]>([]);
  const [behaviors, setBehaviors] = useState<ExportBehavior[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const subjects = [...new Set([...plan.map((item) => item.subject), ...comments.map((item) => item.subject)].filter(Boolean))];
  useEffect(() => {
    const load = async () => {
      try {
        const [commentResponse, behaviorResponse] = await Promise.all([fetch("/api/generated-comments"), fetch("/api/student-behaviors")]);
        const commentResult = await commentResponse.json() as { comments?: ExportComment[]; error?: string };
        const behaviorResult = await behaviorResponse.json() as { behaviors?: ExportBehavior[]; error?: string };
        if (!commentResponse.ok || !behaviorResponse.ok) throw new Error(commentResult.error || behaviorResult.error || "결과를 불러오지 못했습니다.");
        setComments(commentResult.comments ?? []);
        setBehaviors(behaviorResult.behaviors ?? []);
        const first = commentResult.comments?.[0]?.subject ?? plan[0]?.subject ?? "";
        setSelectedSubject(first);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "결과를 불러오지 못했습니다.");
      } finally { setLoading(false); }
    };
    void load();
  }, [plan]);
  const byteLength = (value: string) => new TextEncoder().encode(value).length;
  const commentMap = new Map(comments.map((item) => [`${item.studentId}|${item.subject}`, item]));
  const behaviorMap = new Map(behaviors.map((item) => [item.studentId, item]));
  const copyLines = async (lines: string[], label: string) => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setMessage(`${label}을 번호순으로 복사했습니다. 나이스 첫 번째 학생 칸에 붙여넣으세요.`);
    } catch {
      setMessage("클립보드 권한을 확인해 주세요.");
    }
  };
  const exportWorkbook = async () => {
    const XLSX = await import("xlsx");
    const ordered = [...roster].sort((a, b) => (a.number ?? a.id) - (b.number ?? b.id));
    const subjectRows = subjects.flatMap((subject) => ordered.map((student) => {
      const result = commentMap.get(`${student.id}|${subject}`);
      const value = result?.confirmed ? result.comment : "";
      return {
        번호: student.number ?? student.id, 이름: student.name, 과목: subject,
        "교과 평어": value, "바이트 수": byteLength(value),
        "작성 상태": result?.confirmed ? "확정" : result?.comment ? "미확정" : "미작성", "최종 수정일": result?.updatedAt ? new Date(result.updatedAt).toLocaleString("ko-KR") : "",
      };
    }));
    const behaviorRows = ordered.map((student) => {
      const result = behaviorMap.get(student.id);
      const value = result?.confirmed ? result.behavior : "";
      return {
        번호: student.number ?? student.id, 이름: student.name, 특성: result?.characteristic ?? "",
        "행동특성 및 발달상황": value, "바이트 수": byteLength(value),
        "검수 결과": result?.confirmed ? "검수 통과" : result?.behavior ? "미확정" : "미작성",
        "작성 상태": result?.confirmed ? "확정" : result?.behavior ? "미확정" : "미작성", "최종 수정일": result?.updatedAt ? new Date(result.updatedAt).toLocaleString("ko-KR") : "",
      };
    });
    const summaryRows = ordered.map((student) => ({
      번호: student.number ?? student.id,
      이름: student.name,
      "교과 평어 확정": `${subjects.filter((subject) => commentMap.get(`${student.id}|${subject}`)?.confirmed).length}/${subjects.length}`,
      "행동특성 확정": behaviorMap.get(student.id)?.confirmed ? "완료" : "미확정",
    }));
    const workbook = XLSX.utils.book_new();
    const addSheet = (name: string, rows: Record<string, unknown>[], widths: number[]) => {
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = widths.map((wch) => ({ wch }));
      sheet["!autofilter"] = rows.length ? { ref: sheet["!ref"] ?? "A1" } : undefined;
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    };
    addSheet("작성현황", summaryRows, [8, 12, 18, 18]);
    addSheet("교과평어", subjectRows, [8, 12, 12, 70, 12, 12, 22]);
    addSheet("행동특성", behaviorRows, [8, 12, 40, 80, 12, 16, 12, 22]);
    const classLabel = classroom ? `${classroom.schoolYear}_${classroom.grade}학년_${classroom.classNumber}반` : "학급";
    XLSX.writeFile(workbook, `기록샘_${classLabel}_최종결과.xlsx`);
    setMessage("전체 결과 Excel 파일을 내려받았습니다.");
  };
  const downloadCsv = (kind: "comments" | "behaviors") => {
    const ordered = [...roster].sort((a, b) => (a.number ?? a.id) - (b.number ?? b.id));
    const rows = kind === "comments"
      ? ordered.map((student) => { const item = commentMap.get(`${student.id}|${selectedSubject}`); return [student.number ?? student.id, student.name, selectedSubject, item?.confirmed ? item.comment : ""]; })
      : ordered.map((student) => { const item = behaviorMap.get(student.id); return [student.number ?? student.id, student.name, item?.confirmed ? item.behavior : ""]; });
    const header = kind === "comments" ? ["번호", "이름", "과목", "평어"] : ["번호", "이름", "행동특성"];
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
    const blob = new Blob([`\uFEFF${[header, ...rows].map((row) => row.map(escape).join(",")).join("\n")}`], { type: "text/csv;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = kind === "comments" ? `기록샘_${selectedSubject}_교과평어.csv` : "기록샘_행동특성.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    setMessage("CSV 파일을 내려받았습니다.");
  };
  const orderedRoster = [...roster].sort((a, b) => (a.number ?? a.id) - (b.number ?? b.id));
  const writtenComments = comments.filter((item) => item.confirmed).length;
  const writtenBehaviors = behaviors.filter((item) => item.confirmed).length;
  return <section>
    <div className="page-heading">
      <div><p className="eyebrow">NEIS READY</p><h1>결과 내보내기</h1><p>검수 후 최종 확정한 기록만 번호순으로 복사하거나 내려받습니다.</p></div>
      <button onClick={() => void exportWorkbook()} disabled={loading}>전체 Excel 내려받기</button>
    </div>
    <div className="export-stats">
      <article><span>교과 평어 확정</span><strong>{writtenComments}건</strong><small>전체 {roster.length * subjects.length}건</small></article>
      <article><span>행동특성 확정</span><strong>{writtenBehaviors}명</strong><small>전체 {roster.length}명</small></article>
      <article><span>내보내기 순서</span><strong>번호순</strong><small>나이스 붙여넣기 기준</small></article>
    </div>
    {message && <p className="student-message">{message}</p>}
    <div className="export-grid">
      <section className="export-card">
        <div className="section-heading"><div><p className="eyebrow">SUBJECT COMMENTS</p><h2>교과 평어</h2></div></div>
        <label className="export-select"><span>과목 선택</span><select value={selectedSubject} onChange={(event) => setSelectedSubject(event.target.value)}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
        <p>복사 버튼은 번호와 이름을 제외하고 평어만 한 줄에 한 명씩 복사합니다.</p>
        <div className="export-actions"><button onClick={() => void copyLines(orderedRoster.map((student) => { const item = commentMap.get(`${student.id}|${selectedSubject}`); return item?.confirmed ? item.comment : ""; }), `${selectedSubject} 확정 평어`)}>확정 평어만 복사</button><button className="secondary" onClick={() => downloadCsv("comments")}>CSV 내려받기</button></div>
      </section>
      <section className="export-card">
        <div className="section-heading"><div><p className="eyebrow">BEHAVIOR</p><h2>행동특성</h2></div></div>
        <p>학생 번호순으로 행동특성만 복사해 나이스 입력란에 바로 붙여넣을 수 있습니다.</p>
        <div className="export-actions"><button onClick={() => void copyLines(orderedRoster.map((student) => { const item = behaviorMap.get(student.id); return item?.confirmed ? item.behavior : ""; }), "확정 행동특성")}>확정 행동특성만 복사</button><button className="secondary" onClick={() => downloadCsv("behaviors")}>CSV 내려받기</button></div>
      </section>
    </div>
    <section className="export-preview">
      <div className="section-heading"><div><p className="eyebrow">PREVIEW</p><h2>{selectedSubject || "교과"} 평어 미리보기</h2></div></div>
      <div className="student-table-wrap"><table className="students-table"><thead><tr><th>번호</th><th>이름</th><th>평어</th><th>바이트</th></tr></thead><tbody>{orderedRoster.map((student) => {
        const item = commentMap.get(`${student.id}|${selectedSubject}`);
        const value = item?.confirmed ? item.comment : "";
        return <tr key={student.id}><td>{student.number ?? student.id}</td><td>{student.name}</td><td>{value || <span className="export-empty">{item?.comment ? "미확정" : "미작성"}</span>}</td><td>{byteLength(value)}</td></tr>;
      })}</tbody></table></div>
    </section>
  </section>;
}

type PrivacySummary = {
  account: { email: string; displayName: string };
  classroom: ClassroomInfo;
  counts: { students: number; plans: number; levels: number; comments: number; behaviors: number };
};

function PrivacySettings() {
  const [summary, setSummary] = useState<PrivacySummary | null>(null);
  const [classConfirmation, setClassConfirmation] = useState("");
  const [accountConfirmation, setAccountConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/privacy-data").then(async (response) => {
      const result = await response.json() as PrivacySummary & { error?: string };
      if (!response.ok) throw new Error(result.error || "저장 현황을 불러오지 못했습니다.");
      setSummary(result);
    }).catch((error: Error) => setMessage(error.message));
  }, []);
  const remove = async (scope: "class" | "account", confirmation: string) => {
    const label = scope === "class" ? "현재 학급의 모든 자료" : "계정과 모든 학급 자료";
    if (!window.confirm(`${label}를 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다. 계속할까요?`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/privacy-data", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, confirmation }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "삭제하지 못했습니다.");
      if (scope === "account") {
        window.location.href = "/login";
        return;
      }
      setMessage("현재 학급 자료를 삭제했습니다. 새로고침하면 빈 학급으로 시작합니다.");
      setSummary((current) => current ? { ...current, counts: { students: 0, plans: 0, levels: 0, comments: 0, behaviors: 0 } } : current);
      setClassConfirmation("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "삭제하지 못했습니다.");
    } finally { setBusy(false); }
  };
  const countItems = summary ? [
    ["학생", summary.counts.students], ["평가계획", summary.counts.plans], ["평가수준", summary.counts.levels],
    ["교과 평어", summary.counts.comments], ["행동특성", summary.counts.behaviors],
  ] : [];
  return <section>
    <div className="page-heading"><div><p className="eyebrow">PRIVACY & SECURITY</p><h1>개인정보·데이터 관리</h1><p>로그인한 교사와 현재 학급에 연결된 자료만 표시됩니다.</p></div></div>
    {message && <p className="student-message">{message}</p>}
    <section className="privacy-card">
      <div className="section-heading"><div><p className="eyebrow">DATA SCOPE</p><h2>현재 저장 범위</h2></div><span className="security-badge">교사·학급별 격리</span></div>
      {summary ? <>
        <dl className="privacy-meta"><div><dt>교사 계정</dt><dd>{summary.account.email}</dd></div><div><dt>학교·학급</dt><dd>{summary.classroom.schoolName} · {summary.classroom.schoolYear}학년도 {summary.classroom.semester}학기 · {summary.classroom.grade}학년 {summary.classroom.classNumber}반</dd></div></dl>
        <div className="privacy-counts">{countItems.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
      </> : <p>저장 현황을 확인하고 있습니다.</p>}
      <ul className="security-list"><li>로그인 세션은 보안 쿠키로 관리됩니다.</li><li>OpenAI API 키와 Supabase 관리 키는 서버에만 저장됩니다.</li><li>모든 조회·수정 요청에서 교사 ID와 학급 ID를 함께 확인합니다.</li></ul>
    </section>
    <div className="danger-grid">
      <section className="danger-card">
        <h2>현재 학급 자료 삭제</h2>
        <p>학생, 평가계획, 평가수준, 교과 평어와 행동특성을 모두 삭제합니다. 교사 계정은 유지됩니다.</p>
        <label><span>계속하려면 <b>학급자료삭제</b> 입력</span><input value={classConfirmation} onChange={(event) => setClassConfirmation(event.target.value)} /></label>
        <button disabled={busy || classConfirmation !== "학급자료삭제"} onClick={() => void remove("class", classConfirmation)}>현재 학급 자료 영구 삭제</button>
      </section>
      <section className="danger-card account">
        <h2>교사 계정 탈퇴</h2>
        <p>계정과 소유한 모든 학급 자료를 삭제하고 즉시 로그아웃합니다. 복구할 수 없습니다.</p>
        <label><span>계속하려면 <b>계정탈퇴</b> 입력</span><input value={accountConfirmation} onChange={(event) => setAccountConfirmation(event.target.value)} /></label>
        <button disabled={busy || accountConfirmation !== "계정탈퇴"} onClick={() => void remove("account", accountConfirmation)}>계정과 모든 자료 영구 삭제</button>
      </section>
    </div>
  </section>;
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [currentUser, setCurrentUser] = useState("선생님");
  const [classroom, setClassroom] = useState<ClassroomInfo | null>(null);
  const [roster, setRoster] = useState<AssessmentStudent[]>([]);
  const [assessmentDataBySubject, setAssessmentDataBySubject] = useState<Record<string, AssessmentStudent[]>>({});
  const [plan, setPlan] = useState<AssessmentPlan[]>([]);
  const [activeSubject, setActiveSubject] = useState("");
  const [generatedCommentCount, setGeneratedCommentCount] = useState(0);
  const [generatedBehaviorCount, setGeneratedBehaviorCount] = useState(0);
  const [aiUsage, setAiUsage] = useState({ monthly: 0, limit: 300 });
  useEffect(() => {
    const loadClassData = async () => {
      try {
        const [planResponse, classResponse, commentResponse, behaviorResponse] = await Promise.all([
          fetch("/api/assessment-plan"),
          fetch("/api/class-data"),
          fetch("/api/generated-comments"),
          fetch("/api/student-behaviors"),
        ]);
        const planResult = await planResponse.json() as { plan?: AssessmentPlan[] };
        const classResult = await classResponse.json() as {
          students?: Array<{ id: number; number: number; name: string }>;
          levels?: Array<{ studentId: number; subject: string; assessmentIndex: number; level: Level }>;
          user?: { displayName: string };
          classroom?: ClassroomInfo;
        };
        const commentResult = await commentResponse.json() as { comments?: Array<{ comment: string }> };
        const behaviorResult = await behaviorResponse.json() as { behaviors?: Array<{ behavior: string }> };
        if (!planResponse.ok || !classResponse.ok) return;
        const loadedPlan = planResult.plan ?? [];
        const loadedRoster: AssessmentStudent[] = classResponse.ok && classResult.students?.length
          ? classResult.students.map((student) => ({ id: student.id, number: student.number, name: student.name, assessments: [], status: "미생성", note: "" }))
          : [];
        const savedLevels = new Map((classResult.levels ?? []).map((item) => [`${item.studentId}|${item.subject}|${item.assessmentIndex}`, item.level]));
        setPlan(loadedPlan);
        setRoster(loadedRoster);
        setGeneratedCommentCount((commentResult.comments ?? []).filter((item) => item.comment.trim()).length);
        setGeneratedBehaviorCount((behaviorResult.behaviors ?? []).filter((item) => item.behavior.trim()).length);
        if (classResult.user?.displayName) setCurrentUser(classResult.user.displayName);
        if (classResult.classroom) setClassroom(classResult.classroom);
        const firstSubject = loadedPlan[0]?.subject ?? "";
        setActiveSubject(firstSubject);
        const subjects = [...new Set(loadedPlan.map((item) => item.subject))];
        setAssessmentDataBySubject(Object.fromEntries(subjects.map((subject) => {
          const subjectCount = loadedPlan.filter((item) => item.subject === subject).length;
          return [subject, loadedRoster.map((student) => ({
            ...student,
            assessments: Array.from({ length: subjectCount }, (_, assessmentIndex) =>
              savedLevels.get(`${student.id}|${subject}|${assessmentIndex}`) ?? "-"),
          }))];
        })));
      } catch {
        // 배포 초기화 중에는 내장 기본 평가계획을 유지함.
      }
    };
    void loadClassData();
  }, []);
  useEffect(() => {
    if (view !== "dashboard") return;
    const refreshGeneratedCounts = async () => {
      try {
        const [commentResponse, behaviorResponse] = await Promise.all([fetch("/api/generated-comments"), fetch("/api/student-behaviors")]);
        const commentResult = await commentResponse.json() as { comments?: Array<{ comment: string }> };
        const behaviorResult = await behaviorResponse.json() as { behaviors?: Array<{ behavior: string }> };
        if (commentResponse.ok) setGeneratedCommentCount((commentResult.comments ?? []).filter((item) => item.comment.trim()).length);
        if (behaviorResponse.ok) setGeneratedBehaviorCount((behaviorResult.behaviors ?? []).filter((item) => item.behavior.trim()).length);
      } catch {
        // 대시보드 집계 실패는 작성 기능을 막지 않음.
      }
    };
    void refreshGeneratedCounts();
  }, [view]);
  useEffect(() => {
    const loadUsage = async () => {
      try {
        const response = await fetch("/api/usage");
        const result = await response.json() as { monthly?: number; limit?: number };
        if (response.ok) setAiUsage({ monthly: Number(result.monthly ?? 0), limit: Number(result.limit ?? 300) });
      } catch {
        // 사용량 표시 실패는 AI 작성 기능을 막지 않음.
      }
    };
    void loadUsage();
    const timer = window.setInterval(() => void loadUsage(), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const addStudent = async () => {
    const name = window.prompt("추가할 학생 이름을 입력해 주세요.");
    if (!name?.trim()) return;
    const number = roster.length ? Math.max(...roster.map((student) => student.number ?? student.id)) + 1 : 1;
    const response = await fetch("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), number }),
    });
    const result = await response.json() as { student?: { id: number; number: number; name: string }; error?: string };
    if (!response.ok || !result.student) return window.alert(result.error || "학생을 추가하지 못했습니다.");
    const newStudent: AssessmentStudent = { id: result.student.id, number: result.student.number, name: result.student.name, assessments: [], status: "미생성", note: "" };
    setRoster((current) => [...current, newStudent]);
    setAssessmentDataBySubject((current) => Object.fromEntries(Object.entries(current).map(([subject, data]) => [
      subject,
      [...data, { ...newStudent, assessments: Array(plan.filter((item) => item.subject === subject).length).fill("-") as Level[] }],
    ])));
  };
  const deleteStudent = async (id: number) => {
    const student = roster.find((item) => item.id === id);
    if (!student || !window.confirm(`${student.name} 학생을 삭제할까요?`)) return;
    const response = await fetch(`/api/students?id=${id}`, { method: "DELETE" });
    if (!response.ok) return window.alert("학생을 삭제하지 못했습니다.");
    setRoster((current) => current.filter((item) => item.id !== id));
    setAssessmentDataBySubject((current) => Object.fromEntries(Object.entries(current).map(([subject, data]) => [subject, data.filter((item) => item.id !== id)])));
  };
  const mergeStudentIntoState = (student: { id: number; number: number; name: string }) => {
    setRoster((current) => {
      const existing = current.find((item) => item.id === student.id);
      const next: AssessmentStudent = existing
        ? { ...existing, number: student.number, name: student.name }
        : { ...student, assessments: [], status: "미생성", note: "" };
      return [...current.filter((item) => item.id !== student.id), next].sort((a, b) => (a.number ?? a.id) - (b.number ?? b.id));
    });
    setAssessmentDataBySubject((current) => Object.fromEntries(Object.entries(current).map(([subject, data]) => {
      const existing = data.find((item) => item.id === student.id);
      const next: AssessmentStudent = existing
        ? { ...existing, number: student.number, name: student.name }
        : { ...student, assessments: Array(plan.filter((item) => item.subject === subject).length).fill("-") as Level[], status: "미생성", note: "" };
      return [subject, [...data.filter((item) => item.id !== student.id), next].sort((a, b) => (a.number ?? a.id) - (b.number ?? b.id))];
    })));
  };
  const mergeImportedStudents = (imported: Array<{ id: number; number: number; name: string }>) => {
    imported.forEach(mergeStudentIntoState);
  };
  const saveAssessmentLevels = async () => {
    const levels = Object.entries(assessmentDataBySubject).flatMap(([subject, data]) => data.flatMap((student) =>
      student.assessments.map((level, assessmentIndex) => ({ studentId: student.id, subject, assessmentIndex, level })),
    ));
    const response = await fetch("/api/assessment-levels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ levels }),
    });
    if (!response.ok) {
      const result = await response.json() as { error?: string };
      window.alert(result.error || "평가수준을 저장하지 못했습니다.");
      throw new Error("Assessment level save failed");
    }
  };
  const applyPlanChange = (nextPlan: AssessmentPlan[]) => {
    setPlan(nextPlan);
    const subjects = [...new Set(nextPlan.map((item) => item.subject).filter(Boolean))];
    if (!subjects.includes(activeSubject)) setActiveSubject(subjects[0] ?? "");
    setAssessmentDataBySubject((current) => Object.fromEntries(subjects.map((subject) => {
      const count = nextPlan.filter((item) => item.subject === subject).length;
      const existing = current[subject] ?? [];
      return [subject, roster.map((student) => {
        const previous = existing.find((item) => item.id === student.id);
        return {
          ...student,
          assessments: Array.from({ length: count }, (_, index) => previous?.assessments[index] ?? "-") as Level[],
        };
      })];
    })));
  };
  const allAssessmentRows = Object.values(assessmentDataBySubject).flat();
  const totalLevels = allAssessmentRows.reduce((sum, student) => sum + student.assessments.length, 0);
  const completedLevels = allAssessmentRows.reduce((sum, student) => sum + student.assessments.filter((level) => level !== "-").length, 0);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("dashboard")}><span>기록</span>샘<i>교사의 기록을 더 가치 있게</i></button>
        <nav>{navItems.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
        <div className="nav-divider" />
        <nav><button className={view === "export" ? "active" : ""} onClick={() => setView("export")}><span>⇧</span>결과 내보내기</button><button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><span>⚙</span>개인정보·설정</button></nav>
        <div className="sidebar-bottom"><div className="storage"><span>이번 달 AI 생성</span><strong>{aiUsage.monthly} / {aiUsage.limit}</strong><div><i style={{ width: `${Math.min(100, aiUsage.limit ? (aiUsage.monthly / aiUsage.limit) * 100 : 0)}%` }} /></div></div><div className="profile"><span className="avatar">{currentUser.slice(0, 1)}</span><span><b>{currentUser}</b><small>{classroom?.schoolName ?? "학교 정보 확인 중"}</small></span><form action="/api/auth/logout" method="post"><button type="submit">로그아웃</button></form></div></div>
      </aside>
      <main>
        <header className="mobile-header"><button className="brand" onClick={() => setView("dashboard")}><span>기록</span>샘</button><select value={view} onChange={(e) => setView(e.target.value as View)}>{navItems.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}<option value="export">결과 내보내기</option><option value="settings">개인정보·설정</option></select></header>
        <div className="content">
          {view === "dashboard" && <Dashboard move={setView} teacherName={currentUser} classroom={classroom} studentCount={roster.length} completedLevels={completedLevels} totalLevels={totalLevels} commentCount={generatedCommentCount} expectedComments={roster.length * new Set(plan.map((item) => item.subject)).size} behaviorCount={generatedBehaviorCount} />}
          {view === "classes" && <ClassroomManager current={classroom} />}
          {view === "students" && <StudentManager roster={roster} onAdded={mergeStudentIntoState} onChanged={mergeStudentIntoState} onDeleted={(id) => void deleteStudent(id)} onImported={mergeImportedStudents} />}
          {view === "plans" && <PlanManager plan={plan} onChanged={applyPlanChange} />}
          {view === "assessments" && <Assessments data={assessmentDataBySubject[activeSubject] ?? []} setData={(updater) => setAssessmentDataBySubject((current) => ({ ...current, [activeSubject]: typeof updater === "function" ? updater(current[activeSubject] ?? []) : updater }))} plan={plan} activeSubject={activeSubject} setActiveSubject={setActiveSubject} onAddStudent={() => void addStudent()} onDeleteStudent={(id) => void deleteStudent(id)} onSave={saveAssessmentLevels} />}
          {view === "comments" && <Comments assessmentDataBySubject={assessmentDataBySubject} plan={plan} roster={roster} />}
          {view === "behavior" && <Behavior roster={roster} />}
          {view === "export" && <ExportResults roster={roster} plan={plan} classroom={classroom} />}
          {view === "settings" && <PrivacySettings />}
        </div>
      </main>
    </div>
  );
}
