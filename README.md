# 기록샘

교사가 과정중심평가 결과와 학생 관찰 사실을 바탕으로 교과 평어 및 행동특성 초안을 작성하고 검토할 수 있는 생활기록부 작성 지원 웹앱입니다.

## 웹앱 바로가기

**[기록샘 공개 웹앱 실행하기](https://giroksam-recording.hhj3839.chatgpt.site/)**

## 현재 구현 범위

- 학급 진행 현황 대시보드
- DB 평가계획 기반 과목별 상·중·하 평가 수준 입력
- OpenAI API를 활용한 전 과목 교과 평어 일괄 생성
- 나이스 붙여넣기용 학생별 평어 표와 평어만 복사하기
- 바이트, 종결어미, 금지 내용 검수 표시
- 단일 관찰 사실 기반 행동특성 AI 초안 생성
- 학생 추가·삭제
- PC, 태블릿, 모바일 반응형 UI

현재 버전은 PRD의 1차 개발 흐름을 검증하는 공개 MVP입니다. 평가계획은 DB에 저장되며 AI 문장 생성 시 학생 이름을 외부 API에 전송하지 않습니다.

## 실행

Node.js 22.13 이상과 pnpm 11 이상이 필요합니다.

```bash
pnpm install
pnpm dev
```

검증:

```bash
pnpm build
node --test tests/rendered-html.test.mjs
```

## 주요 파일

- `app/page.tsx`: 화면 및 상호작용
- `app/globals.css`: 반응형 디자인
- `docs/PRD.md`: 제품 요구사항
- `.openai/hosting.json`: Sites 배포 설정
