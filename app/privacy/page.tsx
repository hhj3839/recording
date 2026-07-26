import Link from "next/link";

export default function PrivacyPolicyPage() {
  return <main className="legal-shell"><article className="legal-document">
    <header><Link href="/" className="legal-brand">기록샘</Link><span>시행일 2026년 7월 26일 · 베타 v1.0</span><h1>개인정보 처리방침</h1><p>기록샘은 교사의 생활기록부 초안 작성을 지원하며, 필요한 범위에서만 개인정보를 처리합니다.</p></header>
    <aside className="legal-beta-notice"><strong>베타 운영 안내</strong><p>현재 개인 비공개 베타 문서입니다. 정식 공개 전 운영 주체의 법적 명칭·주소·개인정보 보호책임자 연락처와 국외 처리 리전을 확정하여 갱신해야 합니다.</p></aside>
    <section><h2>1. 처리 목적</h2><ul><li>교사 회원가입, 이메일 인증, 로그인 및 계정 관리</li><li>학교·학년도·학급과 학생 명단 관리</li><li>평가계획·평가수준·교과 평어·행동특성의 저장, 생성, 검수 및 내보내기</li><li>서비스 보안, 오류 대응, 사용량 제한 및 부정 이용 방지</li></ul></section>
    <section><h2>2. 처리하는 개인정보</h2><div className="legal-table"><div><strong>교사 계정</strong><span>이메일, 이름, 소속 학교, 학년도, 학기, 학년, 반, 인증·접속 정보</span></div><div><strong>학생 자료</strong><span>학급 내 번호와 이름, 평가수준, 교과 평어, 관찰 사실, 행동특성</span></div><div><strong>서비스 기록</strong><span>AI 기능 종류와 사용 시각, 생성 작업 상태, 수정·확정 이력</span></div></div><p>주민등록번호, 연락처, 주소, 건강정보, 보호자 정보는 입력받지 않습니다. 교사는 민감정보나 불필요한 개인정보를 자유 입력란에 입력하지 않아야 합니다.</p></section>
    <section><h2>3. 처리 및 보유 기간</h2><ul><li>계정과 학급 자료: 회원 탈퇴 또는 교사가 직접 삭제할 때까지</li><li>비활성 학생 자료: 교사가 복귀하거나 영구 삭제할 때까지</li><li>법령상 보존 의무가 생기는 경우: 해당 법령에서 정한 기간</li></ul><p>교사는 개인정보·설정 화면에서 현재 학급 자료 또는 계정 전체 자료를 삭제할 수 있습니다.</p></section>
    <section><h2>4. 외부 서비스 이용과 국외 처리</h2><div className="legal-table"><div><strong>Supabase</strong><span>회원 인증과 데이터베이스 저장. 교사 계정 및 학급 자료를 처리합니다.</span></div><div><strong>Vercel</strong><span>웹앱 호스팅과 서버 기능 실행. 요청 과정에서 접속 정보가 처리될 수 있습니다.</span></div><div><strong>OpenAI</strong><span>교과 평어·행동특성 초안 생성 및 근거 검수. 학생 이름·번호는 보내지 않고 평가 근거, 비식별 학생 ID, 교사가 입력한 관찰 사실을 전송합니다. API 요청은 저장하지 않도록 설정합니다.</span></div><div><strong>Google Drive·Sheets</strong><span>교사가 선택하여 Google 계정을 연결할 때 학생 번호·이름·교과 평어·행동특성을 교사의 Google Drive에 새 스프레드시트로 저장합니다. 기록샘은 앱이 만든 파일을 관리하는 권한만 요청하며 연결 토큰은 짧은 기간 보안 쿠키로 처리합니다.</span></div></div><p>각 공급자의 정확한 법인명, 이전 국가·시점·방법·보유 기간 및 거부 방법은 정식 공개 전 계약과 프로젝트 리전을 확인하여 별도 고지합니다. 이 정보가 확정되기 전에는 제한된 테스트 사용자만 이용합니다.</p></section>
    <section><h2>5. 제3자 제공</h2><p>기록샘은 이용자의 개인정보를 판매하지 않으며, 법령상 근거 또는 별도 동의 없이 제3자에게 제공하지 않습니다. 위 외부 서비스는 기능 제공을 위한 처리 수탁·국외 처리 대상으로 관리합니다.</p></section>
    <section><h2>6. 정보주체의 권리</h2><p>교사는 자신의 계정 정보와 학급 자료를 조회·수정·내보내기·삭제할 수 있습니다. 학생 정보에 관한 요청은 해당 자료를 입력한 교사와 학교의 개인정보 처리 절차에 따라 처리해야 합니다. 권리 행사가 어려운 경우 아래 문의 창구로 요청할 수 있습니다.</p></section>
    <section><h2>7. 아동의 개인정보</h2><p>학생은 기록샘에 직접 가입하지 않습니다. 교사는 학교의 정당한 업무 권한과 내부 지침에 따라 학생 자료를 입력해야 합니다. 만 14세 미만 아동의 개인정보에 별도 동의가 필요한 상황에서는 법정대리인 동의 등 관계 법령과 학교 절차를 먼저 준수해야 합니다.</p></section>
    <section><h2>8. 안전성 확보 조치</h2><ul><li>Supabase Auth 기반 이메일 인증과 세션 보호</li><li>사용자·학급 식별자를 모든 주요 데이터에 연결하고 서버에서 소유권 재확인</li><li>서비스 역할 키와 OpenAI API 키를 브라우저에 노출하지 않음</li><li>AI 요청에서 학생 이름과 번호 제거</li><li>백그라운드 작업 서명, 사용량 제한, 삭제 확인 문구 및 자동 권한 테스트</li></ul></section>
    <section><h2>9. 쿠키</h2><p>로그인 세션과 현재 학급 선택을 유지하기 위해 필수 쿠키를 사용합니다. 필수 쿠키를 차단하면 로그인과 학급 관리 기능을 이용할 수 없습니다. 광고·행태 추적 쿠키는 사용하지 않습니다.</p></section>
    <section><h2>10. 문의와 책임자</h2><p>베타 문의: <a href="https://github.com/hhj3839/recording/issues">GitHub Issues</a></p><p className="legal-pending">정식 공개 전 필수 확정: 운영자 법적 명칭, 주소, 대표 연락처, 개인정보 보호책임자 이름·부서·이메일·전화번호</p></section>
    <section><h2>11. 변경 고지</h2><p>방침이 변경되면 시행일 전에 서비스 화면에 공지합니다. 개인정보 처리 목적, 외부 제공 또는 국외 이전 등 중요한 내용은 알아보기 쉽게 별도 안내합니다.</p></section>
    <footer><Link href="/terms">서비스 이용약관</Link><Link href="/login">로그인</Link></footer>
  </article></main>;
}
