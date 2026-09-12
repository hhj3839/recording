export type BehaviorRepairPlan = {
  bytes: number;
  targetBytes: number;
  byteDelta: number;
  syllables: number;
  direction: "add" | "remove" | "none";
};

export function behaviorRepairTargets(bytes: number): [number, number] {
  const normalizedBytes = Math.max(0, Math.round(Number(bytes) || 0));
  if (normalizedBytes < 500) return [515, 540];
  if (normalizedBytes > 600) return [585, 560];
  return [normalizedBytes, normalizedBytes];
}

export function behaviorRepairPlan(bytes: number): BehaviorRepairPlan {
  const normalizedBytes = Math.max(0, Math.round(Number(bytes) || 0));
  const targetBytes = normalizedBytes < 500 ? 530 : normalizedBytes > 600 ? 570 : normalizedBytes;
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
  const targets = behaviorRepairTargets(bytes);
  if (plan.direction === "none") {
    return `현재 ${plan.bytes}바이트로 500~600바이트 기준을 충족하므로 문장 수·순서·길이와 핵심 사실을 유지하고, 다른 검수 오류가 있을 때만 같은 의미의 표현으로 최소 교체함. 문장 호응과 자연스러운 명사형 서술어의 완결성을 확인하고 명사만 남은 종결이나 의미가 겹치는 추상적 표현을 관찰 사실을 유지하며 다듬음`;
  }
  const editScope = plan.direction === "add"
    ? "입력에 명시된 관찰 사실 중 빠진 내용만 보완하고, 근거가 부족하면 짧더라도 기존 문장을 유지함"
    : "중복 연결어·수식어만 줄이고 관찰 사실·성장 표현·문장 수는 삭제하지 않음";
  return `현재 ${plan.bytes}바이트이며 후보별 참고 목표는 ${targets[0]}·${targets[1]}바이트임. ${editScope}. 길이를 맞추기 위해 추상적인 성장 표현이나 같은 의미를 덧붙이지 않음. 기존 사실과 순서를 유지하며 필요한 부분만 수정하고 문장 호응과 자연스러운 명사형 서술어의 완결성을 확인함. 500~600바이트 범위에 들어오면 길이를 더 수정하지 않음`;
}
