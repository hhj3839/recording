export type BehaviorRepairPlan = {
  bytes: number;
  targetBytes: number;
  byteDelta: number;
  syllables: number;
  direction: "add" | "remove" | "none";
};

export function behaviorRepairPlan(bytes: number): BehaviorRepairPlan {
  const normalizedBytes = Math.max(0, Math.round(Number(bytes) || 0));
  const targetBytes = normalizedBytes < 500 ? 510 : normalizedBytes > 550 ? 540 : normalizedBytes;
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
    return `현재 ${plan.bytes}바이트로 500~550바이트 기준을 충족하므로 길이를 바꾸지 않음`;
  }
  const action = plan.direction === "add" ? "추가" : "삭제";
  const location = plan.direction === "add" ? "기존 문장에" : "기존 문장에서";
  return `현재 ${plan.bytes}바이트이므로 ${location} 한글 약 ${plan.syllables}음절(${Math.abs(plan.byteDelta)}바이트 안팎)만 ${action}하여 ${plan.targetBytes}바이트 부근으로 조정. 500~550바이트 범위에 들어오면 더 수정하지 않음`;
}
