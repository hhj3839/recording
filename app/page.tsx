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
  { id: "assessments", label: "평가 수준 입력", icon: "▦" },
  { id: "comments", label: "교과 평어", icon: "✦" },
  { id: "behavior", label: "행동특성", icon: "◎" },
];

function Dashboard({ move }: { move: (view: View) => void }) {
  const cards = [
    { label: "학생", value: "25명", detail: "재적 학생", tone: "blue" },
    { label: "평가 입력", value: "82%", detail: "108 / 132개", tone: "mint" },
    { label: "교과 평어 확정", value: "61%", detail: "67 / 110건", tone: "amber" },
    { label: "행동특성 확정", value: "40%", detail: "10 / 25명", tone: "violet" },
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
  const save = async () => {
    setSaving(true);
    try {
      await onSave();
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section>
      <div className="page-heading">
        <div><p className="eyebrow">{activeSubject} · 1학기</p><h1>평가 수준 입력</h1><p>셀을 눌러 학생별 성취 수준을 빠르게 입력하세요.</p></div>
        <div className="heading-actions"><button className="secondary" onClick={onAddStudent}>＋ 학생 추가</button><button onClick={() => void save()} disabled={saving}>{saving ? "저장 중…" : saved ? "저장됨 ✓" : "변경사항 저장"}</button></div>
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
  useEffect(() => {
    const loadGeneratedComments = async () => {
      try {
        const response = await fetch("/api/generated-comments");
        const result = await response.json() as { comments?: Array<{ studentId: number; subject: string; comment: string; updatedAt: string }> };
        if (!response.ok || !result.comments?.length) return;
        setComments(Object.fromEntries(result.comments.map((item) => [`${item.studentId}|${item.subject}`, item.comment])));
        const latest = result.comments.map((item) => item.updatedAt).sort().at(-1);
        if (latest) {
          setLastGeneratedAt(latest);
          window.localStorage.setItem("giroksam:last-generated-at", latest);
        }
      } catch {
        // 저장된 결과를 불러오지 못해도 새 생성은 계속 사용할 수 있음.
      }
    };
    void loadGeneratedComments();
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
  const saveComment = async (studentId: number, subject: string, comment: string) => {
    try {
      const response = await fetch("/api/generated-comments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, subject, comment }),
      });
      if (!response.ok) throw new Error();
    } catch {
      setError("수정한 평어를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
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
                  <td><textarea value={text} onChange={(event) => { setComments((current) => ({ ...current, [key]: event.target.value })); setCopied(false); }} onBlur={(event) => void saveComment(student.id, selectedSubject, event.target.value)} placeholder={hasLevel ? "AI 평어 생성 버튼을 누르면 결과가 표시됩니다." : "평가 수준이 입력되지 않았습니다."} /></td>
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
  const [records, setRecords] = useState<Record<number, { characteristic: string; behavior: string }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [lastGeneratedAt, setLastGeneratedAt] = useState("");
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(behaviorReferences[0].category);
  const [activeStudentId, setActiveStudentId] = useState<number | null>(roster[0]?.id ?? null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/student-behaviors");
        const result = await response.json() as { behaviors?: Array<{ studentId: number; characteristic: string; behavior: string; updatedAt: string }> };
        if (!response.ok || !result.behaviors) return;
        setRecords(Object.fromEntries(result.behaviors.map((item) => [item.studentId, { characteristic: item.characteristic, behavior: item.behavior }])));
        setLastGeneratedAt(result.behaviors.map((item) => item.updatedAt).sort().at(-1) ?? "");
      } catch {
        setError("저장된 행동특성을 불러오지 못했습니다.");
      }
    };
    void load();
  }, []);

  const updateRecord = (studentId: number, patch: Partial<{ characteristic: string; behavior: string }>) => {
    setRecords((current) => ({ ...current, [studentId]: { characteristic: "", behavior: "", ...current[studentId], ...patch } }));
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
        ...Object.fromEntries(result.behaviors!.map((item) => [item.studentId, { characteristic: item.characteristic, behavior: item.behavior }])),
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
  const saveRecord = async (studentId: number, record: { characteristic: string; behavior: string }) => {
    try {
      const response = await fetch("/api/student-behaviors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, ...record }),
      });
      if (!response.ok) throw new Error();
    } catch {
      setError("수정한 행동특성 내용을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };
  const formattedLastGeneratedAt = lastGeneratedAt
    ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(lastGeneratedAt))
    : "";

  return (
    <section>
      <div className="page-heading">
        <div><p className="eyebrow">GROWTH NOTE</p><h1>행동특성 작성</h1><p>학생별 특성을 입력하고 한 번에 행동특성을 생성하세요.</p></div>
        <div className="ai-generate-actions">{formattedLastGeneratedAt && <span>마지막 사용 {formattedLastGeneratedAt}</span>}<button onClick={() => void generateAll()} disabled={loading}>{loading ? "전체 생성 중…" : "✦ AI 행특 생성"}</button></div>
      </div>
      <div className="review-content behavior-table-content">
        <div className="behavior-table-toolbar"><span>특성 입력 {roster.filter((student) => records[student.id]?.characteristic.trim()).length} / {roster.length}명</span><div><button className="reference-open-button" onClick={() => setReferenceOpen((current) => !current)}>{referenceOpen ? "참고자료 닫기" : "참고자료 열기"}</button><button className="copy-comments" onClick={() => void copyBehaviors()} disabled={!roster.some((student) => records[student.id]?.behavior)}>{copied ? "복사됨 ✓" : "행동특성만 복사하기"}</button></div></div>
        {error && <p className="generation-error">! {error}</p>}
        {loading && <div className="comment-loading class-loading"><span>✦</span><p>입력된 모든 학생의 행동특성을 생성하고 있어요.</p></div>}
        <div className={`behavior-work-area ${referenceOpen ? "with-reference" : ""}`}>
          <div className="comments-table-wrap">
            <table className="comments-table behavior-table">
              <thead><tr><th>번호</th><th>이름</th><th>특성</th><th>행동특성</th></tr></thead>
              <tbody>{roster.map((student) => {
                const record = records[student.id] ?? { characteristic: "", behavior: "" };
                return <tr className={activeStudentId === student.id ? "active-reference-row" : ""} key={student.id}><td>{student.id}</td><td><strong>{student.name}</strong></td><td><textarea value={record.characteristic} onFocus={() => setActiveStudentId(student.id)} onChange={(event) => updateRecord(student.id, { characteristic: event.target.value })} onBlur={() => void saveRecord(student.id, records[student.id] ?? record)} placeholder="관찰한 행동과 변화 모습을 입력하세요." /></td><td><textarea value={record.behavior} onChange={(event) => updateRecord(student.id, { behavior: event.target.value })} onBlur={() => void saveRecord(student.id, records[student.id] ?? record)} placeholder={record.characteristic ? "AI 행특 생성 버튼을 누르면 결과가 표시됩니다." : "특성을 먼저 입력해 주세요."} /><small>{record.behavior ? `${new TextEncoder().encode(record.behavior).length} bytes` : ""}</small></td></tr>;
              })}</tbody>
            </table>
          </div>
          {referenceOpen && <aside className="behavior-reference-drawer">
            <button className="drawer-close" onClick={() => setReferenceOpen(false)} aria-label="참고자료 닫기">×</button>
            <div className="reference-guide"><div><strong>작성 참고자료</strong><p>실제로 관찰한 행동과 변화에 맞는 표현만 선택해 주세요.</p></div><span>현재 입력 대상: {activeStudentId ? `${roster.find((student) => student.id === activeStudentId)?.id}번 ${roster.find((student) => student.id === activeStudentId)?.name}` : "특성 입력칸을 선택하세요"}</span></div>
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

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [roster, setRoster] = useState<AssessmentStudent[]>(students.map((student) => withSampleLevels(student, 0, defaultPlan.length)));
  const [assessmentDataBySubject, setAssessmentDataBySubject] = useState<Record<string, AssessmentStudent[]>>({
    국어: students.map((student) => withSampleLevels(student, 0, defaultPlan.length)),
  });
  const [plan, setPlan] = useState<AssessmentPlan[]>(defaultPlan);
  const [activeSubject, setActiveSubject] = useState("국어");
  useEffect(() => {
    const loadClassData = async () => {
      try {
        const [planResponse, classResponse] = await Promise.all([fetch("/api/assessment-plan"), fetch("/api/class-data")]);
        const planResult = await planResponse.json() as { plan?: AssessmentPlan[] };
        const classResult = await classResponse.json() as {
          students?: Array<{ id: number; number: number; name: string }>;
          levels?: Array<{ studentId: number; subject: string; assessmentIndex: number; level: Level }>;
        };
        if (!planResponse.ok || !planResult.plan?.length) return;
        const loadedPlan = planResult.plan;
        const loadedRoster: AssessmentStudent[] = classResponse.ok && classResult.students?.length
          ? classResult.students.map((student) => ({ id: student.id, name: student.name, assessments: [], status: "미생성", note: "" }))
          : students.map((student) => withSampleLevels(student, 0, defaultPlan.length));
        const savedLevels = new Map((classResult.levels ?? []).map((item) => [`${item.studentId}|${item.subject}|${item.assessmentIndex}`, item.level]));
        setPlan(loadedPlan);
        setRoster(loadedRoster);
        const firstSubject = loadedPlan[0].subject;
        setActiveSubject(firstSubject);
        const subjects = [...new Set(loadedPlan.map((item) => item.subject))];
        setAssessmentDataBySubject(Object.fromEntries(subjects.map((subject, subjectIndex) => {
          const subjectCount = loadedPlan.filter((item) => item.subject === subject).length;
          return [subject, loadedRoster.map((student) => ({
            ...student,
            assessments: Array.from({ length: subjectCount }, (_, assessmentIndex) =>
              savedLevels.get(`${student.id}|${subject}|${assessmentIndex}`) ?? seededLevel(student.id, subjectIndex, assessmentIndex)),
          }))];
        })));
      } catch {
        // 배포 초기화 중에는 내장 기본 평가계획을 유지함.
      }
    };
    void loadClassData();
  }, []);
  const addStudent = async () => {
    const name = window.prompt("추가할 학생 이름을 입력해 주세요.");
    if (!name?.trim()) return;
    const number = roster.length ? Math.max(...roster.map((student) => student.id)) + 1 : 1;
    const response = await fetch("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), number }),
    });
    const result = await response.json() as { student?: { id: number; name: string }; error?: string };
    if (!response.ok || !result.student) return window.alert(result.error || "학생을 추가하지 못했습니다.");
    const newStudent: AssessmentStudent = { id: result.student.id, name: result.student.name, assessments: [], status: "미생성", note: "" };
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
          {view === "assessments" && <Assessments data={assessmentDataBySubject[activeSubject] ?? []} setData={(updater) => setAssessmentDataBySubject((current) => ({ ...current, [activeSubject]: typeof updater === "function" ? updater(current[activeSubject] ?? []) : updater }))} plan={plan} activeSubject={activeSubject} setActiveSubject={setActiveSubject} onAddStudent={() => void addStudent()} onDeleteStudent={(id) => void deleteStudent(id)} onSave={saveAssessmentLevels} />}
          {view === "comments" && <Comments assessmentDataBySubject={assessmentDataBySubject} plan={plan} roster={roster} />}
          {view === "behavior" && <Behavior roster={roster} />}
        </div>
      </main>
    </div>
  );
}
