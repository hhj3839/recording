export type BehaviorRepairPlan = {
  bytes: number;
  targetBytes: number;
  byteDelta: number;
  syllables: number;
  direction: "add" | "remove" | "none";
};

export function behaviorRepairPlan(bytes: number): BehaviorRepairPlan {
  const normalizedBytes = Math.max(0, Math.round(Number(bytes) || 0));
  const targetBytes = normalizedBytes < 500 ? 515 : normalizedBytes > 550 ? 535 : normalizedBytes;
  const byteDelta = targetBytes - normalizedBytes;
  return {
    bytes: normalizedBytes,
    targetBytes,
    byteDelta,
    syllables: byteDelta === 0 ? 0 : Math.max(1, Math.round(Math.abs(byteDelta) / 3)),
    direction: byteDelta > 0 ? "add" : byteDelta < 0 ? "remove" : "none",
  };
}

export function behaviorRepairInstruction(bytes: number) {
  const plan = behaviorRepairPlan(bytes);
  if (plan.direction === "none") {
    return `현재 ${plan.bytes}바이트로 500~550바이트 기준을 충족하므로 문장 수·순서·길이와 핵심 사실을 유지하고, 다른 검수 오류가 있을 때만 같은 의미의 표현으로 최소 교체함. 모든 문장은 마침표 직전 글자가 받침 ㅁ인 ‘음/임/함/됨’ 형태인지 확인함`;
  }
  const action = plan.direction === "add" ? "추가" : "삭제";
  const location = plan.direction === "add" ? "기존 문장에" : "기존 문장에서";
  const editScope = plan.direction === "add"
    ? "이미 언급된 행동의 방법·과정만 구체화하고 새 활동·인물·성과·태도는 만들지 않음"
    : "중복 연결어·수식어만 줄이고 관찰 사실·성장 표현·문장 수는 삭제하지 않음";
  return `현재 ${plan.bytes}바이트이므로 ${location} 한글 약 ${plan.syllables}음절(${Math.abs(plan.byteDelta)}바이트 안팎)만 ${action}하여 안전 여유가 있는 ${plan.targetBytes}바이트 부근(허용 500~550바이트)으로 조정. ${editScope}. 문장 전체를 다시 쓰거나 순서를 바꾸지 말고, 수정 뒤 UTF-8 바이트를 다시 계산함. 모든 문장은 마침표 직전 글자가 받침 ㅁ인 ‘음/임/함/됨’ 형태인지 확인하고 500~550바이트 범위에 들어오면 더 수정하지 않음`;
}
