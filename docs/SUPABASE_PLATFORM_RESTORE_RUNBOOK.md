# Supabase 전체 플랫폼 복원 리허설

## 2026-09-15 최신 암호화 논리 백업 완료

- 아래 실측·복원 결과는 당시 기록이며 최신 운영 백업의 완전성을 뜻하지 않음.
- 공용 문장 교정·삭제 후 운영 DB에서 새 논리 백업을 생성함. 파일명은 `recording-backup-20260915T133431Z.7z`, 크기는 2,384,001바이트임. 백업 시작 시각은 2026-09-15 22:34:31 KST임.
- 사용자 실행 결과 BACKUP_OK와 실제 파일을 확인함. SHA-256 독립 재계산 값은 `4fb2f92dbb590f38be050b7af380dbda5ce8b6d3503575d03eb769b5d7f5bf4c`로 일치하며 별도 해시 파일도 존재함.
- 기존 스크립트는 pg_dump 완료, pg_restore 목록 읽기, 헤더 암호화된 7z 생성 및 무결성 검사를 통과해야 BACKUP_OK를 출력함. 해당 실행의 임시 평문 파일은 스크립트에서 정리함. 이전 실패 시도의 잔여 파일 정리 여부는 별도 확인 사항임.
- 최신 덤프를 실제 복원하거나 문장 1,620개 및 연결 관계를 덤프 내용과 대조하지는 않음. 파일 무결성 확인을 전체 플랫폼 복원 성공으로 보고하지 않음.
- 실행 전 기존 로컬 비밀 저장소와 백업 절차를 확인하고 인증 정보 원문을 로그·Git·문서에 남기지 않음.
- 생성 후 암호화 파일의 무결성과 덤프 목록을 확인하고, 공용 승인 문장 1,620개 및 변경 후 연결 상태를 백업 시점과 함께 대조함. 복원 검증은 운영이 아닌 임시 환경에서만 수행함.
- Auth·프로젝트 설정·Storage 실제 파일은 논리 덤프와 구분하여 현재 상태를 별도 확인함. 아래 과거 Storage 0개 수치를 현재 값으로 재사용하지 않음.
- 교사 표본 확인은 공용 교정본에서 호응 교정·수량 복원·수행 범위 복원 사례를 골라 자연스러움과 수준 의미를 판정함. 표본 결과를 전수 품질 통과율로 확대하지 않음.

**점검일:** 2026-08-26

**범위:** Database, Auth, Storage, 프로젝트 설정

**원칙:** 운영 프로젝트에는 복원·삭제·설정 변경을 수행하지 않음

## 현재 운영 실측

- Auth 사용자: 2명
- `public`: 18개 테이블, 18개 모두 RLS 활성
- `auth`: 23개 테이블
- `storage`: 8개 테이블, 버킷 0개, 객체 0개
- `public`, `auth`, `storage`의 명시적 RLS 정책: 0개
- 확장: `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`

현재 Storage는 비어 있으므로 이번 시점의 파일 백업 대상은 없음. 다만 향후 버킷이 생기면 데이터베이스 백업에는 객체 메타데이터만 포함되고 실제 파일은 포함되지 않으므로 별도 객체 다운로드가 반드시 필요함.

## 공식 복원 범위

Supabase의 데이터베이스 복원은 Auth 사용자와 암호 해시를 포함한 `auth` 스키마를 옮길 수 있음. 새 프로젝트의 JWT 비밀값이 다르면 기존 로그인 토큰은 무효화되므로 사용자는 다시 로그인해야 함. Storage 실제 파일과 버킷 설정, Auth 설정, API 키, Realtime 설정, Edge Functions는 데이터베이스 복원만으로 복제되지 않음.

- [Database backups](https://supabase.com/docs/guides/platform/backups)
- [Backup and restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
- [Migrating Auth users](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)
- [Download Storage objects](https://supabase.com/docs/guides/storage/management/download-objects)

## 리허설 전 준비

1. 운영 프로젝트와 다른 이름의 임시 Supabase 프로젝트를 생성함.
2. 임시 프로젝트의 리전과 PostgreSQL 주 버전을 운영과 맞춤.
3. 운영·임시 프로젝트의 Session pooler 연결 문자열을 각각 준비함.
4. 연결 비밀번호와 서비스 키는 환경 변수 또는 비밀 저장소에만 넣고 명령 기록·로그·문서에 남기지 않음.
5. 현재 코드와 `supabase/*.sql`, 환경 변수 이름 목록을 별도 보관함.
6. Storage 버킷이 1개 이상이면 실제 객체를 별도 암호화 백업함.

## 안전한 실행 순서

1. 운영 프로젝트에서 `roles.sql`, `schema.sql`, `data.sql`을 논리 덤프함.
2. Auth와 Storage 구조 차이는 `supabase db diff --linked --schema auth,storage`로 검토함.
3. 덤프를 즉시 AES-256과 헤더 암호화가 적용된 보관 파일로 묶고 원문 접근권한을 제한함.
4. 임시 프로젝트에 역할, 스키마, 데이터를 순서대로 복원함.
5. 운영 환경 변수나 Vercel 연결을 임시 프로젝트로 바꾸지 않음. 별도 로컬 검증 환경만 연결함.
6. Storage 객체가 있으면 임시 프로젝트의 대응 버킷을 만들고 객체를 복사함.
7. Auth URL, 이메일 인증, 비밀번호 정책, OAuth 공급자, Realtime, 확장, Cron을 별도로 재설정함.
8. 임시 환경에서 아래 합격 기준을 검증함.
9. 리허설 종료 후 임시 프로젝트 삭제는 데이터 보존 여부와 감사 자료를 확인한 뒤 별도 승인으로 수행함.

## 합격 기준

- Auth 사용자 수가 운영과 일치함.
- 기존 교사 1명이 임시 URL에서 로그인하고 새 토큰을 발급받을 수 있음.
- 비밀번호 재설정 이메일 흐름이 동작함.
- `public` 18개 테이블의 구조·행 수·제약조건·인덱스가 일치함.
- 학생, 평가계획, 평가수준, 교과 평어, 행동특성이 동일 학급에 연결됨.
- 교사 A가 교사 B의 학급 ID로 조회·수정·삭제할 수 없음.
- Storage 버킷·객체 수·총 바이트·표본 체크섬이 일치함. 현재 기준 기대값은 모두 0임.
- 공개 버킷이 의도하지 않게 생성되지 않음.
- Cron과 백그라운드 생성 작업이 운영 프로젝트를 호출하지 않음.
- Vercel 운영 환경 변수는 변경되지 않음.

## 현재 판정

2026-08-26 Free 임시 프로젝트 `recording-restore-rehearsal-20260826`에서 전체 플랫폼 복원 리허설을 실행함. 2026-08-11 custom 덤프의 `public` 데이터와 Auth 사용자·아이덴티티를 복원하고 현재 코드의 `0021`~`0023` 마이그레이션을 적용함. Auth 2명, `public` 21개 테이블 전체 RLS 활성, Storage 버킷·객체 0개를 확인했으며 운영과 같은 Site URL·Redirect URL 및 기본 Email Auth 설정을 수동 복제함.

임시 프로젝트에만 연결한 로컬 앱에서 실험실 계정 로그인이 200으로 성공했고 학생 25명, 평가수준 625건, 평가계획 25행을 정상 로딩함. 운영 Supabase와 Vercel 환경변수는 변경하지 않았음. 따라서 **현재 백업으로 Database·Auth·빈 Storage 상태·핵심 Auth 설정을 복구하고 앱을 기동할 수 있음**을 확인함.

다만 다음 제한을 함께 기록함.

- 덤프 시점 이후 추가된 문장 풀 테이블은 현재 마이그레이션으로 구조만 생성되어 데이터가 0건임. 이번 결과는 2026-08-11 백업 시점 복구 가능성이지 최신 운영 데이터 완전성 증명이 아님.
- `public` 명시적 RLS 정책은 원본과 복원본 모두 0개이며 앱 서버의 서비스 키와 서버측 소유권 조건에 의존함.
- Auth 사용자와 연결되지 않은 빈 학급 1건이 백업에 존재함. 학생·평가·평어·행동특성 자식 데이터는 없으며 삭제하지 않고 백업 무결성 결함으로 보존함.
- 비밀번호 재설정 이메일, OAuth, Cron·Realtime, 사용자 간 직접 접근 차단의 전체 E2E는 이번 리허설에서 실행하지 않았음.
- 사용자 승인 후 임시 복원 프로젝트를 영구 삭제하고 일시정지했던 `class` 프로젝트를 재개함. 임시 서버 키와 DB 비밀번호 로컬 파일도 삭제했으며 실험실 계정 파일은 보존함.
