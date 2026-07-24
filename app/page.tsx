"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

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
          <button onClick={() => move("assessments")}><span className="quick-icon">⇧</span><span><b>평가계획 업로드</b><small>엑셀 파일로 시작하기</small></span><i>›</i></button>
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

function Assessments({ data, setData, plan, setPlan, activeSubject, setActiveSubject, goComments }: {
  data: AssessmentStudent[];
  setData: React.Dispatch<React.SetStateAction<AssessmentStudent[]>>;
  plan: AssessmentPlan[];
  setPlan: React.Dispatch<React.SetStateAction<AssessmentPlan[]>>;
  activeSubject: string;
  setActiveSubject: (subject: string) => void;
  goComments: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const subjects = [...new Set(plan.map((item) => item.subject))];
  const visiblePlan = plan.filter((item) => item.subject === activeSubject);

  const uploadPlan = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadMessage("");
    setUploadError("");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const required = ["과목", "단원", "평가목표", "영역", "평가 유형", "평가 관점", "상", "중", "하"];
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const missing = required.filter((header) => !headers.includes(header));
      if (!rows.length) throw new Error("첫 번째 시트에 평가 항목이 없습니다.");
      if (missing.length) throw new Error(`필수 열이 없습니다: ${missing.join(", ")}`);
      const parsed = rows.map((row, index) => {
        const value = (header: string) => String(row[header] ?? "").trim();
        if (!value("과목") || !value("단원") || !value("평가목표") || !value("영역") || !value("상") || !value("중") || !value("하")) {
          throw new Error(`${index + 2}행의 필수 내용이 비어 있습니다.`);
        }
        return {
          subject: value("과목"), unit: value("단원"), goal: value("평가목표"), domain: value("영역"),
          type: value("평가 유형"), perspective: value("평가 관점"), high: value("상"),
          middle: value("중"), low: value("하"), caution: value("평가상의 유의점"),
        };
      });
      const firstSubject = parsed[0].subject;
      const firstCount = parsed.filter((item) => item.subject === firstSubject).length;
      setPlan(parsed);
      setActiveSubject(firstSubject);
      setData((current) => current.map((student) => ({ ...student, assessments: Array(firstCount).fill("-") as Level[] })));
      setUploadMessage(`${file.name} · ${parsed.length}개 평가 항목을 불러왔습니다.`);
      setSaved(false);
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "파일을 읽지 못했습니다.");
    }
  };

  const changeSubject = (subject: string) => {
    setActiveSubject(subject);
    const count = plan.filter((item) => item.subject === subject).length;
    setData((current) => current.map((student) => ({
      ...student,
      assessments: Array.from({ length: count }, (_, index) => student.assessments[index] ?? "-"),
    })));
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
        <div className="heading-actions">
          <input ref={fileInput} className="visually-hidden" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void uploadPlan(event)} />
          <button className="secondary" onClick={() => fileInput.current?.click()}>평가계획 업로드</button>
          <button onClick={() => setSaved(true)}>{saved ? "저장됨 ✓" : "변경사항 저장"}</button>
        </div>
      </div>
      {uploadMessage && <p className="upload-message">✓ {uploadMessage}</p>}
      {uploadError && <p className="generation-error">! {uploadError}</p>}
      <div className="table-tools">
        <div className="subject-tabs">{subjects.map((subject) => <button className={subject === activeSubject ? "active" : ""} onClick={() => changeSubject(subject)} key={subject}>{subject}</button>)}</div>
        <span><i className="level high" /> 상 <i className="level middle" /> 중 <i className="level low" /> 하</span>
      </div>
      <div className="assessment-wrap">
        <table className="assessment-table">
          <thead><tr><th>번호</th><th>학생</th>{visiblePlan.map((item, index) => <th key={`${item.unit}-${item.domain}-${index}`} title={item.goal}><b>{item.unit}</b><small>{item.domain}</small></th>)}</tr></thead>
          <tbody>{data.map((student, row) => <tr key={student.id}><td>{student.id}</td><td><strong>{student.name}</strong></td>{student.assessments.map((level, col) => <td key={col}><button aria-label={`${student.name} ${col + 1}단원 수준 ${level}`} className={`level-button level-${level}`} onClick={() => cycle(row, col)}>{level}</button></td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="bottom-action"><span>입력 완료 <strong>{data.reduce((count, student) => count + student.assessments.filter((level) => level !== "-").length, 0)} / {data.length * visiblePlan.length}</strong></span><button onClick={goComments}>교과 평어 작성 <b>→</b></button></div>
    </section>
  );
}

function Comments({ assessmentData, plan, activeSubject, generateSignal }: { assessmentData: AssessmentStudent[]; plan: AssessmentPlan[]; activeSubject: string; generateSignal: number }) {
  const [selected, setSelected] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [comments, setComments] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const text = comments[selected] ?? "";
  const setText = (value: string) => setComments((current) => ({ ...current, [selected]: value }));
  const bytes = useMemo(() => new TextEncoder().encode(text).length, [text]);
  const person = students[selected];
  const selectedAssessment = assessmentData[selected];
  const generateComment = async () => {
    setLoading(true);
    setError("");
    setConfirmed(false);
    try {
      const response = await fetch("/api/generate-comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selectedAssessment.id, levels: selectedAssessment.assessments, plan: plan.filter((item) => item.subject === activeSubject) }),
      });
      const result = await response.json() as { comment?: string; error?: string };
      if (!response.ok || !result.comment) throw new Error(result.error || "교과 평어를 생성하지 못했습니다.");
      setText(result.comment);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "교과 평어를 생성하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (generateSignal > 0) void generateComment();
    // 평가 수준 입력 화면에서 교과 평어 작성 버튼을 누를 때만 자동 실행함.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generateSignal]);

  return (
    <section>
      <div className="page-heading"><div><p className="eyebrow">AI DRAFT</p><h1>교과 평어 검토</h1><p>입력한 평가 수준을 바탕으로 AI가 작성한 문장을 검토해 주세요.</p></div><button className="secondary">학급 전체 생성</button></div>
      <div className="review-layout">
        <aside className="student-list">
          <div className="student-list-head"><strong>3학년 5반</strong><span>5명</span></div>
          {students.map((student, index) => <button className={selected === index ? "active" : ""} onClick={() => { setSelected(index); setConfirmed(false); setError(""); }} key={student.id}><span className="avatar">{student.name[0]}</span><span><b>{student.id}. {student.name}</b><small>{comments[index] ? "검토 중" : "미생성"}</small></span><i>›</i></button>)}
        </aside>
        <div className="review-content">
          <div className="review-head"><div><span className="avatar large">{person.name[0]}</span><div><h2>{person.name}</h2><p>{activeSubject} · 교과학습발달상황</p></div></div><span className={`status ${confirmed ? "done" : ""}`}>{confirmed ? "최종 확정" : "검토 필요"}</span></div>
          <div className="evidence">
            <h3>평가 수준</h3><div className="evidence-grid">{plan.filter((item) => item.subject === activeSubject).map((item, index) => <p key={`${item.unit}-${item.domain}-${index}`}><span>{item.domain}</span><b className={`tag ${selectedAssessment.assessments[index] === "상" ? "high" : "middle"}`}>{selectedAssessment.assessments[index] ?? "-"}</b></p>)}</div>
          </div>
          <div className="editor-card">
            <div className="editor-title"><div><span className="spark">✦</span><strong>AI 생성 초안</strong><small>학생 이름을 제외한 평가 수준만 전송해요</small></div><button onClick={() => void generateComment()} disabled={loading}>{loading ? "생성 중…" : "↻ 다시 생성"}</button></div>
            {loading ? <div className="comment-loading"><span>✦</span><p>평가 수준을 분석해 교과 평어를 작성하고 있어요.</p></div> : <textarea value={text} onChange={(e) => { setText(e.target.value); setConfirmed(false); }} placeholder="AI 생성 버튼을 누르면 교과 평어가 표시됩니다." />}
            <div className="editor-meta"><span>{bytes} bytes</span>{text && <><span className="safe">✓ 종결어미 정상</span><span className="safe">✓ 학생 이름 미전송</span></>}</div>
          </div>
          {error && <p className="generation-error">! {error}</p>}
          <div className="suggestions"><button disabled={!text} onClick={() => setText(text.slice(0, Math.max(65, text.length - 18)) + "함.")}>짧게</button><button disabled={!text} onClick={() => void generateComment()}>다른 표현으로 생성</button></div>
          <div className="confirm-box"><label><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> 입력한 평가 수준에 맞는 문장인지 확인했습니다.</label><button disabled={!confirmed}>{confirmed ? "확정 완료 ✓" : "최종 확정"}</button></div>
        </div>
      </div>
    </section>
  );
}

function Behavior() {
  const fields = ["학습 태도", "교우관계", "책임감", "생활 습관", "성장 모습"];
  const defaults = ["수업에 성실하게 참여하며 궁금한 점을 질문으로 해결함", "친구의 이야기를 잘 듣고 의견 차이를 대화로 해결함", "맡은 역할을 끝까지 수행하고 결과를 점검함", "준비물을 스스로 확인하는 습관이 형성됨", "최근 모둠 앞에서 자신의 생각을 자신 있게 말함"];
  const [selected, setSelected] = useState(0);
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [records, setRecords] = useState(() => students.map((student, index) => ({
    values: index === 0 ? defaults : [
      `${student.name} 학생은 수업 활동에 꾸준히 참여하며 스스로 해결 방법을 찾음`,
      "친구의 의견을 경청하고 모둠의 결정을 존중함",
      "맡은 역할의 순서를 확인하며 끝까지 수행함",
      "학습 준비와 정리 시간을 스스로 관리함",
      index % 2 ? "최근 발표에서 자신의 생각을 이전보다 또렷하게 설명함" : "어려운 과제에도 차분히 다시 시도하는 모습이 늘어남",
    ],
    generated: index < 2 ? `${student.name} 학생은 수업 활동에 꾸준히 참여하며 궁금한 내용을 질문으로 해결하려는 태도가 돋보임. 친구의 의견을 경청하고 모둠의 결정을 존중하며 맡은 역할을 끝까지 책임 있게 수행함. 학습 준비와 정리 시간을 스스로 관리하며 최근에는 발표에서 자신의 생각을 이전보다 또렷하게 설명하는 성장 모습을 보임.` : "",
    confirmed: index === 0,
  })));
  const record = records[selected];
  const person = students[selected];
  const visibleStudents = students.map((student, index) => ({ student, index })).filter(({ index }) => !onlyEmpty || !records[index].generated);
  const updateRecord = (patch: Partial<(typeof records)[number]>) => setRecords((current) => current.map((item, index) => index === selected ? { ...item, ...patch, confirmed: patch.confirmed ?? false } : item));
  const generate = () => updateRecord({ generated: `${record.values[0]}. ${record.values[1]}. ${record.values[2]}. ${record.values[3]}. 특히 ${record.values[4].replace("함", "하는 성장 모습이 돋보임")}.` });
  const bytes = new TextEncoder().encode(record.generated).length;
  const move = (direction: number) => setSelected((current) => (current + direction + students.length) % students.length);
  return (
    <section>
      <div className="page-heading">
        <div><p className="eyebrow">GROWTH NOTE</p><h1>행동특성 작성</h1><p>학생을 선택하고 관찰 사실부터 최종 확정까지 한 화면에서 진행하세요.</p></div>
        <div className="behavior-top-actions"><span>✓ 자동 저장됨</span><button className="secondary">작성된 학생 일괄 생성</button></div>
      </div>
      <div className="behavior-workspace">
        <aside className="student-list behavior-students">
          <div className="student-list-head"><strong>3학년 5반</strong><span>{records.filter((item) => item.confirmed).length} / {students.length} 확정</span></div>
          <label className="empty-filter"><input type="checkbox" checked={onlyEmpty} onChange={(event) => setOnlyEmpty(event.target.checked)} /> 미작성만 보기</label>
          <div className="behavior-student-scroll">
            {visibleStudents.map(({ student, index }) => {
              const status = records[index].confirmed ? "확정" : records[index].generated ? "검토 필요" : "미작성";
              return <button className={selected === index ? "active" : ""} onClick={() => setSelected(index)} key={student.id}><span className="avatar">{student.name[0]}</span><span><b>{student.id}. {student.name}</b><small className={`behavior-status status-${status}`}>{status}{records[index].generated && ` · ${new TextEncoder().encode(records[index].generated).length}B`}</small></span><i>›</i></button>;
            })}
            {visibleStudents.length === 0 && <p className="all-written">모든 학생의 초안이 작성되었어요.</p>}
          </div>
          <div className="student-nav"><button onClick={() => move(-1)}>← 이전</button><button onClick={() => move(1)}>다음 →</button></div>
        </aside>
        <div className="behavior-detail">
          <div className="behavior-detail-head">
            <div><span className="avatar large">{person.name[0]}</span><div><h2>{person.name}</h2><p>{person.id}번 · 행동특성 및 발달상황</p></div></div>
            <span className={`status ${record.confirmed ? "done" : ""}`}>{record.confirmed ? "최종 확정" : record.generated ? "검토 필요" : "관찰 입력 중"}</span>
          </div>
          <div className="behavior-grid">
            <div className="panel behavior-form"><div className="section-heading"><div><h2>관찰 사실 입력</h2><p>구체적인 행동과 변화 모습을 적어 주세요.</p></div><span>{record.values.filter(Boolean).length} / 5 입력</span></div>
              {fields.map((field, index) => <label key={field}><span>{field}{index === 4 && <b>중요</b>}</span><textarea value={record.values[index]} onChange={(e) => updateRecord({ values: record.values.map((value, itemIndex) => itemIndex === index ? e.target.value : value) })} /></label>)}
              <button className="generate-button" onClick={generate}>✦ 행동특성 초안 생성</button>
            </div>
            <div className="panel result-panel"><div className="section-heading"><div><h2>생성 결과</h2><p>선생님의 최종 검토가 필요합니다.</p></div>{record.generated && <button className="regenerate" onClick={generate}>↻ 다시 생성</button>}</div>
              {record.generated ? <><textarea value={record.generated} onChange={(e) => updateRecord({ generated: e.target.value })} /><div className="check-list"><p className={bytes >= 500 ? "safe" : "warn"}><span>{bytes >= 500 ? "✓" : "!"}</span> UTF-8 {bytes} bytes <small>권장 500~550</small></p><p className="safe"><span>✓</span> 종결어미 검사 정상</p><p className="safe"><span>✓</span> 금지 내용 없음</p><p className="safe"><span>✓</span> 입력 근거 외 표현 없음</p></div><label className="behavior-confirm-check"><input type="checkbox" checked={record.confirmed} onChange={(e) => updateRecord({ confirmed: e.target.checked })} /> 관찰 사실에 맞는 문장인지 확인했습니다.</label><button className="confirm-result" disabled={!record.confirmed}>{record.confirmed ? "확정 완료 ✓" : "확인 후 최종 확정"}</button></> : <div className="empty-result"><span>✦</span><h3>관찰 사실을 바탕으로 초안을 만들어요</h3><p>왼쪽 내용을 확인한 뒤 생성 버튼을 눌러 주세요.</p></div>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [assessmentData, setAssessmentData] = useState<AssessmentStudent[]>(students.map((student) => ({ ...student, assessments: [...student.assessments] })));
  const [generateSignal, setGenerateSignal] = useState(0);
  const [plan, setPlan] = useState<AssessmentPlan[]>(defaultPlan);
  const [activeSubject, setActiveSubject] = useState("국어");
  const openGeneratedComments = () => {
    setGenerateSignal((current) => current + 1);
    setView("comments");
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
          {view === "assessments" && <Assessments data={assessmentData} setData={setAssessmentData} plan={plan} setPlan={setPlan} activeSubject={activeSubject} setActiveSubject={setActiveSubject} goComments={openGeneratedComments} />}
          {view === "comments" && <Comments assessmentData={assessmentData} plan={plan} activeSubject={activeSubject} generateSignal={generateSignal} />}
          {view === "behavior" && <Behavior />}
        </div>
      </main>
    </div>
  );
}
