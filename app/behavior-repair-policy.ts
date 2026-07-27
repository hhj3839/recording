export function behaviorRepairInstruction(bytes: number) {
  const target = 525;
  const byteDelta = target - bytes;
  const syllables = Math.max(1, Math.round(Math.abs(byteDelta) / 3));
  return byteDelta > 0
    ? `현재 ${bytes}바이트이므로 기존 문장에 한글 약 ${syllables}음절(${byteDelta}바이트 안팎)만 추가하여 515~535바이트로 조정`
    : `현재 ${bytes}바이트이므로 기존 문장에서 한글 약 ${syllables}음절(${Math.abs(byteDelta)}바이트 안팎)만 삭제하여 515~535바이트로 조정`;
}
