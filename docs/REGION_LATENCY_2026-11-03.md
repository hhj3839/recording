# 함수·DB 리전 지연 진단 (2026-11-03)

운영 함수는 iad1, 운영 Supabase recording 프로젝트는 ap-southeast-2였다. Supabase 요청 로그의 호스트와 기존 운영 백업 검증 기록으로 같은 프로젝트를 확인했다. Vercel 환경 변수의 민감 값은 조회 결과에서 비어 있어 이를 근거로 쓰지 않았다.

vercel.json의 regions를 ["syd1"]로 지정해 DB와 같은 시드니 리전에 함수를 배치한다. DB 이전, 스키마 변경, 인증 캐시나 권한 검사 생략은 없다. 서버 실행 리전이 바뀌므로 모든 Node 함수에 적용되며 운영 배포 메타데이터와 인증된 조회로 확인해야 한다.

공식 근거: https://vercel.com/docs/regions 및 https://vercel.com/docs/functions/configuring-functions/region

## 호출별 대기 근거

2026-11-03 11:00:55~11:01:12 UTC의 Supabase edge_logs 집계. 모든 대상 요청의 진입 colo는 IAD였고 호스트는 운영 recording 프로젝트였다. 응답 본문·사용자·검색 조건·토큰은 조회하지 않았다.

| 경로 | 호출 수 | origin_time 평균 ms | upstream_service_time 평균 ms |
| --- | ---: | ---: | ---: |
| 인증 token | 1 | 618.0 | 297.0 |
| 인증 user | 10 | 509.3 | 4.0 |
| classrooms | 11 | 607.3 | 13.2 |
| generated_comments | 4 | 574.5 | 11.5 |
| generated_comment_parts | 2 | 689.5 | 7.5 |

upstream_service_time은 SQL 실행시간 자체가 아니다. 다만 서비스 내부 처리보다 미국 경유 대기가 훨씬 크므로 리전 왕복이 주요 후보라는 근거가 된다. 보안·성능 advisory도 조회했으며 이번에는 기존 DB 설정을 바꾸지 않는다. 스키마 인덱스 문제라고 추정해 변경하지 않는다.

## 직전 기준 표본

2026-11-03 11:04:15 UTC 완료. 동일 실험실 계정 로그인 1회, 초기 4개와 상세 평어 GET 병렬 2회, 총 11회 모두 200. API 응답 시간이며 렌더 완료 시간이 아니다.

- 로그인 2192ms.
- 대시보드 평어 1127/1546ms, 평균 1336.5ms.
- 상세 평어 1734/1523ms, 평균 1628.5ms.
- 대시보드 평어 인증 248.5/691.4ms, 학급 276.7/241.2ms, 본문 269.0/245.2ms.

기존 전체 테스트 217개 및 빌드, 권한·로그인·계측 검사 23개, 브라우저 회귀 11개 및 타입 검사를 실행했다. 배포 후 같은 스크립트로 비교하며 적은 표본을 보장된 SLA나 p95로 해석하지 않는다. 원본 표본은 로컬 .local-reports/region-before.json에 보관한다.
