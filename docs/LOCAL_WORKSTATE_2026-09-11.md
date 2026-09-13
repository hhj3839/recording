# 로컬 작업 분류 및 후속 통합 — 2026-09-11

## 보존 상태
기본 폴더 main은 e876612(PR #229), 배포 main은 790a091(PR #233)이다. 이번 정리는 변경 목록 분류와 문서 최신화이며, 코드의 강제 동기화·삭제·stash·reset은 하지 않았다.

## 배포 완료 — 다시 덮어쓰지 않을 것
- PR #230: 전체 생성 모델 Terra 라우팅, 토큰/가격 집계 관련 변경.
- PR #231~#233: fresh-only 전체 새 제작, 공동 계획 신규 선택 학급의 새 풀 연결, 실패 새 풀만 재시도.
- 배포 코드 검증 폴더: .local-reports/fresh-pool-release, 브랜치 codex/terra-fresh-shared-pools.
- 기본 폴더의 모델·생성 코드 변경은 위 배포 변경과 겹친다. 기본 폴더 전체를 그대로 push하면 최신 재제작 기능을 누락시키거나 되돌릴 수 있다.

## 미배포 사용성 개선 — 별도 통합 필요
- app/page.tsx: 선택 학생 재배정, 복사 누락 안내, 풀 경고 이동, 결과 JSON 다운로드 등.
- app/comment-reassignment-policy.ts 및 app/api/comment-jobs/route.ts: 확정본·수정 의심 결과 보호와 재배정 전 보존.
- app/api/comment-pools/exclude/route.ts, app/comment-pool-local-edit.ts: 변경 전 문장 포함 학생 영향 안내.
- app/results-download.tsx: 저장 결과 다운로드. DB 백업 또는 나이스 자동 입력 기능이 아님.
- playwright.local.config.ts, tests/ui: 로컬 모의 UI 테스트. 실제 운영 통합 검사와 구분.
- 기본 폴더 run/route.ts의 기준문장 삽입 제거와 배포판 freshOnly 분기는 범위가 다르므로 그대로 덮어쓰지 않는다.

## 비교 자료 및 사용자 파일 — 유지
- docs/POOL_MODEL_COMPARISON.md, POOL_MODEL_COMPARISON_2026-09-09.md, TERRA_MIGRATION.md와 비교 스크립트: 비교 기록/준비 자료. 실측은 비교 보고서의 표본 범위에 한정.
- site-version.tar.gz, tmp/, 평가계획 TSV: 사용자/임시 산출물로 보고 삭제나 커밋하지 않음.
- 비밀 파일은 출력·커밋하지 않음.

## 안전한 통합 순서
1. 최신 origin/main 기준의 별도 브랜치에서 사용성 개선만 가져온다.
2. page.tsx와 생성/풀 API는 파일 통째 복사하지 않고 기능 단위로 대조한다.
3. 타입·린트·빌드·자동 테스트 및 모의 UI 검사 후 별도 PR로 검토한다.
4. 기본 폴더 원본은 통합 검증과 사용자 확인 전까지 유지한다.

## 이번 검증과 한계
직전 2026-09-11 점검에서 무료 테스트 230개와 공개 운영 검사 3개가 통과했다. 이번에는 문서만 수정했다.
운영 문장 재감사는 로그인 필요로 미실행이다. 81/81·1,620문장은 직전 제작 작업의 UI 확인 기록이다.
전체 백업 생성, 유료 호출, 운영 데이터 수정, 미배포 코드 통합은 이번 정리에서 실행하지 않았다.
