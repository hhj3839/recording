# 기록샘 UI 기준

- 화면의 이모지 사용 금지. 버튼·라벨·상태 안내는 간결한 명사형 사용.
- 불필요한 개발 설명 제거. 비용, 삭제 범위, 복구 가능 여부, 개인정보 안내는 유지.
- Pretendard v1.3.9 CDN 사용. 로딩 실패 시 시스템 한글 글꼴 사용.
- 기본 `word-break: keep-all`, 숫자 `font-variant-numeric: tabular-nums` 적용.
- 버튼·탭 `white-space: nowrap`, 컨트롤에만 `user-select: none` 적용.
- 평어·행동특성 본문과 입력칸은 선택·복사 허용.
- 브라우저 기본 alert/confirm/prompt 대신 공통 ActionDialogProvider 사용.
- 키보드 `:focus-visible`, 모달 Escape 취소, 포커스 복원 유지.
- 흰색·연회색 바탕과 파란색 단일 강조색 사용. 경고·오류·성공은 의미에 따른 색상 허용.
- 장식 그라데이션과 불필요한 장식 제거. 좁은 화면에서 버튼 묶음은 줄 단위 재배치.
- 평가 문장, 생성 프롬프트, 법률 문서는 UI 문구 일괄 치환 대상에서 제외.
