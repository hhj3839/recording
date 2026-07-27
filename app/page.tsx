"use client";

import { useCallback, useEffect, useState } from "react";
import { countBehaviorCharacteristics, recordSimilarityDetails, validateBehaviorSource, validateRecord } from "./record-validation";
import { parseStudentRosterText } from "./student-roster-parser";
import { parseAssessmentPlanText } from "./assessment-plan-parser";
import { assessmentPlanWarnings, validateAssessmentPlanRow } from "./assessment-plan-policy";
import { commentAreaIssuesForDisplay } from "./comment-generation-policy";

type View = "dashboard" | "classes" | "students" | "plans" | "assessments" | "comments" | "behavior" | "export" | "settings";
const SHOW_EXPORT_RESULTS = false;
type Level = "상" | "중" | "하" | "미응시" | "평가 예정" | "-";
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

const assessmentPlanGptPrompt = `다음 과정중심평가 계획을 기록샘 평가계획 붙여넣기 형식으로 변환해 줘.

[출력 규칙]
1. 열 순서는 과목 / 단원 / 평가목표 / 영역 / 평가유형 / 평가관점 / 상 / 중 / 하 / 평가상의 유의점이다.
2. 각 열은 탭(Tab)으로 구분하고 평가 항목 한 개당 한 줄로 출력한다.
3. 첫 줄에 열 제목을 포함한다.
4. 마크다운 표, 코드 블록, 번호, 설명, 따옴표를 쓰지 않는다.
5. 원문에 없는 내용을 만들지 않고 확인할 수 없는 항목은 빈칸으로 둔다.
6. 셀 내부에서 줄바꿈하지 않고 여러 내용은 “ / ”로 구분한다.
7. 상·중·하 평가기준을 구분해 넣고 모든 행이 정확히 10개 열인지 확인한다.

[변환할 과정중심평가 계획]
여기에 평가계획 원문을 붙여넣으세요.`;

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
  const load = useCallback(async () => {
    const response = await fetch("/api/classrooms");
    const result = await response.json() as { classrooms?: ManagedClassroom[]; error?: string };
    if (!response.ok) return setMessage(result.error || "학급 목록을 불러오지 못했습니다.");
    setClassrooms(result.classrooms ?? []);
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useEffect(() => {
    if (!current) return;
    queueMicrotask(() => setForm({
        schoolName: current.schoolName,
        schoolYear: current.schoolYear,
        semester: current.semester,
        grade: current.grade,
        classNumber: current.classNumber,
      }));
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
  const [rosterText, setRosterText] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, { number: number; name: string }>>({});
  const [inactiveStudents, setInactiveStudents] = useState<Array<{ id: number; number: number; name: string }>>([]);
  const [studentTab, setStudentTab] = useState<"active" | "inactive">("active");
  const [orderedIds, setOrderedIds] = useState<number[]>([]);
  const [orderDirty, setOrderDirty] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setDrafts(Object.fromEntries(roster.map((student) => [student.id, {
        number: student.number ?? student.id,
        name: student.name,
      }])));
      setOrderedIds(roster.map((student) => student.id));
      setOrderDirty(false);
    });
    fetch("/api/students/status").then(async (response) => {
      const result = await response.json() as { students?: Array<{ id: number; number: number; name: string }> };
      if (response.ok) setInactiveStudents(result.students ?? []);
    }).catch(() => undefined);
  }, [roster]);

  async function addStudentsFromText(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const parsedRoster = parseStudentRosterText(rosterText);
    if (parsedRoster.error) return setMessage(parsedRoster.error);
    const parsed = parsedRoster.students;
    setBusy(true);
    try {
      const response = await fetch("/api/students", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ students: parsed }),
      });
      const result = await response.json() as { students?: Array<{ id: number; number: number; name: string }>; error?: string };
      if (!response.ok || !result.students) throw new Error(result.error ?? "학생 명단을 저장하지 못했습니다.");
      const merged = new Map<number, { id: number; number: number; name: string }>(
        roster.map((student) => [student.number ?? student.id, {
          id: student.id,
          number: student.number ?? student.id,
          name: student.name,
        }]),
      );
      result.students.forEach((student) => merged.set(student.number, student));
      onImported([...merged.values()].sort((a, b) => (a.number ?? a.id) - (b.number ?? b.id)));
      setRosterText("");
      setMessage(`${result.students.length}명의 번호와 이름을 인식해 명단에 추가했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학생 명단을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
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

  async function restoreStudent(student: { id: number; number: number; name: string }) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/students/status", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: student.id }),
      });
      const result = await response.json() as { student?: { id: number; number: number; name: string }; error?: string };
      if (!response.ok || !result.student) throw new Error(result.error || "학생을 복귀시키지 못했습니다.");
      setInactiveStudents((current) => current.filter((item) => item.id !== student.id));
      onAdded(result.student);
      setMessage(`${student.name} 학생을 재학생으로 복귀시켰습니다. 기존 평가 기록도 유지됩니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학생을 복귀시키지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function purgeStudent(student: { id: number; number: number; name: string }) {
    if (!window.confirm(`${student.name} 학생과 연결된 평가·평어·행동특성 기록을 모두 영구 삭제할까요?\n\n이 작업은 복구할 수 없습니다.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/students/status", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: student.id, confirmation: "학생영구삭제" }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "학생을 영구 삭제하지 못했습니다.");
      setInactiveStudents((current) => current.filter((item) => item.id !== student.id));
      setMessage(`${student.name} 학생과 연결 기록을 영구 삭제했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학생을 영구 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  const orderedRoster = orderedIds.map((id) => roster.find((student) => student.id === id)).filter((student): student is AssessmentStudent => Boolean(student));
  function moveStudent(id: number, direction: -1 | 1) {
    setOrderedIds((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    setOrderDirty(true);
  }
  async function saveStudentOrder() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/students/reorder", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentIds: orderedIds }),
      });
      const result = await response.json() as { students?: Array<{ id: number; number: number; name: string }>; error?: string };
      if (!response.ok || !result.students) throw new Error(result.error || "학생 순서를 저장하지 못했습니다.");
      onImported(result.students);
      setOrderedIds(result.students.map((student) => student.id));
      setOrderDirty(false);
      setMessage("학생 순서를 저장하고 1번부터 자동으로 다시 번호를 매겼습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학생 순서를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return <section>
    <div className="page-heading"><div><p className="eyebrow">CLASS ROSTER</p><h1>학생 관리</h1><p>번호와 이름 두 열을 붙여넣으면 명단을 인식해 현재 학급에 등록합니다.</p></div></div>
    <section className="roster-paste-entry">
      <form onSubmit={addStudentsFromText}>
        <div className="section-heading"><div><p className="eyebrow">PASTE ROSTER</p><h2>학생 명단 붙여넣기</h2><p>엑셀이나 한글 표에서 번호와 이름 두 열을 복사해 그대로 붙여넣으세요.</p></div><button type="submit" disabled={busy || !rosterText.trim()}>{busy ? "추가 중…" : "명단 인식·추가"}</button></div>
        <div className="roster-paste-columns">번호 → 이름</div>
        <textarea aria-label="번호와 이름 명단" value={rosterText} onChange={(event) => setRosterText(event.target.value)} placeholder={"1\t김○○\n2\t이○○\n3\t박○○\n4\t최○○"} required />
      </form>
    </section>
    {message && <p className="student-message" role="status">{message}</p>}
    <div className="student-status-tabs">
      <div><button className={studentTab === "active" ? "active" : ""} onClick={() => setStudentTab("active")}>재학생 {roster.length}</button>
      <button className={studentTab === "inactive" ? "active" : ""} onClick={() => setStudentTab("inactive")}>전출·비활성 {inactiveStudents.length}</button></div>
      {studentTab === "active" && <button className="save-order" disabled={busy || !orderDirty} onClick={() => void saveStudentOrder()}>{orderDirty ? "변경 순서 저장" : "순서 저장됨"}</button>}
    </div>
    {studentTab === "active" ? (
    <div className="table-wrap student-table-wrap"><table className="students-table">
      <thead><tr><th>번호</th><th>이름</th><th>관리</th></tr></thead>
      <tbody>{orderedRoster.length ? orderedRoster.map((student, index) => {
        const draft = drafts[student.id] ?? { number: student.number ?? student.id, name: student.name };
        return <tr key={student.id}>
          <td><input aria-label={`${student.name} 번호`} type="number" min="1" value={draft.number} onChange={(event) => setDrafts((current) => ({ ...current, [student.id]: { ...draft, number: Number(event.target.value) } }))} /></td>
          <td><input aria-label={`${student.name} 이름`} value={draft.name} onChange={(event) => setDrafts((current) => ({ ...current, [student.id]: { ...draft, name: event.target.value } }))} /></td>
          <td><div className="student-row-actions"><span className="order-buttons"><button disabled={busy || index === 0} title="한 칸 위로" onClick={() => moveStudent(student.id, -1)}>↑</button><button disabled={busy || index === orderedRoster.length - 1} title="한 칸 아래로" onClick={() => moveStudent(student.id, 1)}>↓</button></span><button onClick={() => void saveStudent(student.id)}>저장</button><button className="danger-text" onClick={() => onDeleted(student.id)}>비활성화</button></div></td>
        </tr>;
      }) : <tr><td colSpan={3} className="empty-cell">등록된 학생이 없습니다. 번호·이름 명단을 붙여넣어 주세요.</td></tr>}</tbody>
    </table></div>
    ) : (
      <div className="table-wrap student-table-wrap"><table className="students-table inactive-students-table">
        <thead><tr><th>번호</th><th>이름</th><th>관리</th></tr></thead>
        <tbody>{inactiveStudents.length ? inactiveStudents.map((student) => <tr key={student.id}>
          <td>{student.number}</td><td><strong>{student.name}</strong><small>평가·평어 기록 보관 중</small></td>
          <td><button disabled={busy} onClick={() => void restoreStudent(student)}>재학생 복귀</button><button disabled={busy} className="danger-text" onClick={() => void purgeStudent(student)}>영구 삭제</button></td>
        </tr>) : <tr><td colSpan={3} className="empty-cell">전출·비활성 학생이 없습니다.</td></tr>}</tbody>
      </table></div>
    )}
  </section>;
}

function PlanManager({ plan, onChanged, current }: { plan: AssessmentPlan[]; onChanged: (plan: AssessmentPlan[]) => void; current: ClassroomInfo | null }) {
  const [planText, setPlanText] = useState("");
  const [preview, setPreview] = useState<AssessmentPlan[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [promptCopied, setPromptCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<Array<{ id: number; source: string; label: string; itemCount: number; createdAt: string }>>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [sharedPlans, setSharedPlans] = useState<Array<{ id: number; name: string; schoolYear: number; semester: number; grade: number; subjects: string[]; itemCount: number; createdByEmail: string; updatedAt: string; canDelete: boolean }>>([]);
  const [sharedOpen, setSharedOpen] = useState(false);
  const [sharedSearch, setSharedSearch] = useState("");
  const [sharedYear, setSharedYear] = useState("all");
  const [sharedSemester, setSharedSemester] = useState("all");
  const [sharedGrade, setSharedGrade] = useState("all");
  const [sharedSubject, setSharedSubject] = useState("all");
  const [sharedPreview, setSharedPreview] = useState<{ name: string; items: AssessmentPlan[] } | null>(null);
  const columns: Array<[keyof AssessmentPlan, string]> = [
    ["subject", "과목"], ["unit", "단원"], ["goal", "평가목표"], ["domain", "영역"],
    ["type", "평가 유형"], ["perspective", "평가 관점"], ["high", "상"], ["middle", "중"],
    ["low", "하"], ["caution", "평가상의 유의점"],
  ];
  const validatePlans = (rows: AssessmentPlan[]) => {
    const found: string[] = [];
    const keys = new Set<string>();
    rows.forEach((row, index) => {
      const issue = validateAssessmentPlanRow(row);
      if (issue) found.push(`${index + 2}행: ${issue}`);
      const key = `${row.subject.trim()}|${row.unit.trim()}|${row.goal.trim()}`;
      if (keys.has(key)) found.push(`${index + 2}행: 과목·단원·평가목표가 중복됩니다.`);
      keys.add(key);
    });
    return found;
  };
  const validateWarnings = (rows: AssessmentPlan[]) => {
    const found: string[] = [];
    const savedKeys = new Set(plan.map((row) => `${row.subject.trim()}|${row.unit.trim()}|${row.goal.trim()}`));
    rows.forEach((row, index) => {
      found.push(...assessmentPlanWarnings(row).map((warning) => `${index + 2}행: ${warning}`));
      if (savedKeys.has(`${row.subject.trim()}|${row.unit.trim()}|${row.goal.trim()}`)) found.push(`${index + 2}행: 이미 저장된 평가계획과 같아 기존 내용을 갱신합니다.`);
    });
    return found;
  };
  const saveMany = async (rows: AssessmentPlan[]) => {
    const validation = validatePlans(rows);
    if (validation.length) return setErrors(validation);
    setBusy(true);
    setErrors([]);
    setWarnings([]);
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
      setPlanText("");
      setMessage(`${result.plan.length}개 평가계획을 저장했습니다.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "평가계획을 저장하지 못했습니다."]);
    } finally {
      setBusy(false);
    }
  };
  const interpretPlanText = () => {
    setErrors([]);
    setWarnings([]);
    setMessage("");
    const parsed = parseAssessmentPlanText(planText);
    if (parsed.error) {
      setPreview([]);
      setErrors([parsed.error]);
      return;
    }
    const rows = parsed.plans.map((item, index) => ({ ...item, sortOrder: plan.length + index }));
    const validation = validatePlans(rows);
    const reviewWarnings = validateWarnings(rows);
    setPreview(rows);
    setErrors(validation);
    setWarnings(reviewWarnings);
    setMessage(validation.length
      ? "해석한 표에 저장할 수 없는 항목이 있습니다."
      : `${rows.length}개 평가계획을 이해했습니다. 미리보기를 확인한 뒤 저장하세요.`);
  };
  const updateItem = async (item: AssessmentPlan) => {
    setBusy(true);
    try {
      const requestUpdate = (confirmAffected = false) => fetch("/api/assessment-plan", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...item, confirmAffected }),
      });
      let response = await requestUpdate();
      let result = await response.json() as { item?: AssessmentPlan; error?: string; requiresConfirmation?: boolean };
      if (response.status === 409 && result.requiresConfirmation) {
        const confirmed = window.confirm(`${result.error}\n\n그래도 수정하시겠습니까? 기존 평가수준은 유지됩니다.`);
        if (!confirmed) {
          setMessage("평가계획 수정을 취소했습니다.");
          return;
        }
        response = await requestUpdate(true);
        result = await response.json() as typeof result;
      }
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
  const clearCurrentPlan = async () => {
    if (!plan.length) return;
    const confirmation = window.prompt(
      `현재 학급의 평가계획 ${plan.length}개와 연결된 평가수준·교과 평어를 삭제합니다.\n공동 평가계획과 버전 기록은 삭제되지 않습니다.\n\n계속하려면 평가계획삭제를 입력하세요.`,
    );
    if (confirmation !== "평가계획삭제") return;
    setBusy(true);
    setErrors([]);
    try {
      const response = await fetch("/api/assessment-plan", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all", confirmation }),
      });
      const result = await response.json() as { deleted?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "평가계획을 전체 삭제하지 못했습니다.");
      onChanged([]);
      setPreview([]);
      setMessage(`현재 학급의 평가계획 ${result.deleted ?? plan.length}개를 삭제했습니다. 공동 평가계획은 유지됩니다.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "평가계획을 전체 삭제하지 못했습니다."]);
    } finally {
      setBusy(false);
    }
  };
  const loadVersions = async () => {
    setErrors([]);
    try {
      const response = await fetch("/api/assessment-plan/versions");
      const result = await response.json() as { versions?: Array<{ id: number; source: string; label: string; itemCount: number; createdAt: string }>; error?: string };
      if (!response.ok) throw new Error(result.error || "평가계획 버전 기록을 불러오지 못했습니다.");
      setVersions(result.versions ?? []);
      setVersionsOpen(true);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "평가계획 버전 기록을 불러오지 못했습니다."]);
    }
  };
  const restoreVersion = async (version: { id: number; label: string; itemCount: number }) => {
    if (!window.confirm(`‘${version.label}’ 버전의 평가계획 ${version.itemCount}개로 복원할까요?\n\n현재 계획은 복원 직전 상태로 다시 버전 보관됩니다.`)) return;
    setBusy(true);
    setErrors([]);
    try {
      const response = await fetch("/api/assessment-plan/versions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId: version.id }),
      });
      const result = await response.json() as { restored?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "평가계획 버전을 복원하지 못했습니다.");
      const planResponse = await fetch("/api/assessment-plan");
      const planResult = await planResponse.json() as { plan?: AssessmentPlan[] };
      if (!planResponse.ok || !planResult.plan) throw new Error("복원된 평가계획을 다시 불러오지 못했습니다.");
      onChanged(planResult.plan);
      setMessage(`평가계획 ${result.restored ?? version.itemCount}개를 이전 버전으로 복원했습니다.`);
      await loadVersions();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "평가계획 버전을 복원하지 못했습니다."]);
    } finally {
      setBusy(false);
    }
  };
  const loadSharedPlans = async () => {
    setErrors([]);
    try {
      const response = await fetch("/api/shared-assessment-plans");
      const result = await response.json() as { plans?: typeof sharedPlans; error?: string };
      if (!response.ok) throw new Error(result.error || "공동 평가계획을 불러오지 못했습니다.");
      setSharedPlans(result.plans ?? []);
      setSharedOpen(true);
    } catch (error) { setErrors([error instanceof Error ? error.message : "공동 평가계획을 불러오지 못했습니다."]); }
  };
  const publishSharedPlan = async () => {
    const name = window.prompt("다른 교사가 알아볼 공동 평가계획 이름을 입력해 주세요.", `${current?.schoolYear ?? ""}학년도 ${current?.grade ?? ""}학년 ${current?.semester ?? ""}학기`);
    if (!name?.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/shared-assessment-plans", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "평가계획을 공유하지 못했습니다.");
      setMessage("현재 평가계획을 모든 교사가 볼 수 있는 공동 계획에 공유했습니다.");
      await loadSharedPlans();
    } catch (error) { setErrors([error instanceof Error ? error.message : "평가계획을 공유하지 못했습니다."]); }
    finally { setBusy(false); }
  };
  const importSharedPlan = async (shared: (typeof sharedPlans)[number]) => {
    if (!window.confirm(`‘${shared.name}’ ${shared.itemCount}개 항목으로 현재 평가계획을 교체할까요?\n기존 계획은 버전 기록에 보관됩니다.`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/shared-assessment-plans", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: shared.id }),
      });
      const result = await response.json() as { imported?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "공동 평가계획을 가져오지 못했습니다.");
      const planResponse = await fetch("/api/assessment-plan");
      const planResult = await planResponse.json() as { plan?: AssessmentPlan[] };
      if (planResponse.ok && planResult.plan) onChanged(planResult.plan);
      setMessage(`공동 평가계획 ${result.imported ?? shared.itemCount}개를 현재 학급에 적용했습니다.`);
      setSharedOpen(false);
    } catch (error) { setErrors([error instanceof Error ? error.message : "공동 평가계획을 가져오지 못했습니다."]); }
    finally { setBusy(false); }
  };
  const previewSharedPlan = async (shared: (typeof sharedPlans)[number]) => {
    setBusy(true);
    setErrors([]);
    try {
      const response = await fetch(`/api/shared-assessment-plans?id=${shared.id}`);
      const result = await response.json() as { plan?: { name: string; items: AssessmentPlan[] }; error?: string };
      if (!response.ok || !result.plan) throw new Error(result.error || "공동 평가계획 미리보기를 불러오지 못했습니다.");
      setSharedPreview({ name: result.plan.name, items: result.plan.items });
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "공동 평가계획 미리보기를 불러오지 못했습니다."]);
    } finally { setBusy(false); }
  };
  const deleteSharedPlan = async (shared: (typeof sharedPlans)[number]) => {
    if (!window.confirm(`공동 평가계획 ‘${shared.name}’을 삭제할까요?`)) return;
    const response = await fetch("/api/shared-assessment-plans", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: shared.id }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) return setErrors([result.error || "공동 평가계획을 삭제하지 못했습니다."]);
    await loadSharedPlans();
  };
  const changePlan = (id: number | undefined, key: keyof AssessmentPlan, value: string) => {
    onChanged(plan.map((item) => item.id === id ? { ...item, [key]: value } : item));
  };
  const sharedYears = [...new Set(sharedPlans.map((item) => item.schoolYear))].sort((a, b) => b - a);
  const sharedSubjects = [...new Set(sharedPlans.flatMap((item) => item.subjects))].sort((a, b) => a.localeCompare(b, "ko"));
  const filteredSharedPlans = sharedPlans.filter((item) => {
    const search = sharedSearch.trim().toLowerCase();
    return (!search || `${item.name} ${item.subjects.join(" ")}`.toLowerCase().includes(search))
      && (sharedYear === "all" || item.schoolYear === Number(sharedYear))
      && (sharedSemester === "all" || item.semester === Number(sharedSemester))
      && (sharedGrade === "all" || item.grade === Number(sharedGrade))
      && (sharedSubject === "all" || item.subjects.includes(sharedSubject));
  });
  return <section>
    <div className="page-heading">
      <div><p className="eyebrow">학급별 평가 기준</p><h1>평가계획 관리</h1><p>10개 열로 정리한 평가계획을 붙여넣으면 자동으로 인식하고 검증합니다.</p></div>
      <div className="heading-actions"><button className="secondary" onClick={() => void loadSharedPlans()}>공동 평가계획</button><button className="secondary" onClick={() => void loadVersions()}>버전 기록</button></div>
    </div>
    {versionsOpen && <section className="plan-version-panel">
      <div className="section-heading"><div><p className="eyebrow">VERSION HISTORY</p><h2>평가계획 버전 기록</h2></div><button className="secondary" onClick={() => setVersionsOpen(false)}>닫기</button></div>
      <p>평가수준이 입력된 학급은 평가 항목 구조 보호를 위해 이전 버전을 조회만 할 수 있습니다.</p>
      <div>{versions.length ? versions.map((version) => <article key={version.id}>
        <span><b>{version.label}</b><small>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(version.createdAt))} · {version.itemCount}개</small></span>
        <button disabled={busy} onClick={() => void restoreVersion(version)}>이 버전 복원</button>
      </article>) : <p className="empty-cell">저장된 평가계획 버전이 없습니다.</p>}</div>
    </section>}
    {sharedOpen && <section className="shared-plan-panel">
      <div className="section-heading"><div><p className="eyebrow">SHARED PLAN LIBRARY</p><h2>공동 평가계획</h2></div><div><button disabled={busy || !plan.length} onClick={() => void publishSharedPlan()}>현재 계획 공유</button><button className="secondary" onClick={() => setSharedOpen(false)}>닫기</button></div></div>
      <p>기록샘을 사용하는 모든 교사가 공유한 계획을 현재 학급에 가져올 수 있습니다. 평가수준이 입력된 학급은 계획을 교체할 수 없습니다.</p>
      <div className="shared-plan-filters"><input aria-label="공동 평가계획 검색" value={sharedSearch} onChange={(event) => setSharedSearch(event.target.value)} placeholder="계획 이름·과목 검색" /><select aria-label="학년도" value={sharedYear} onChange={(event) => setSharedYear(event.target.value)}><option value="all">전체 학년도</option>{sharedYears.map((year) => <option value={year} key={year}>{year}학년도</option>)}</select><select aria-label="학기" value={sharedSemester} onChange={(event) => setSharedSemester(event.target.value)}><option value="all">전체 학기</option><option value="1">1학기</option><option value="2">2학기</option></select><select aria-label="학년" value={sharedGrade} onChange={(event) => setSharedGrade(event.target.value)}><option value="all">전체 학년</option>{[1, 2, 3, 4, 5, 6].map((grade) => <option value={grade} key={grade}>{grade}학년</option>)}</select><select aria-label="과목" value={sharedSubject} onChange={(event) => setSharedSubject(event.target.value)}><option value="all">전체 과목</option>{sharedSubjects.map((subject) => <option value={subject} key={subject}>{subject}</option>)}</select></div>
      {sharedPreview && <section className="shared-plan-preview"><div className="section-heading"><div><p className="eyebrow">PREVIEW</p><h3>{sharedPreview.name} · {sharedPreview.items.length}개</h3></div><button className="secondary" onClick={() => setSharedPreview(null)}>미리보기 닫기</button></div><div>{sharedPreview.items.map((item, index) => <details key={`${item.subject}-${item.unit}-${index}`}><summary>{index + 1}. {item.subject} · {item.unit} <span>{item.domain}</span></summary><p><b>평가목표</b>{item.goal}</p><p><b>평가관점</b>{item.perspective || "미입력"}</p><dl><div><dt>상</dt><dd>{item.high}</dd></div><div><dt>중</dt><dd>{item.middle}</dd></div><div><dt>하</dt><dd>{item.low}</dd></div></dl>{item.caution && <p><b>유의점</b>{item.caution}</p>}</details>)}</div></section>}
      <div className="shared-plan-list">{filteredSharedPlans.length ? filteredSharedPlans.map((shared) => <article key={shared.id}><div><strong>{shared.name}</strong><span>{shared.schoolYear}학년도 {shared.semester}학기 · {shared.grade}학년 · {shared.itemCount}개</span><small>{shared.subjects.join(" · ") || "과목 정보 없음"} · {new Date(shared.updatedAt).toLocaleString("ko-KR")}</small></div><button className="secondary" disabled={busy} onClick={() => void previewSharedPlan(shared)}>미리보기</button><button disabled={busy} onClick={() => void importSharedPlan(shared)}>현재 학급에 적용</button>{shared.canDelete && <button className="danger-text" disabled={busy} onClick={() => void deleteSharedPlan(shared)}>삭제</button>}</article>) : <p className="empty-cell">{sharedPlans.length ? "검색 조건에 맞는 공동 평가계획이 없습니다." : "아직 공유된 평가계획이 없습니다."}</p>}</div>
    </section>}
    <section className="plan-paste-entry">
      <div className="section-heading"><div><p className="eyebrow">PASTE TABLE</p><h2>평가계획 표 붙여넣기</h2><p>엑셀이나 한글 표에서 10개 열을 복사하거나 AI로 변환한 결과를 붙여넣으세요.</p></div></div>
      <div className="plan-paste-columns">과목 → 단원 → 평가목표 → 영역 → 평가유형 → 평가관점 → 상 → 중 → 하 → 유의점</div>
      <section className="plan-gpt-guide" aria-labelledby="plan-ai-guide-title">
        <div className="plan-gpt-guide-heading"><div><p className="eyebrow">AI FORMAT HELPER</p><h3 id="plan-ai-guide-title">AI로 평가계획 표 변환하기</h3></div><button type="button" onClick={() => {
          void navigator.clipboard.writeText(assessmentPlanGptPrompt)
            .then(() => {
              setPromptCopied(true);
              setMessage("변환 프롬프트를 복사했습니다. ChatGPT에 원본 평가계획과 함께 붙여넣으세요.");
              window.setTimeout(() => setPromptCopied(false), 2200);
            })
            .catch(() => setErrors(["프롬프트를 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요."]));
        }}>{promptCopied ? "복사됨 ✓" : "① 변환 프롬프트 복사"}</button></div>
        <ol className="plan-gpt-steps">
          <li><b>프롬프트 복사</b><span>위 버튼으로 기록샘의 10열 변환 규칙을 복사합니다.</span></li>
          <li><b>ChatGPT에서 변환</b><span>복사한 프롬프트 뒤에 원본 과정중심평가 계획을 붙여넣고 실행합니다.</span></li>
          <li><b>결과 붙여넣기</b><span>마크다운 표가 아닌 탭으로 구분된 결과만 아래에 붙여넣습니다.</span></li>
        </ol>
        <details><summary>프롬프트 내용 보기</summary><pre>{assessmentPlanGptPrompt}</pre></details>
      </section>
      <label className="plan-paste-label" htmlFor="assessment-plan-paste">③ 변환된 10열 표 붙여넣기</label>
      <textarea id="assessment-plan-paste" value={planText} onChange={(event) => setPlanText(event.target.value)} placeholder={"국어\t1. 생생하게 표현해요\t상황에 알맞게 표현할 수 있다.\t듣기·말하기\t구술 평가\t상황에 맞게 표현하는가?\t정확하고 실감 나게 표현할 수 있다.\t알맞게 표현할 수 있다.\t도움을 받아 표현하기 위해 노력한다.\t다양한 표현을 고려한다."} />
      <div className="plan-paste-actions"><button disabled={busy || !planText.trim()} onClick={interpretPlanText}>표 분석·미리보기</button></div>
    </section>
    {message && <p className="student-message">{message}</p>}
    {!!errors.length && <div className="plan-errors"><strong>확인이 필요합니다.</strong>{errors.slice(0, 8).map((error) => <p key={error}>• {error}</p>)}</div>}
    {!!warnings.length && <div className="plan-warnings"><strong>저장할 수 있지만 확인이 필요합니다.</strong>{warnings.slice(0, 8).map((warning) => <p key={warning}>• {warning}</p>)}</div>}
    {!!preview.length && <section className="plan-preview">
      <div className="section-heading"><div><p className="eyebrow">PREVIEW</p><h2>저장 전 미리보기 · {preview.length}개</h2></div><button disabled={busy || !!errors.length} onClick={() => void saveMany(preview)}>{busy ? "저장 중…" : "검증된 계획 저장"}</button></div>
      <div className="plan-preview-list">{preview.slice(0, 8).map((item, index) => <article key={`${item.subject}-${item.unit}-${index}`}><b>{item.subject} · {item.unit}</b><span>{item.goal}</span><small>{item.domain} / {item.type || "유형 미입력"}</small></article>)}</div>
    </section>}
    <section className="plan-list">
      <div className="section-heading"><div><p className="eyebrow">SAVED</p><h2>저장된 평가계획 · {plan.length}개</h2></div><button className="danger-text" disabled={busy || !plan.length} onClick={() => void clearCurrentPlan()}>현재 평가계획 초기화</button></div>
      {plan.map((item, index) => <article className="plan-card" key={item.id ?? `${item.subject}-${index}`}>
        <div className="plan-card-summary">
          <div className="plan-card-title"><strong>{index + 1}. {item.subject} · {item.unit}</strong><span>{item.domain}</span><span>{item.type || "유형 미입력"}</span></div>
          <p><b>평가목표</b>{item.goal}<i>·</i><b>평가관점</b>{item.perspective}</p>
        </div>
        <details className="plan-card-details">
          <summary>상·중·하·유의점 및 전체 내용 보기</summary>
          <div className="plan-card-fields">{columns.slice(2).map(([key, label]) => <label key={key}><span>{label}</span><input value={String(item[key] ?? "")} onChange={(event) => changePlan(item.id, key, event.target.value)} /></label>)}</div>
          <div className="plan-card-actions"><button disabled={busy || !item.id} onClick={() => void updateItem(item)}>수정 저장</button><button className="danger-text" disabled={!item.id} onClick={() => void deleteItem(item)}>삭제</button></div>
        </details>
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

function SubjectNavigator({ subjects, activeSubject, onChange, progress }: {
  subjects: string[];
  activeSubject: string;
  onChange: (subject: string) => void;
  progress?: (subject: string) => string;
}) {
  return <div className="subject-navigator">
    <span>과목 선택</span>
    <div className="subject-tabs unified-subject-tabs">
      {subjects.map((subject) => <button className={subject === activeSubject ? "active" : ""} onClick={() => onChange(subject)} key={subject}>
        <b>{subject}</b>
        {progress && <small>{progress(subject)}</small>}
      </button>)}
    </div>
  </div>;
}

function Assessments({ data, setData, plan, activeSubject, setActiveSubject, onDeleteStudent, onSave }: {
  data: AssessmentStudent[];
  setData: React.Dispatch<React.SetStateAction<AssessmentStudent[]>>;
  plan: AssessmentPlan[];
  activeSubject: string;
  setActiveSubject: (subject: string) => void;
  onDeleteStudent: (id: number) => void;
  onSave: () => Promise<string>;
}) {
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
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
    setMessage("");
  };
  const cycle = (row: number, col: number) => {
    const order: Level[] = ["-", "상", "중", "하", "미응시", "평가 예정"];
    setData((current) => current.map((student, r) => r !== row ? student : {
      ...student,
      assessments: student.assessments.map((level, c) => c !== col ? level : order[(order.indexOf(level) + 1) % order.length]),
    }));
    setDirty(true);
  };
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const updatedAt = await onSave();
      setLastSavedAt(new Date(updatedAt));
      setDirty(false);
      setMessage("변경사항을 저장했습니다.");
    } finally {
      setSaving(false);
    }
  }, [onSave]);
  useEffect(() => {
    if (!dirty || saving) return;
    const timer = window.setTimeout(() => void save(), 1500);
    return () => window.clearTimeout(timer);
  }, [dirty, save, saving]);
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
    setMessage(`${changed}개의 미입력 칸에 '${bulkLevel}'을 적용했습니다.`);
  };
  const clearAll = () => {
    if (!window.confirm(`${activeSubject}의 현재 화면 평가수준을 모두 미입력으로 바꿀까요?`)) return;
    setData((current) => current.map((student) => ({ ...student, assessments: student.assessments.map(() => "-") })));
    setDirty(true);
    setMessage(`${activeSubject} 평가수준을 모두 초기화했습니다.`);
  };
  const pasteLevels = async () => {
    setMessage("");
    try {
      const clipboard = await navigator.clipboard.readText();
      const rows = clipboard.trim().split(/\r?\n/).filter(Boolean).map((line) => line.split("\t").map((cell) => cell.trim()));
      if (!rows.length) throw new Error("클립보드에서 붙여넣을 내용을 찾지 못했습니다.");
      const allowed = new Set<Level>(["상", "중", "하", "미응시", "평가 예정", "-"]);
      const normalized = rows.map((cells) => {
        const direct = cells.slice(0, visiblePlan.length);
        if (direct.every((cell) => allowed.has(cell as Level))) return direct as Level[];
        const trailing = cells.slice(-visiblePlan.length);
        if (trailing.every((cell) => allowed.has(cell as Level))) return trailing as Level[];
        return null;
      });
      if (normalized.some((row) => !row)) throw new Error("붙여넣기 영역에는 상·중·하·미응시·평가 예정 또는 -만 입력해 주세요.");
      const usable = normalized.slice(0, data.length) as Level[][];
      setData((current) => current.map((student, rowIndex) => ({
        ...student,
        assessments: student.assessments.map((level, columnIndex) => usable[rowIndex]?.[columnIndex] ?? level),
      })));
      setDirty(true);
      setMessage(`${usable.length}명 × ${visiblePlan.length}개 평가수준을 붙여넣었습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "클립보드 내용을 붙여넣지 못했습니다.");
    }
  };
  return (
    <section>
      <div className="page-heading">
        <div><p className="eyebrow">{activeSubject} · 1학기</p><h1>평가 수준 입력</h1><p>셀을 눌러 학생별 성취 수준을 빠르게 입력하세요.</p></div>
        <div className="heading-actions"><span className={`autosave-state ${saving ? "saving" : dirty ? "dirty" : lastSavedAt ? "saved" : "idle"}`}>{saving ? "저장 중…" : dirty ? "저장 대기 중" : lastSavedAt ? `마지막 저장 ${lastSavedAt.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })}` : "마지막 저장 기록 없음"}</span><button onClick={() => void save()} disabled={saving || !dirty}>{saving ? "저장 중…" : "저장"}</button></div>
      </div>
      <div className="workspace-toolbar assessment-workspace-toolbar">
        <SubjectNavigator subjects={subjects} activeSubject={activeSubject} onChange={changeSubject} progress={(subject) => subject === activeSubject ? `${completedCount}/${expectedCount}` : `${plan.filter((item) => item.subject === subject).length}개 영역`} />
        <span><i className="level high" /> 상 <i className="level middle" /> 중 <i className="level low" /> 하 <i className="level absent" /> 미응시 <i className="level planned" /> 평가 예정</span>
      </div>
      <details className="secondary-tools">
        <summary>일괄 입력 도구</summary>
        <div className="assessment-bulk-tools">
          <div><select aria-label="일괄 적용 수준" value={bulkLevel} onChange={(event) => setBulkLevel(event.target.value as Level)}><option>상</option><option>중</option><option>하</option><option>미응시</option><option>평가 예정</option></select><button onClick={applyToMissing}>미입력 전체 적용</button><button className="secondary" onClick={() => void pasteLevels()}>엑셀 표 붙여넣기</button><button className="danger-text" onClick={clearAll}>전체 초기화</button></div>
          <span>평가 수준 영역만 복사하거나 번호·이름을 포함한 표를 붙여넣을 수 있습니다.</span>
        </div>
      </details>
      {message && <p className="student-message">{message}</p>}
      <div className="assessment-wrap">
        <table className="assessment-table">
          <thead><tr><th>번호</th><th>이름</th>{visiblePlan.map((item, index) => <th key={`${item.unit}-${item.domain}-${index}`} title={item.goal}><b>{item.unit}</b><small>{item.domain}</small></th>)}<th>관리</th></tr></thead>
          <tbody>{data.map((student, row) => <tr key={student.id}><td>{student.number ?? student.id}</td><td><strong>{student.name}</strong></td>{student.assessments.map((level, col) => <td key={col}><button aria-label={`${student.name} ${col + 1}단원 수준 ${level}`} className={`level-button level-${level === "평가 예정" ? "평가예정" : level}`} onClick={() => cycle(row, col)}>{level}</button></td>)}<td><button className="delete-student" onClick={() => onDeleteStudent(student.id)} aria-label={`${student.name} 삭제`}>삭제</button></td></tr>)}</tbody>
        </table>
      </div>
      <div className="bottom-action"><span>입력 완료 <strong>{completedCount} / {expectedCount}</strong> · 미입력 {Math.max(expectedCount - completedCount, 0)}개</span></div>
    </section>
  );
}

function Comments({ assessmentDataBySubject, plan, roster }: { assessmentDataBySubject: Record<string, AssessmentStudent[]>; plan: AssessmentPlan[]; roster: AssessmentStudent[] }) {
  type CommentJob = { id: string; status: string; subject: string; totalItems: number; completedItems: number; failedItems: number; totalBatches: number; currentBatch: number; error?: string; completedAt?: string | null };
  type CommentSelection = { text: string; start: number; end: number };
  const subjects = [...new Set(plan.map((item) => item.subject))];
  const [selectedSubject, setSelectedSubject] = useState(subjects[0] ?? "국어");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [commentParts, setCommentParts] = useState<Array<{ studentId: number; subject: string; assessmentIndex: number; sentence: string; status: string; issues: string[] }>>([]);
  const [loading, setLoading] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [subjectGeneratedAt, setSubjectGeneratedAt] = useState<Record<string, string>>({});
  const [activeJob, setActiveJob] = useState<CommentJob | null>(null);
  const [evidenceKey, setEvidenceKey] = useState("");
  const [rewriteBusyKey, setRewriteBusyKey] = useState("");
  const [selectedText, setSelectedText] = useState<Record<string, CommentSelection>>({});
  const loadGeneratedComments = useCallback(async () => {
    try {
      const response = await fetch("/api/generated-comments");
      const result = await response.json() as {
        comments?: Array<{ studentId: number; subject: string; comment: string; candidates: string[]; confirmed: boolean; updatedAt: string }>;
        parts?: Array<{ studentId: number; subject: string; assessmentIndex: number; sentence: string; status: string; issues: string[] }>;
      };
      if (!response.ok) return;
      setCommentParts(result.parts ?? []);
      setComments(Object.fromEntries((result.comments ?? []).map((item) => [`${item.studentId}|${item.subject}`, item.comment])));
      setSubjectGeneratedAt((result.comments ?? []).reduce<Record<string, string>>((latest, item) => {
        if (!latest[item.subject] || latest[item.subject] < item.updatedAt) latest[item.subject] = item.updatedAt;
        return latest;
      }, {}));
    } catch {
      // 저장된 결과를 불러오지 못해도 새 생성은 계속 사용할 수 있음.
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void loadGeneratedComments());
    fetch("/api/comment-jobs").then(async (response) => {
      const result = await response.json() as { job?: CommentJob | null };
      if (response.ok && result.job) {
        setActiveJob(result.job);
        if (["queued", "running"].includes(result.job.status)) setLoading(true);
      }
    }).catch(() => undefined);
  }, [loadGeneratedComments]);
  const activeCommentJobId = activeJob?.id;
  const activeCommentJobStatus = activeJob?.status;
  const activeCommentJobCompleted = activeJob?.completedItems ?? 0;
  const activeCommentJobTotal = activeJob?.totalItems ?? 0;
  useEffect(() => {
    if (!activeCommentJobId || !activeCommentJobStatus || !["queued", "running"].includes(activeCommentJobStatus)) return;
    queueMicrotask(() => setGenerationProgress(`${activeCommentJobCompleted}/${activeCommentJobTotal}`));
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
          if (result.job.failedItems) setError(result.job.error || `${result.job.failedItems}명이 생성되지 않았습니다. 과목 AI 평어 생성을 다시 실행해 주세요.`);
          else setError("");
          const generatedAt = result.job.completedAt || new Date().toISOString();
          if (result.job.subject) setSubjectGeneratedAt((current) => ({ ...current, [result.job!.subject]: generatedAt }));
        }
      } catch {
        // 페이지 연결이 잠시 끊겨도 서버 작업은 계속 진행됨.
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeCommentJobCompleted, activeCommentJobId, activeCommentJobStatus, activeCommentJobTotal, loadGeneratedComments]);
  const formattedLastGeneratedAt = subjectGeneratedAt[selectedSubject]
    ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(subjectGeneratedAt[selectedSubject]))
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
  const generateSubjectComments = async (retryStudentIds?: number[]) => {
    if (!roster.length) return setError("등록된 학생이 없습니다.");
    const subjectStudents = assessmentDataBySubject[selectedSubject] ?? [];
    const eligibleIds = subjectStudents
      .filter((student) => student.assessments.some((level) => ["상", "중", "하"].includes(level)))
      .map((student) => student.id);
    let targetIds = retryStudentIds?.length ? retryStudentIds.filter((id) => eligibleIds.includes(id)) : eligibleIds;
    let overwriteExisting = false;
    if (!retryStudentIds?.length) {
      const filledIds = eligibleIds.filter((id) => Boolean(comments[`${id}|${selectedSubject}`]?.trim()));
      if (filledIds.length) {
        if (window.confirm(`${selectedSubject} 평어가 ${filledIds.length}명에게 이미 있습니다.\n\n확인: 비어 있는 학생만 생성\n취소: 다른 선택 보기`)) {
          targetIds = eligibleIds.filter((id) => !filledIds.includes(id));
        } else if (window.confirm(`기존 ${filledIds.length}명의 평어도 덮어쓰고 ${eligibleIds.length}명 전체를 다시 생성할까요?\n교사가 수정한 내용도 바뀝니다.`)) overwriteExisting = true;
        else return;
      }
    }
    if (!targetIds.length) return setError(`${selectedSubject}에서 상·중·하 평가수준이 입력된 학생이 없습니다.`);
    setLoading(true);
    setError("");
    setGenerationProgress("작업 등록 중…");
    try {
      const scores = {
        [selectedSubject]: subjectStudents
          .filter((student) => targetIds.includes(student.id))
          .map((student) => ({ studentId: student.id, levels: student.assessments })),
      };
      const response = await fetch("/api/comment-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scores, selectedStudentIds: targetIds, overwriteExisting }),
      });
      const result = await response.json() as { job?: CommentJob; error?: string };
      if (!response.ok || !result.job) throw new Error(result.error || "백그라운드 생성 작업을 시작하지 못했습니다.");
      setActiveJob(result.job);
      setGenerationProgress(`${result.job.completedItems}/${result.job.totalItems}`);
      setCopied(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${selectedSubject} 교과 평어를 생성하지 못했습니다.`);
      setLoading(false);
      setGenerationProgress("");
    }
  };
  const clearSubjectComments = async () => {
    const count = roster.filter((student) => comments[`${student.id}|${selectedSubject}`]?.trim()).length;
    if (!count) return;
    if (!window.confirm(`${selectedSubject} 평어 ${count}건을 초기화할까요?\n학생 명단·평가계획·평가수준은 유지됩니다.`)) return;
    const response = await fetch("/api/generated-comments", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: selectedSubject, confirmation: "평어초기화" }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) return setError(result.error || "교과 평어를 초기화하지 못했습니다.");
    setComments((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.endsWith(`|${selectedSubject}`))));
    setCommentParts((current) => current.filter((part) => part.subject !== selectedSubject));
    setSubjectGeneratedAt((current) => { const next = { ...current }; delete next[selectedSubject]; return next; });
    setError("");
  };
  const saveComment = async (studentId: number, subject: string, comment: string) => {
    try {
      const response = await fetch("/api/generated-comments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, subject, comment, confirmed: false }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "평어를 저장하지 못했습니다.");
    } catch {
      setError("수정한 평어를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };
  const rewriteComment = async (studentId: number, subject: string, mode: "regenerate" | "shorter" | "specific" | "selection") => {
    const key = `${studentId}|${subject}`;
    const subjectPlan = plan.filter((item) => item.subject === subject);
    const assessment = assessmentDataBySubject[subject]?.find((item) => item.id === studentId);
    if (!assessment) return;
    if (mode === "regenerate" && !window.confirm(`${roster.find((student) => student.id === studentId)?.name ?? "이 학생"}의 ${subject} 평어 전체를 다시 생성할까요?\n\n현재 평어는 이전 버전으로 보관되고 새 결과로 교체됩니다. AI 호출 1회가 사용됩니다.`)) return;
    const selection = selectedText[key];
    setRewriteBusyKey(`${key}|${mode}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/generate-comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          levels: assessment.assessments,
          plan: subjectPlan,
          mode,
          currentComment: comments[key] ?? "",
          selectedText: selection?.text ?? "",
          selectionStart: selection?.start,
          selectionEnd: selection?.end,
        }),
      });
      const result = await response.json() as { comment?: string; error?: string };
      if (!response.ok || !result.comment) throw new Error(result.error || "평어를 다시 작성하지 못했습니다.");
      setComments((current) => ({ ...current, [key]: result.comment! }));
      await saveComment(studentId, subject, result.comment);
      setCommentParts((current) => current.filter((part) => part.studentId !== studentId || part.subject !== subject));
      if (mode === "selection") {
        setSelectedText((current) => { const next = { ...current }; delete next[key]; return next; });
        setNotice("선택한 부분을 평가 근거에 맞게 변경했습니다.");
      } else if (mode === "regenerate") {
        setNotice(`${roster.find((student) => student.id === studentId)?.name ?? "학생"}의 ${subject} 평어를 다시 생성했습니다.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "평어를 다시 작성하지 못했습니다.");
    } finally {
      setRewriteBusyKey("");
    }
  };
  const eligibleStudentIds = new Set((assessmentDataBySubject[selectedSubject] ?? [])
    .filter((student) => student.assessments.some((level) => ["상", "중", "하"].includes(level)))
    .map((student) => student.id));
  const eligibleCount = eligibleStudentIds.size;
  const completedCount = roster.filter((student) =>
    eligibleStudentIds.has(student.id) && Boolean(comments[`${student.id}|${selectedSubject}`])).length;
  const selectedSubjectIsGenerating = loading && activeJob?.subject === selectedSubject;
  return (
    <section>
      <div className="page-heading"><div><p className="eyebrow">AI DRAFT</p><h1>교과 평어</h1><p>평가수준 입력을 마친 과목부터 학생별 평어를 생성할 수 있습니다.</p></div></div>
      <div className="review-layout comments-review-layout">
        <div className="review-content">
          <div className="workspace-toolbar comments-toolbar">
            <SubjectNavigator subjects={subjects} activeSubject={selectedSubject} onChange={(subject) => { setSelectedSubject(subject); setCopied(false); }} />
            <div className="subject-generation-controls">
              <div><span>{formattedLastGeneratedAt ? `마지막 생성 ${formattedLastGeneratedAt}` : "생성 기록 없음"}</span><strong>{eligibleCount}명 중 {completedCount}명 생성 완료</strong></div>
              <button className="subject-generate-button" onClick={() => void generateSubjectComments()} disabled={loading || !eligibleCount}>{selectedSubjectIsGenerating ? generationProgress || `${selectedSubject} 생성 중…` : `✦ ${selectedSubject} AI 평어 생성`}</button>
              <button className="copy-comments" onClick={() => void copySubjectComments()} disabled={!roster.some((student) => comments[`${student.id}|${selectedSubject}`])}>{copied ? "복사됨 ✓" : "평어만 복사하기"}</button>
              <button className="subject-reset-button" title="학생 명단·평가계획·평가수준은 유지하고 현재 과목의 생성된 평어만 초기화합니다." onClick={() => void clearSubjectComments()} disabled={loading || !completedCount}><span aria-hidden="true">↺</span>{selectedSubject} 결과 초기화</button>
            </div>
          </div>
          {error && <p className="generation-error">! {error}</p>}
          {notice && <p className="student-message" role="status">{notice}</p>}
          {selectedSubjectIsGenerating && <div className="comment-loading class-loading"><span>✦</span><p>{selectedSubject} 평어를 생성하고 있어요. 페이지를 이동해도 계속 진행됩니다.</p></div>}
          <div className="comments-table-wrap">
            <table className="comments-table subject-comments-table">
              <thead><tr><th>번호</th><th>이름</th><th>평어</th><th>검수</th></tr></thead>
              <tbody>{roster.map((student, index) => {
                const key = `${student.id}|${selectedSubject}`;
                const text = comments[key] ?? "";
                const assessment = assessmentDataBySubject[selectedSubject]?.[index];
                const hasLevel = assessment?.assessments.some((level) => ["상", "중", "하"].includes(level));
                const evidence = plan.filter((item) => item.subject === selectedSubject).map((item, planIndex) => ({
                  ...item, level: assessment?.assessments[planIndex] ?? "-",
                })).filter((item) => ["상", "중", "하"].includes(item.level));
                const validation = validateRecord(text);
                const areaStatuses = commentParts.filter((part) => part.studentId === student.id && part.subject === selectedSubject);
                const areaIssues = areaStatuses
                  .map((part) => ({ ...part, visibleIssues: commentAreaIssuesForDisplay(part.status, part.issues) }))
                  .filter((part) => part.status === "needs_review" || part.visibleIssues.length > 0);
                const comparisons = roster.filter((other) => other.id !== student.id).map((other) => ({
                  student: other,
                  ...recordSimilarityDetails(text, comments[`${other.id}|${selectedSubject}`] ?? ""),
                })).sort((left, right) => right.score - left.score);
                const similarStudents = comparisons.filter((item) => item.score >= 0.82);
                const closest = comparisons[0];
                return <tr id={`comment-${student.id}`} key={student.id}>
                  <td>{student.number ?? student.id}</td>
                  <td><strong>{student.name}</strong><small>{text ? `${new TextEncoder().encode(text).length}B` : hasLevel ? "생성 대기" : "수준 미입력"}</small></td>
                  <td><textarea value={text} onSelect={(event) => {
                    const target = event.currentTarget;
                    const selection = target.value.slice(target.selectionStart, target.selectionEnd);
                    setSelectedText((current) => {
                      const next = { ...current };
                      if (selection.trim()) next[key] = { text: selection.trim(), start: target.selectionStart, end: target.selectionEnd };
                      else delete next[key];
                      return next;
                    });
                  }} onChange={(event) => {
                    setComments((current) => ({ ...current, [key]: event.target.value }));
                    setSelectedText((current) => { const next = { ...current }; delete next[key]; return next; });
                    setCopied(false);
                  }} onBlur={(event) => void saveComment(student.id, selectedSubject, event.target.value)} placeholder={hasLevel ? "AI 평어 생성 버튼을 누르면 결과가 표시됩니다." : "상·중·하 평가 수준이 입력되지 않았습니다."} />
                    {areaIssues.length > 0 && <div className="comment-area-issues">{areaIssues.map((part) => {
                      const domain = plan.filter((item) => item.subject === selectedSubject)[part.assessmentIndex]?.domain || `${part.assessmentIndex + 1}번째`;
                      const reasons = part.visibleIssues.length ? part.visibleIssues : ["AI 생성이 완료되지 않아 교사 확인이 필요합니다."];
                      return <article className={part.status === "needs_review" ? "fail" : "warning"} key={`${part.assessmentIndex}-${part.status}`}>
                        <strong>{domain} 영역 · {part.status === "needs_review" ? "생성 미완료" : "근거 확인 권장"}</strong>
                        {reasons.map((issue) => <span key={issue}>{issue}</span>)}
                      </article>;
                    })}</div>}
                    {selectedText[key] && <small className="comment-selection-hint">“{selectedText[key].text.slice(0, 36)}{selectedText[key].text.length > 36 ? "…" : ""}” 선택됨</small>}
                    <div className="comment-row-actions"><button className="regenerate-button" disabled={!text || !!rewriteBusyKey} onMouseDown={(event) => event.preventDefault()} onClick={() => void rewriteComment(student.id, selectedSubject, "regenerate")}>{rewriteBusyKey === `${key}|regenerate` ? "생성 중…" : "다시 생성"}</button><button disabled={!selectedText[key] || !!rewriteBusyKey} title={selectedText[key] ? "선택한 부분만 평가 근거에 맞게 바꿉니다." : "평어에서 바꿀 문장이나 표현을 먼저 선택하세요."} onMouseDown={(event) => event.preventDefault()} onClick={() => void rewriteComment(student.id, selectedSubject, "selection")}>{rewriteBusyKey === `${key}|selection` ? "변경 중…" : "선택한 부분 바꾸기"}</button><button className="evidence-button" onMouseDown={(event) => event.preventDefault()} onClick={() => setEvidenceKey((current) => current === key ? "" : key)}>생성 근거 {evidenceKey === key ? "닫기" : "보기"}</button></div>
                    {evidenceKey === key && <div className="comment-evidence">{evidence.length ? evidence.map((item, evidenceIndex) => <article key={`${item.unit}-${evidenceIndex}`}><strong>{item.unit} · {item.domain} · {item.level}</strong><span>{item.level === "상" ? item.high : item.level === "중" ? item.middle : item.low}</span></article>) : <p>평어 생성에 사용된 상·중·하 평가 근거가 없습니다.</p>}</div>}
                  </td>
                  <td className="validation-cell"><div><span className={validation.endingsOk ? "pass" : "fail"}>종결 {validation.endingsOk ? "정상" : "확인"}</span><span className={!validation.forbidden.length ? "pass" : "fail"}>금지어 {!validation.forbidden.length ? "없음" : "확인"}</span><span className={validation.spellingOk ? "pass" : "fail"} title={validation.spellingIssues.join("\n")}>맞춤법 {validation.spellingOk ? "정상" : `${validation.spellingIssues.length}건`}</span><span className={!similarStudents.length ? "pass" : "fail"}>최대 중복 {closest?.score ? `${Math.round(closest.score * 100)}%` : "0%"}</span></div>{closest?.score > 0 && <div className="similarity-detail"><strong>{closest.student.name} 학생과 {Math.round(closest.score * 100)}%</strong>{closest.overlaps.length > 0 && <span>겹치는 표현: {closest.overlaps.join(" · ")}</span>}</div>}{!validation.spellingOk && <ul className="spelling-issues">{validation.spellingIssues.map((issue, issueIndex) => <li key={issueIndex}>{issue}</li>)}</ul>}</td>
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
  type BehaviorJob = { id: string; status: string; totalItems: number; completedItems: number; failedItems: number; error?: string; completedAt?: string | null };
  type BehaviorRecord = { characteristic: string; behavior: string };
  const emptyBehaviorRecord = (): BehaviorRecord => ({ characteristic: "", behavior: "" });
  const [records, setRecords] = useState<Record<number, BehaviorRecord>>({});
  const [loading, setLoading] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");
  const [activeJob, setActiveJob] = useState<BehaviorJob | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [lastGeneratedAt, setLastGeneratedAt] = useState("");
  const [referenceOpen, setReferenceOpen] = useState(true);
  const [activeCategory, setActiveCategory] = useState(behaviorReferences[0].category);
  const [activeStudentId, setActiveStudentId] = useState<number | null>(roster[0]?.id ?? null);
  const [rewriteBusyKey, setRewriteBusyKey] = useState("");
  const loadBehaviors = async () => {
    try {
      const response = await fetch("/api/student-behaviors");
      const result = await response.json() as { behaviors?: Array<{ studentId: number; characteristic: string; behavior: string; confirmed: boolean; updatedAt: string }> };
      if (!response.ok || !result.behaviors) return;
      setRecords(Object.fromEntries(result.behaviors.map((item) => [item.studentId, { characteristic: item.characteristic, behavior: item.behavior }])));
      setLastGeneratedAt(result.behaviors.map((item) => item.updatedAt).sort().at(-1) ?? "");
    } catch {
      setError("저장된 행동특성을 불러오지 못했습니다.");
    }
  };
  useEffect(() => {
    queueMicrotask(() => void loadBehaviors());
    fetch("/api/behavior-jobs").then(async (response) => {
      const result = await response.json() as { job?: BehaviorJob | null };
      if (response.ok && result.job) {
        setActiveJob(result.job);
        if (["queued", "running"].includes(result.job.status)) setLoading(true);
      }
    }).catch(() => undefined);
  }, []);
  const activeBehaviorJobId = activeJob?.id;
  const activeBehaviorJobStatus = activeJob?.status;
  const activeBehaviorJobCompleted = activeJob?.completedItems ?? 0;
  const activeBehaviorJobTotal = activeJob?.totalItems ?? 0;
  useEffect(() => {
    if (!activeBehaviorJobId || !activeBehaviorJobStatus || !["queued", "running"].includes(activeBehaviorJobStatus)) return;
    queueMicrotask(() => setGenerationProgress(`${activeBehaviorJobCompleted}/${activeBehaviorJobTotal}`));
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch("/api/behavior-jobs");
        const result = await response.json() as { job?: BehaviorJob | null };
        if (!response.ok || !result.job) return;
        setActiveJob(result.job);
        setGenerationProgress(`${result.job.completedItems}/${result.job.totalItems}`);
        if (!["queued", "running"].includes(result.job.status)) {
          window.clearInterval(timer);
          setLoading(false);
          setGenerationProgress("");
          await loadBehaviors();
          if (result.job.failedItems) setError(result.job.error || `${result.job.failedItems}명의 행동특성이 생성되지 않았습니다. 다시 실행해 재시도해 주세요.`);
          else setError("");
          setLastGeneratedAt(result.job.completedAt || new Date().toISOString());
        }
      } catch {
        // 페이지 연결이 끊겨도 서버 작업은 계속 진행됨.
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeBehaviorJobCompleted, activeBehaviorJobId, activeBehaviorJobStatus, activeBehaviorJobTotal]);

  const updateRecord = (studentId: number, patch: Partial<BehaviorRecord>) => {
    setRecords((current) => ({ ...current, [studentId]: { ...(current[studentId] ?? emptyBehaviorRecord()), ...patch } }));
    setCopied(false);
  };
  const addReferencePhrase = (phrase: string) => {
    if (activeStudentId === null) return setError("먼저 학생의 특성 입력칸을 선택해 주세요.");
    const current = records[activeStudentId]?.characteristic?.trim() ?? "";
    updateRecord(activeStudentId, { characteristic: current ? `${current} · ${phrase}` : phrase });
    setError("");
  };
  const generateAll = async () => {
    let inputs = roster.map((student) => ({ studentId: student.id, characteristic: records[student.id]?.characteristic ?? "" })).filter((item) => item.characteristic.trim());
    if (!inputs.length) return setError("한 명 이상의 특성을 입력해 주세요.");
    const filledIds = inputs.filter((item) => records[item.studentId]?.behavior.trim()).map((item) => item.studentId);
    if (filledIds.length) {
      if (window.confirm(`행동특성이 ${filledIds.length}명에게 이미 있습니다.\n\n확인: 비어 있는 학생만 생성\n취소: 다른 선택 보기`)) {
        inputs = inputs.filter((item) => !filledIds.includes(item.studentId));
        if (!inputs.length) return setError("특성이 입력된 모든 학생의 행동특성이 이미 작성되어 있습니다.");
      } else if (!window.confirm(`기존 ${filledIds.length}명의 행동특성도 덮어쓰고 ${inputs.length}명 전체를 다시 생성할까요?\n교사가 수정한 내용도 바뀝니다.`)) {
        return;
      }
    }
    const insufficient = inputs.filter((item) => countBehaviorCharacteristics(item.characteristic) < 4);
    if (insufficient.length) {
      const numbers = insufficient.map((item) => roster.find((student) => student.id === item.studentId)?.number ?? item.studentId);
      return setError(`${numbers.join(", ")}번 학생은 특성이 4개 미만입니다. 학생별로 4~5가지를 입력해 주세요.`);
    }
    const blocked = inputs.filter((item) => !validateBehaviorSource(item.characteristic).valid);
    if (blocked.length) {
      const numbers = blocked.map((item) => roster.find((student) => student.id === item.studentId)?.number ?? item.studentId);
      return setError(`${numbers.join(", ")}번 학생의 관찰 사실에서 금지 내용 또는 개인정보를 삭제해 주세요.`);
    }
    setLoading(true);
    setError("");
    setGenerationProgress("작업 등록 중…");
    try {
      const response = await fetch("/api/behavior-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ students: inputs }),
      });
      const result = await response.json() as { job?: BehaviorJob; error?: string };
      if (!response.ok || !result.job) throw new Error(result.error || "행동특성 백그라운드 작업을 시작하지 못했습니다.");
      setActiveJob(result.job);
      setGenerationProgress(`${result.job.completedItems}/${result.job.totalItems}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "행동특성을 생성하지 못했습니다.");
      setLoading(false);
      setGenerationProgress("");
    }
  };
  const clearBehaviors = async () => {
    const filledCount = roster.filter((student) => records[student.id]?.behavior.trim()).length;
    if (!filledCount) return;
    if (!window.confirm(`행동특성 생성 결과 ${filledCount}건을 초기화할까요?\n학생별로 입력한 특성은 유지됩니다.`)) return;
    const removeSources = window.confirm("학생 특성 입력 내용도 함께 삭제할까요?\n\n확인: 특성과 결과 모두 삭제\n취소: 생성 결과만 삭제");
    const response = await fetch("/api/student-behaviors", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: removeSources ? "all" : "results", confirmation: "행동특성초기화" }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) return setError(result.error || "행동특성을 초기화하지 못했습니다.");
    setRecords((current) => Object.fromEntries(roster.map((student) => [
      student.id,
      removeSources ? emptyBehaviorRecord() : { characteristic: current[student.id]?.characteristic ?? "", behavior: "" },
    ])));
    setLastGeneratedAt("");
    setError("");
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
  const saveRecord = async (studentId: number, record: BehaviorRecord) => {
    try {
      const response = await fetch("/api/student-behaviors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, characteristic: record.characteristic, behavior: record.behavior, confirmed: false }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "행동특성을 저장하지 못했습니다.");
    } catch {
      setError("수정한 행동특성 내용을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };
  const rewriteBehavior = async (studentId: number, record: BehaviorRecord, mode: "regenerate" | "length") => {
    if (!record.characteristic.trim()) return setError("관찰 사실을 먼저 입력해 주세요.");
    const busyKey = `${studentId}|${mode}`;
    setRewriteBusyKey(busyKey);
    setError("");
    try {
      const response = await fetch("/api/generate-behavior", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, observation: record.characteristic, currentBehavior: record.behavior, mode }),
      });
      const result = await response.json() as { behavior?: string; error?: string };
      if (!response.ok || !result.behavior) throw new Error(result.error || "행동특성을 다시 생성하지 못했습니다.");
      const rewritten = { ...record, behavior: result.behavior };
      updateRecord(studentId, rewritten);
      await saveRecord(studentId, rewritten);
      setLastGeneratedAt(new Date().toISOString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "행동특성을 다시 생성하지 못했습니다.");
    } finally {
      setRewriteBusyKey("");
    }
  };
  const formattedLastGeneratedAt = lastGeneratedAt
    ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(lastGeneratedAt))
    : "";
  const blockedSourceCount = roster.filter((student) => {
    const characteristic = records[student.id]?.characteristic?.trim() ?? "";
    return characteristic && !validateBehaviorSource(characteristic).valid;
  }).length;
  const eligibleStudentIds = roster.filter((student) => records[student.id]?.characteristic.trim()).map((student) => student.id);

  return (
    <section>
      <div className="page-heading">
        <div><p className="eyebrow">GROWTH NOTE</p><h1>행동특성 작성</h1><p>학생별 특성을 입력하고 한 번에 행동특성을 생성하세요.</p></div>
        <div className="ai-generate-actions">{formattedLastGeneratedAt && <span>마지막 사용 {formattedLastGeneratedAt}</span>}<button onClick={() => void generateAll()} disabled={loading || blockedSourceCount > 0}>{loading ? generationProgress || "전체 생성 중…" : blockedSourceCount ? `입력 확인 ${blockedSourceCount}명` : "✦ AI 행특 생성"}</button><button className="danger-text" onClick={() => void clearBehaviors()} disabled={loading || !roster.some((student) => records[student.id]?.behavior.trim())}>행동특성 초기화</button></div>
      </div>
      <div className="review-content behavior-table-content">
        <div className="workspace-toolbar behavior-table-toolbar"><div className="behavior-generation-summary"><span className="behavior-target-count"><small>생성 대상</small><strong>{eligibleStudentIds.length}/{roster.length}명</strong></span><span className="behavior-auto-rule"><i aria-hidden="true">✓</i>특성을 4개 이상 입력한 학생 자동 포함</span><span className="behavior-byte-target">권장 길이 500~550B</span></div><div className="behavior-toolbar-actions"><button className="reference-open-button" onClick={() => setReferenceOpen((current) => !current)}>{referenceOpen ? "참고자료 닫기" : "참고자료 열기"}</button><button className="copy-comments" onClick={() => void copyBehaviors()} disabled={!roster.some((student) => records[student.id]?.behavior)}>{copied ? "복사됨 ✓" : "행동특성만 복사하기"}</button></div></div>
        {error && <p className="generation-error">! {error}</p>}
        {loading && <div className="comment-loading class-loading"><span>✦</span><p>입력된 모든 학생의 행동특성을 생성하고 있어요.</p></div>}
        <div className={`behavior-work-area ${referenceOpen ? "with-reference" : ""}`}>
          <div className="comments-table-wrap">
            <table className="comments-table behavior-table">
              <thead><tr><th>번호</th><th>이름</th><th>특성</th><th>행동특성</th><th>검수</th></tr></thead>
              <tbody>{roster.map((student) => {
                const record = records[student.id] ?? emptyBehaviorRecord();
                const validation = validateRecord(record.behavior, true);
                const sourceValidation = validateBehaviorSource(record.characteristic);
                const sourceIssues = [...sourceValidation.forbidden, ...sourceValidation.sensitive];
                const comparisons = roster.filter((other) => other.id !== student.id).map((other) => ({
                  student: other,
                  ...recordSimilarityDetails(record.behavior, records[other.id]?.behavior ?? ""),
                })).sort((left, right) => right.score - left.score);
                const similarStudents = comparisons.filter((item) => item.score >= 0.82);
                const closest = comparisons[0];
                const characteristicCount = countBehaviorCharacteristics(record.characteristic);
                return <tr className={activeStudentId === student.id ? "active-reference-row" : ""} key={student.id}><td>{student.number ?? student.id}</td><td><strong>{student.name}</strong></td><td><textarea className={sourceIssues.length ? "input-blocked" : ""} value={record.characteristic} onFocus={() => setActiveStudentId(student.id)} onChange={(event) => updateRecord(student.id, { characteristic: event.target.value })} onBlur={() => void saveRecord(student.id, records[student.id] ?? record)} placeholder={"학습 태도: …\n교우관계: …\n책임감: …\n생활 습관: …\n성장 모습: …"} />{sourceIssues.length > 0 && <small className="source-warning">AI 전송 불가: {sourceIssues.join(" · ")}</small>}{record.characteristic.trim() && characteristicCount < 4 && <small className="source-warning characteristic-warning">특성을 {4 - characteristicCount}개 더 입력해 주세요.</small>}</td><td><textarea value={record.behavior} onChange={(event) => updateRecord(student.id, { behavior: event.target.value })} onBlur={() => void saveRecord(student.id, records[student.id] ?? record)} placeholder={record.characteristic ? "AI 행특 생성 버튼을 누르면 결과가 표시됩니다." : "특성을 먼저 입력해 주세요."} /><small>{record.behavior ? `${validation.bytes} bytes` : ""}</small><div className="comment-row-actions"><button disabled={!record.characteristic || !sourceValidation.valid || !!rewriteBusyKey} onMouseDown={(event) => event.preventDefault()} onClick={() => void rewriteBehavior(student.id, record, "regenerate")}>{rewriteBusyKey === `${student.id}|regenerate` ? "생성 중…" : "다시 생성"}</button><button disabled={!record.characteristic || !record.behavior || !sourceValidation.valid || !!rewriteBusyKey} onMouseDown={(event) => event.preventDefault()} onClick={() => void rewriteBehavior(student.id, record, "length")}>{rewriteBusyKey === `${student.id}|length` ? "조정 중…" : "500~550B 맞춤"}</button></div></td><td className="validation-cell behavior-validation"><div><span className={validation.lengthOk ? "pass" : "fail"}>500~550B</span><span className={validation.endingsOk ? "pass" : "fail"}>음·임 종결</span><span className={validation.growthIncluded ? "pass" : "fail"}>성장</span><span className={!validation.forbidden.length ? "pass" : "fail"}>금지어</span><span className={validation.spellingOk ? "pass" : "fail"} title={validation.spellingIssues.join("\n")}>맞춤법 {validation.spellingOk ? "정상" : `${validation.spellingIssues.length}건`}</span><span className={!validation.repeated.length ? "pass" : "fail"}>반복</span><span className={!similarStudents.length ? "pass" : "fail"}>최대 중복 {closest?.score ? `${Math.round(closest.score * 100)}%` : "0%"}</span></div>{closest?.score > 0 && <div className="similarity-detail"><strong>{closest.student.name} 학생과 {Math.round(closest.score * 100)}%</strong>{closest.overlaps.length > 0 && <span>겹치는 표현: {closest.overlaps.join(" · ")}</span>}</div>}{!validation.spellingOk && <ul className="spelling-issues">{validation.spellingIssues.map((issue, issueIndex) => <li key={issueIndex}>{issue}</li>)}</ul>}</td></tr>;
              })}</tbody>
            </table>
          </div>
          {referenceOpen && <aside className="behavior-reference-drawer">
            <button className="drawer-close" onClick={() => setReferenceOpen(false)} aria-label="참고자료 닫기">×</button>
            <div className="reference-guide compact-reference-guide"><div><strong>작성 참고자료</strong><span>현재 학생: {activeStudentId ? `${roster.find((student) => student.id === activeStudentId)?.number ?? roster.find((student) => student.id === activeStudentId)?.id}번 ${roster.find((student) => student.id === activeStudentId)?.name}` : "특성 입력칸을 선택하세요"}</span></div><details><summary>사용 방법</summary><ol><li>학생의 특성 입력칸을 누릅니다.</li><li>영역을 바꾸며 실제 관찰한 키워드 4~5개를 선택합니다.</li><li>자동 입력된 문장을 구체적인 관찰 내용으로 다듬습니다.</li></ol></details></div>
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

function ExportResults({ roster, plan }: { roster: AssessmentStudent[]; plan: AssessmentPlan[] }) {
  const [comments, setComments] = useState<ExportComment[]>([]);
  const [behaviors, setBehaviors] = useState<ExportBehavior[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [loading, setLoading] = useState(true);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
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
  const loadGoogleStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/google/status");
      const result = await response.json() as { connected?: boolean; email?: string };
      setGoogleConnected(Boolean(result.connected));
      setGoogleEmail(result.email ?? "");
    } catch {
      setGoogleConnected(false);
      setGoogleEmail("");
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void loadGoogleStatus());
    const receive = (event: MessageEvent<{ type?: string; ok?: boolean; message?: string }>) => {
      if (event.origin !== window.location.origin || event.data?.type !== "giroksam-google-oauth") return;
      setMessage(event.data.message ?? (event.data.ok ? "Google 계정이 연결되었습니다." : "Google 계정을 연결하지 못했습니다."));
      void loadGoogleStatus();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [loadGoogleStatus]);
  const connectGoogle = () => {
    const popup = window.open("/api/google/connect", "giroksam-google-connect", "popup,width=560,height=720");
    if (!popup) setMessage("팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.");
  };
  const createGoogleSheet = async () => {
    if (!googleConnected) {
      connectGoogle();
      setMessage("Google 계정을 연결한 뒤 다시 생성 버튼을 눌러 주세요.");
      return;
    }
    setGoogleBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/google/sheets", { method: "POST" });
      const result = await response.json() as { spreadsheetUrl?: string; title?: string; error?: string; reconnect?: boolean };
      if (!response.ok || !result.spreadsheetUrl) {
        if (result.reconnect) {
          setGoogleConnected(false);
          setGoogleEmail("");
        }
        throw new Error(result.error || "Google 스프레드시트를 생성하지 못했습니다.");
      }
      setMessage(`Google Drive에 '${result.title ?? "기록샘 결과"}' 스프레드시트를 생성했습니다.`);
      window.open(result.spreadsheetUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google 스프레드시트를 생성하지 못했습니다.");
    } finally {
      setGoogleBusy(false);
    }
  };
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
      <div><p className="eyebrow">GOOGLE SHEETS · NEIS READY</p><h1>전체 결과 공유</h1><p>전체 교과 평어와 행동특성을 Google 스프레드시트로 만들거나 나이스용으로 복사합니다.</p></div>
      <div className="heading-actions"><button onClick={() => void createGoogleSheet()} disabled={loading || googleBusy}>{googleBusy ? "Google 시트 생성 중…" : "Google 스프레드시트 생성"}</button></div>
    </div>
    <section className="google-connect-card">
      <div><span className={`google-status-dot ${googleConnected ? "connected" : ""}`} /><div><strong>{googleConnected ? "Google 계정 연결됨" : "Google 계정 연결 필요"}</strong><p>{googleConnected ? `${googleEmail || "연결한 계정"}의 Drive에 새 스프레드시트를 생성합니다.` : "앱이 생성한 파일만 관리할 수 있는 최소 권한을 요청합니다."}</p></div></div>
      <button className={googleConnected ? "secondary" : ""} onClick={connectGoogle}>{googleConnected ? "다른 계정 연결" : "Google 계정 연결"}</button>
    </section>
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

function PrivacySettings({ currentName, onNameChanged }: { currentName: string; onNameChanged: (name: string) => void }) {
  const [summary, setSummary] = useState<PrivacySummary | null>(null);
  const [classConfirmation, setClassConfirmation] = useState("");
  const [accountConfirmation, setAccountConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [displayName, setDisplayName] = useState(currentName);
  useEffect(() => { queueMicrotask(() => setDisplayName(currentName)); }, [currentName]);
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
  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== passwordConfirmation) return setMessage("새 비밀번호와 확인 값이 일치하지 않습니다.");
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "비밀번호를 변경하지 못했습니다.");
      setPassword("");
      setPasswordConfirmation("");
      setMessage("비밀번호를 변경했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "비밀번호를 변경하지 못했습니다.");
    } finally { setBusy(false); }
  };
  const changeProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/profile", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName }),
      });
      const result = await response.json() as { displayName?: string; error?: string };
      if (!response.ok || !result.displayName) throw new Error(result.error || "교사 프로필을 변경하지 못했습니다.");
      setDisplayName(result.displayName);
      onNameChanged(result.displayName);
      setSummary((current) => current ? { ...current, account: { ...current.account, displayName: result.displayName! } } : current);
      setMessage("교사 이름을 변경했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "교사 프로필을 변경하지 못했습니다.");
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
      <nav className="privacy-legal-links"><a href="/privacy" target="_blank">개인정보 처리방침</a><a href="/terms" target="_blank">서비스 이용약관</a></nav>
    </section>
    <div className="account-settings-grid">
    <form className="profile-settings-card" onSubmit={(event) => void changeProfile(event)}>
      <div><p className="eyebrow">TEACHER PROFILE</p><h2>교사 이름</h2><p>대시보드와 앱 왼쪽 아래에 표시되는 이름입니다.</p></div>
      <label><span>표시 이름</span><input minLength={2} maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
      <button disabled={busy || displayName.trim().length < 2 || displayName.trim() === currentName}>{busy ? "저장 중…" : "이름 저장"}</button>
    </form>
    <form className="account-security-card" onSubmit={(event) => void changePassword(event)}>
      <div><p className="eyebrow">ACCOUNT SECURITY</p><h2>비밀번호 변경</h2><p>12자 이상이며 영문 대문자·소문자·숫자를 각각 포함해 주세요.</p></div>
      <label><span>새 비밀번호</span><input type="password" minLength={12} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,}" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></label>
      <label><span>새 비밀번호 확인</span><input type="password" minLength={12} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" required /></label>
      <button disabled={busy || !password || password !== passwordConfirmation}>{busy ? "변경 중…" : "비밀번호 변경"}</button>
    </form>
    </div>
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
  const [aiUsage, setAiUsage] = useState({ monthly: 0, limit: 150 });
  useEffect(() => {
    const idleLimitMs = 30 * 60 * 1000;
    let lastActivity = Date.now();
    const markActivity = () => { lastActivity = Date.now(); };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, markActivity, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity < idleLimitMs) return;
      window.clearInterval(timer);
      void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
        window.location.assign("/login?reason=idle");
      });
    }, 60_000);
    return () => {
      window.clearInterval(timer);
      events.forEach((event) => window.removeEventListener(event, markActivity));
    };
  }, []);
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
        if (response.ok) setAiUsage({ monthly: Number(result.monthly ?? 0), limit: Number(result.limit ?? 150) });
      } catch {
        // 사용량 표시 실패는 AI 작성 기능을 막지 않음.
      }
    };
    void loadUsage();
    const timer = window.setInterval(() => void loadUsage(), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const deleteStudent = async (id: number) => {
    const student = roster.find((item) => item.id === id);
    if (!student || !window.confirm(`${student.name} 학생을 전출·비활성 처리할까요?\n\n기존 평가와 생성 기록은 보존됩니다.`)) return;
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
    const result = await response.json() as { updatedAt?: string };
    return result.updatedAt ?? new Date().toISOString();
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
        <nav><button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><span>⚙</span>개인정보·설정</button></nav>
        <div className="sidebar-bottom"><div className="storage"><span>이번 달 AI 생성</span><strong>{aiUsage.monthly} / {aiUsage.limit}</strong><div><i style={{ width: `${Math.min(100, aiUsage.limit ? (aiUsage.monthly / aiUsage.limit) * 100 : 0)}%` }} /></div></div><div className="profile"><span className="avatar">{currentUser.slice(0, 1)}</span><span><b>{currentUser}</b><small>{classroom?.schoolName ?? "학교 정보 확인 중"}</small></span><form action="/api/auth/logout" method="post"><button type="submit">로그아웃</button></form></div></div>
      </aside>
      <main>
        <header className="mobile-header"><button className="brand" onClick={() => setView("dashboard")}><span>기록</span>샘</button><select value={view} onChange={(e) => setView(e.target.value as View)}>{navItems.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}<option value="settings">개인정보·설정</option></select></header>
        <div className="content">
          {view === "dashboard" && <Dashboard move={setView} teacherName={currentUser} classroom={classroom} studentCount={roster.length} completedLevels={completedLevels} totalLevels={totalLevels} commentCount={generatedCommentCount} expectedComments={roster.length * new Set(plan.map((item) => item.subject)).size} behaviorCount={generatedBehaviorCount} />}
          {view === "classes" && <ClassroomManager current={classroom} />}
          {view === "students" && <StudentManager roster={roster} onAdded={mergeStudentIntoState} onChanged={mergeStudentIntoState} onDeleted={(id) => void deleteStudent(id)} onImported={mergeImportedStudents} />}
          {view === "plans" && <PlanManager plan={plan} onChanged={applyPlanChange} current={classroom} />}
          {view === "assessments" && <Assessments data={assessmentDataBySubject[activeSubject] ?? []} setData={(updater) => setAssessmentDataBySubject((current) => ({ ...current, [activeSubject]: typeof updater === "function" ? updater(current[activeSubject] ?? []) : updater }))} plan={plan} activeSubject={activeSubject} setActiveSubject={setActiveSubject} onDeleteStudent={(id) => void deleteStudent(id)} onSave={saveAssessmentLevels} />}
          {view === "comments" && <Comments assessmentDataBySubject={assessmentDataBySubject} plan={plan} roster={roster} />}
          {view === "behavior" && <Behavior roster={roster} />}
          {SHOW_EXPORT_RESULTS && view === "export" && <ExportResults roster={roster} plan={plan} />}
          {view === "settings" && <PrivacySettings currentName={currentUser} onNameChanged={setCurrentUser} />}
        </div>
      </main>
    </div>
  );
}
