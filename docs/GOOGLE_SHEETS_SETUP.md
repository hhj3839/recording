# Google Sheets 연동 설정

## 1. Google Cloud 설정

1. Google Cloud Console에서 프로젝트를 생성하거나 선택한다.
2. **Google Sheets API**와 **Google Drive API**를 사용 설정한다.
3. Google Auth Platform의 브랜딩·대상 사용자를 설정한다.
4. OAuth 클라이언트에서 **웹 애플리케이션**을 만든다.
5. 승인된 리디렉션 URI에 다음 주소를 등록한다.
   - 운영: `https://giroksam-recording.vercel.app/api/google/callback`
   - 로컬: `http://localhost:3000/api/google/callback`

## 2. Vercel 환경변수

다음 값을 Production, Preview, Development 환경에 각각 등록한다.

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://giroksam-recording.vercel.app/api/google/callback
```

클라이언트 보안 비밀은 GitHub나 브라우저 코드에 넣지 않는다.

## 3. 권한 범위

- `openid`, `email`: 연결한 Google 계정 표시
- `drive.file`: 기록샘이 만든 Drive 파일만 관리
- `spreadsheets`: 새 스프레드시트 생성·값 입력·서식 적용

전체 Drive 조회 권한은 요청하지 않는다. 연결 토큰은 JavaScript에서 읽을 수 없는 보안 쿠키에 저장하며, 만료되면 교사가 다시 연결한다.

## 4. 생성 결과

- 작성현황
- 교과평어 통합
- 과목별 개별 시트
- 행동특성

미확정 결과도 누락 없이 저장하되 각 행의 상태 열에 `확정`, `미확정`, `미작성`을 표시한다.
