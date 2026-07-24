"use client";

import { useEffect, useState } from "react";

type View = "dashboard" | "assessments" | "comments" | "behavior";
type Level = "상" | "중" | "하" | "-";
type AssessmentPlan = {
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

const defaultPlan: AssessmentPlan[] = [
  { subject: "국어", unit: "1단원", goal: "상황과 인물의 마음을 살려 표현하기", domain: "듣기·말하기", type: "수행평가", perspective: "표정, 몸짓, 목소리 활용", high: "실감 나게 표현함", middle: "알맞게 표현함", low: "도움을 받아 표현함", caution: "" },
  { subject: "국어", unit: "2단원", goal: "문장의 기본 짜임을 이해하기", domain: "문법", type: "서술형", perspective: "문장 짜임 이해", high: "정확히 나타냄", middle: "대체로 나타냄", low: "도움을 받아 나타냄", caution: "" },
  { subject: "국어", unit: "3단원", goal: "작품의 느낌과 생각 표현하기", domain: "문학", type: "서술형", perspective: "근거를 들어 표현", high: "구체적으로 표현함", middle: "알맞게 표현함", low: "도움을 받아 표현함", caution: "" },
];

const students = [
  { id: 1, name: "김도윤", assessments: ["상", "중", "상"] as Level[], status: "확정", note: "친구의 발표를 경청하고 자신의 생각을 또렷하게 표현함" },
  { id: 2, name: "이서아", assessments: ["중", "중", "상"] as Level[], status: "검토 중", note: "모둠 활동에서 역할을 끝까지 책임감 있게 수행함" },
  { id: 3, name: "박지후", assessments: ["하", "중", "-"] as Level[], status: "미생성", note: "교사의 도움을 받아 활동 과정을 차근차근 완성함" },
  { id: 4, name: "최하린", assessments: ["상", "상", "중"] as Level[], status: "확정", note: "상황에 알맞은 목소리와 표정으로 실감 나게 발표함" },
  { id: 5, name: "정시우", assessments: ["중", "상", "중"] as Level[], status: "검토 중", note: "새로운 문제에도 여러 방법을 시도하며 해결함" },
];

const navItems: { id: View; label: string; icon: string }[] = [
  { id: "dashboard", label: "대시보드", icon: "⌂" },
  { id: "assessments", label: "평가 수준 입력", icon: "▦" },
  { id: "comments", label: "교과 평어", icon: "✦" },
  { id: "behavior", label: "행동특성", icon: "◎" },
];

function Dashboard({ move }: { move: (view: View) => void }) {
  const cards = [
    { label: "학생", value: "22명", detail: "재적 학생", tone: "blue" },
    { label: "평가 입력", value: "82%", detail: "108 / 132개", tone: "mint" },
    { label: "교과 평어 확정", value: "61%", detail: "67 / 110건", tone: "amber" },
    { label: "행동특성 확정", value: "45%", detail: "10 / 22명", tone: "violet" },
  ];
  const tasks = [
    { title: "국어 평가 수준 입력", detail: "5명이 아직 입력되지 않았어요", action: "이어하기", view: "assessments" as View, progress: 78 },
    { title: "수학 교과 평어 검토", detail: "생성된 문장 8건을 확인해 주세요", action: "검토하기", view: "comments" as View, progress: 64 },
    { title: "행동특성 관찰 기록", detail: "12명의 기록을 더 입력해 주세요", action: "기록하기", view: "behavior" as View, progress: 45 },
  ];

  return (
    <>
      <section className="welcome">
        <div>
          <p className="eyebrow">2026학년도 · 1학기</p>
          <h1>홍현진 선생님, 안녕하세요.</h1>
          <p>오늘도 학생의 성장을 세심하게 기록해 볼까요?</p>
        </div>
        <button className="class-button">서울하늘초 · 3학년 5반 <span>⌄</span></button>
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
        <button>보호 원칙 보기</button>
      </section>
    </>
  );
}

type AssessmentStudent = (typeof students)[number] & { assessments: Level[] };

function Assessments({ data, setData, plan, activeSubject, setActiveSubject, onAddStudent, onDeleteStudent }: {
  data: AssessmentStudent[];
  setData: React.Dispatch<React.SetStateAction<AssessmentStudent[]>>;
  plan: AssessmentPlan[];
  activeSubject: string;
  setActiveSubject: (subject: string) => void;
  onAddStudent: () => void;
  onDeleteStudent: (id: number) => void;
}) {
  const [saved, setSaved] = useState(false);
  const subjects = [...new Set(plan.map((item) => item.subject))];
  const visiblePlan = plan.filter((item) => item.subject === activeSubject);

  const changeSubject = (subject: string) => {
    setActiveSubject(subject);
    setSaved(false);
  };
  const cycle = (row: number, col: number) => {
    const order: Level[] = ["-", "상", "중", "하"];
    setData((current) => current.map((student, r) => r !== row ? student : {
      ...student,
      assessments: student.assessments.map((level, c) => c !== col ? level : order[(order.indexOf(level) + 1) % order.length]),
    }));
    setSaved(false);
  };
  return (
    <section>
      <div className="page-heading">
        <div><p className="eyebrow">{activeSubject} · 1학기</p><h1>평가 수준 입력</h1><p>셀을 눌러 학생별 성취 수준을 빠르게 입력하세요.</p></div>
        <div className="heading-actions"><button className="secondary" onClick={onAddStudent}>＋ 학생 추가</button><button onClick={() => setSaved(true)}>{saved ? "저장됨 ✓" : "변경사항 저장"}</button></div>
      </div>
      <div className="table-tools">
        <div className="subject-tabs">{subjects.map((subject) => <button className={subject === activeSubject ? "active" : ""} onClick={() => changeSubject(subject)} key={subject}>{subject}</button>)}</div>
        <span><i className="level high" /> 상 <i className="level middle" /> 중 <i className="level low" /> 하</span>
      </div>
      <div className="assessment-wrap">
        <table className="assessment-table">
          <thead><tr><th>번호</th><th>학생</th>{visiblePlan.map((item, index) => <th key={`${item.unit}-${item.domain}-${index}`} title={item.goal}><b>{item.unit}</b><small>{item.domain}</small></th>)}<th>관리</th></tr></thead>
          <tbody>{data.map((student, row) => <tr key={student.id}><td>{student.id}</td><td><strong>{student.name}</strong></td>{student.assessments.map((level, col) => <td key={col}><button aria-label={`${student.name} ${col + 1}단원 수준 ${level}`} className={`level-button level-${level}`} onClick={() => cycle(row, col)}>{level}</button></td>)}<td><button className="delete-student" onClick={() => onDeleteStudent(student.id)} aria-label={`${student.name} 삭제`}>삭제</button></td></tr>)}</tbody>
        </table>
      </div>
      <div className="bottom-action"><span>입력 완료 <strong>{data.reduce((count, student) => count + student.assessments.filter((level) => level !== "-").length, 0)} / {data.length * visiblePlan.length}</strong></span></div>
    </section>
  );
}

function Comments({ assessmentDataBySubject, plan, roster }: { assessmentDataBySubject: Record<string, AssessmentStudent[]>; plan: AssessmentPlan[]; roster: AssessmentStudent[] }) {
  const subjects = [...new Set(plan.map((item) => item.subject))];
  const [selectedSubject, setSelectedSubject] = useState(subjects[0] ?? "국어");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [lastGeneratedAt, setLastGeneratedAt] = useState("");
  useEffect(() => {
    setLastGeneratedAt(window.localStorage.getItem("giroksam:last-generated-at") ?? "");
  }, []);
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
    try {
      const scores = Object.fromEntries(Object.entries(assessmentDataBySubject).map(([subject, data]) => [
        subject,
        data.map((student) => ({ studentId: student.id, levels: student.assessments })),
      ]));
      const response = await fetch("/api/generate-all-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scores }),
      });
      const result = await response.json() as { comments?: Array<{ studentId: number; subject: string; comment: string }>; error?: string };
      if (!response.ok || !result.comments?.length) throw new Error(result.error || "전 과목 교과 평어를 생성하지 못했습니다.");
      setComments((current) => ({
        ...current,
        ...Object.fromEntries(result.comments!.map((item) => [`${item.studentId}|${item.subject}`, item.comment])),
      }));
      const generatedAt = new Date().toISOString();
      setLastGeneratedAt(generatedAt);
      window.localStorage.setItem("giroksam:last-generated-at", generatedAt);
      setCopied(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "전 과목 교과 평어를 생성하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section>
      <div className="page-heading"><div><p className="eyebrow">AI DRAFT</p><h1>전 과목 교과 평어</h1><p>과목을 선택하면 해당 과목의 학생별 평어를 한 화면에서 확인할 수 있습니다.</p></div><div className="ai-generate-actions">{formattedLastGeneratedAt && <span>마지막 사용 {formattedLastGeneratedAt}</span>}<button onClick={() => void generateAllComments()} disabled={loading}>{loading ? "전 과목 생성 중…" : "✦ AI 평어 생성"}</button></div></div>
      <div className="review-layout comments-review-layout">
        <div className="review-content">
          <div className="comments-toolbar">
            <div className="subject-tabs review-subject-tabs">{subjects.map((subject) => <button className={subject === selectedSubject ? "active" : ""} onClick={() => { setSelectedSubject(subject); setCopied(false); }} key={subject}>{subject}<small>{roster.filter((student) => comments[`${student.id}|${subject}`]).length}/{roster.length}</small></button>)}</div>
            <button className="copy-comments" onClick={() => void copySubjectComments()} disabled={!roster.some((student) => comments[`${student.id}|${selectedSubject}`])}>{copied ? "복사됨 ✓" : "평어만 복사하기"}</button>
          </div>
          {error && <p className="generation-error">! {error}</p>}
          {loading && <div className="comment-loading class-loading"><span>✦</span><p>모든 학생의 전 과목 평어를 생성하고 있어요.</p></div>}
          <div className="comments-table-wrap">
            <table className="comments-table">
              <thead><tr><th>번호</th><th>이름</th><th>평어</th></tr></thead>
              <tbody>{roster.map((student, index) => {
                const key = `${student.id}|${selectedSubject}`;
                const text = comments[key] ?? "";
                const assessment = assessmentDataBySubject[selectedSubject]?.[index];
                const hasLevel = assessment?.assessments.some((level) => level !== "-");
                return <tr id={`comment-${student.id}`} key={student.id}>
                  <td>{student.id}</td>
                  <td><strong>{student.name}</strong><small>{text ? `${new TextEncoder().encode(text).length}B` : hasLevel ? "생성 대기" : "수준 미입력"}</small></td>
                  <td><textarea value={text} onChange={(event) => { setComments((current) => ({ ...current, [key]: event.target.value })); setCopied(false); }} placeholder={hasLevel ? "AI 평어 생성 버튼을 누르면 결과가 표시됩니다." : "평가 수준이 입력되지 않았습니다."} /></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function Behavior() {
  const [selected, setSelected] = useState(0);
  const [records, setRecords] = useState(() => students.map((student, index) => ({
    observation: index === 0 ? "수업에 성실하게 참여하고 궁금한 점을 질문으로 해결하며, 친구의 이야기를 잘 듣고 맡은 역할을 끝까지 수행함. 최근에는 모둠 앞에서 자신의 생각을 자신 있게 말함." : "",
    generated: "",
    loading: false,
    error: "",
  })));
  const record = records[selected];
  const person = students[selected];
  const updateRecord = (patch: Partial<(typeof records)[number]>) => setRecords((current) => current.map((item, index) => index === selected ? { ...item, ...patch } : item));
  const generate = async () => {
    if (!record.observation.trim()) return updateRecord({ error: "관찰 사실을 먼저 입력해 주세요." });
    updateRecord({ loading: true, error: "" });
    try {
      const response = await fetch("/api/generate-behavior", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observation: record.observation }),
      });
      const result = await response.json() as { behavior?: string; error?: string };
      if (!response.ok || !result.behavior) throw new Error(result.error || "행동특성을 생성하지 못했습니다.");
      updateRecord({ generated: result.behavior, loading: false });
    } catch (reason) {
      updateRecord({ loading: false, error: reason instanceof Error ? reason.message : "행동특성을 생성하지 못했습니다." });
    }
  };
  const bytes = new TextEncoder().encode(record.generated).length;
  const move = (direction: number) => setSelected((current) => (current + direction + students.length) % students.length);
  return (
    <section>
      <div className="page-heading">
        <div><p className="eyebrow">GROWTH NOTE</p><h1>행동특성 작성</h1><p>관찰 사실 하나를 입력하면 AI가 행동특성 초안을 바로 작성합니다.</p></div>
      </div>
      <div className="behavior-workspace">
        <aside className="student-list behavior-students">
          <div className="student-list-head"><strong>3학년 5반</strong><span>{records.filter((item) => item.generated).length} / {students.length} 작성</span></div>
          <div className="behavior-student-scroll">
            {students.map((student, index) => {
              const status = records[index].generated ? "작성됨" : records[index].observation ? "관찰 입력" : "미작성";
              return <button className={selected === index ? "active" : ""} onClick={() => setSelected(index)} key={student.id}><span className="avatar">{student.name[0]}</span><span><b>{student.id}. {student.name}</b><small className={`behavior-status status-${status}`}>{status}{records[index].generated && ` · ${new TextEncoder().encode(records[index].generated).length}B`}</small></span><i>›</i></button>;
            })}
          </div>
          <div className="student-nav"><button onClick={() => move(-1)}>← 이전</button><button onClick={() => move(1)}>다음 →</button></div>
        </aside>
        <div className="behavior-detail">
          <div className="behavior-detail-head">
            <div><span className="avatar large">{person.name[0]}</span><div><h2>{person.name}</h2><p>{person.id}번 · 행동특성 및 발달상황</p></div></div>
            <span className={`status ${record.generated ? "done" : ""}`}>{record.generated ? "초안 생성됨" : "관찰 입력 중"}</span>
          </div>
          <div className="behavior-grid">
            <div className="panel behavior-form single-observation"><div className="section-heading"><div><h2>관찰 사실 입력</h2><p>실제로 관찰한 행동과 변화 모습을 한 칸에 적어 주세요.</p></div></div>
              <label><span>관찰 사실</span><textarea value={record.observation} onChange={(e) => updateRecord({ observation: e.target.value, error: "" })} placeholder="예: 수업에 성실히 참여하고 모둠 활동에서 친구의 의견을 경청하며 맡은 역할을 끝까지 수행함." /></label>
              {record.error && <p className="generation-error">! {record.error}</p>}
              <button className="generate-button" onClick={() => void generate()} disabled={record.loading}>{record.loading ? "AI 작성 중…" : "✦ 행동특성 바로 생성"}</button>
            </div>
            <div className="panel result-panel"><div className="section-heading"><div><h2>생성 결과</h2><p>입력한 관찰 사실만 바탕으로 작성됩니다.</p></div>{record.generated && <button className="regenerate" onClick={() => void generate()}>↻ 다시 생성</button>}</div>
              {record.loading ? <div className="empty-result"><span>✦</span><h3>행동특성을 작성하고 있어요</h3></div> : record.generated ? <><textarea value={record.generated} onChange={(e) => updateRecord({ generated: e.target.value })} /><div className="check-list"><p className={bytes >= 500 ? "safe" : "warn"}><span>{bytes >= 500 ? "✓" : "!"}</span> UTF-8 {bytes} bytes <small>권장 500~550</small></p><p className="safe"><span>✓</span> 학생 이름 미전송</p><p className="safe"><span>✓</span> 입력 근거 중심 생성</p></div></> : <div className="empty-result"><span>✦</span><h3>관찰 사실을 바탕으로 초안을 만들어요</h3><p>왼쪽 관찰 사실을 입력하고 생성 버튼을 눌러 주세요.</p></div>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [roster, setRoster] = useState<AssessmentStudent[]>(students.map((student) => ({ ...student, assessments: [...student.assessments] })));
  const [assessmentDataBySubject, setAssessmentDataBySubject] = useState<Record<string, AssessmentStudent[]>>({
    국어: students.map((student) => ({ ...student, assessments: [...student.assessments] })),
  });
  const [plan, setPlan] = useState<AssessmentPlan[]>(defaultPlan);
  const [activeSubject, setActiveSubject] = useState("국어");
  useEffect(() => {
    const loadPlan = async () => {
      try {
        const response = await fetch("/api/assessment-plan");
        const result = await response.json() as { plan?: AssessmentPlan[] };
        if (!response.ok || !result.plan?.length) return;
        setPlan(result.plan);
        const firstSubject = result.plan[0].subject;
        const count = result.plan.filter((item) => item.subject === firstSubject).length;
        setActiveSubject(firstSubject);
        const subjects = [...new Set(result.plan.map((item) => item.subject))];
        setAssessmentDataBySubject((current) => Object.fromEntries(subjects.map((subject) => {
          const subjectCount = result.plan!.filter((item) => item.subject === subject).length;
          const existing = current[subject];
          return [subject, roster.map((student, index) => ({
            ...student,
            assessments: Array.from({ length: subjectCount }, (_, levelIndex) => existing?.[index]?.assessments[levelIndex] ?? student.assessments[levelIndex % student.assessments.length] ?? "중") as Level[],
          }))];
        })));
      } catch {
        // 배포 초기화 중에는 내장 기본 평가계획을 유지함.
      }
    };
    void loadPlan();
  }, []);
  const addStudent = () => {
    const name = window.prompt("추가할 학생 이름을 입력해 주세요.");
    if (!name?.trim()) return;
    const id = roster.length ? Math.max(...roster.map((student) => student.id)) + 1 : 1;
    const newStudent: AssessmentStudent = { id, name: name.trim(), assessments: [], status: "미생성", note: "" };
    setRoster((current) => [...current, newStudent]);
    setAssessmentDataBySubject((current) => Object.fromEntries(Object.entries(current).map(([subject, data]) => [
      subject,
      [...data, { ...newStudent, assessments: Array(plan.filter((item) => item.subject === subject).length).fill("-") as Level[] }],
    ])));
  };
  const deleteStudent = (id: number) => {
    const student = roster.find((item) => item.id === id);
    if (!student || !window.confirm(`${student.name} 학생을 삭제할까요?`)) return;
    setRoster((current) => current.filter((item) => item.id !== id));
    setAssessmentDataBySubject((current) => Object.fromEntries(Object.entries(current).map(([subject, data]) => [subject, data.filter((item) => item.id !== id)])));
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("dashboard")}><span>기록</span>샘<i>교사의 기록을 더 가치 있게</i></button>
        <nav>{navItems.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
        <div className="nav-divider" />
        <nav><button><span>♙</span>학생 관리</button><button><span>⇧</span>결과 내보내기</button></nav>
        <div className="sidebar-bottom"><div className="storage"><span>이번 달 AI 생성</span><strong>128 / 300</strong><div><i /></div></div><button className="profile"><span className="avatar">홍</span><span><b>홍현진 선생님</b><small>서울하늘초등학교</small></span><i>⋯</i></button></div>
      </aside>
      <main>
        <header className="mobile-header"><button className="brand" onClick={() => setView("dashboard")}><span>기록</span>샘</button><select value={view} onChange={(e) => setView(e.target.value as View)}>{navItems.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></header>
        <div className="content">
          {view === "dashboard" && <Dashboard move={setView} />}
          {view === "assessments" && <Assessments data={assessmentDataBySubject[activeSubject] ?? []} setData={(updater) => setAssessmentDataBySubject((current) => ({ ...current, [activeSubject]: typeof updater === "function" ? updater(current[activeSubject] ?? []) : updater }))} plan={plan} activeSubject={activeSubject} setActiveSubject={setActiveSubject} onAddStudent={addStudent} onDeleteStudent={deleteStudent} />}
          {view === "comments" && <Comments assessmentDataBySubject={assessmentDataBySubject} plan={plan} roster={roster} />}
          {view === "behavior" && <Behavior />}
        </div>
      </main>
    </div>
  );
}
