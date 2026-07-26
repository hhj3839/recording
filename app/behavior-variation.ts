import { randomInt } from "node:crypto";

export type BehaviorVariation = { structure: string; opening: string; focusOrder: string };

const structures = ["강점에서 성장으로 연결", "관찰 행동에서 성향으로 연결", "학습 태도와 관계 역량 연결", "자기관리와 책임감 연결", "변화 과정 중심", "여러 강점의 종합형"];
const openings = ["구체적으로 관찰된 행동으로 시작", "꾸준히 드러나는 강점으로 시작", "참여 태도나 실천 모습으로 시작", "변화하거나 성장한 모습으로 시작"];
const focusOrders = ["대표 강점 뒤 구체적 사례", "관찰 사례 뒤 종합 특성", "두 특성을 자연스럽게 연결", "현재 강점 뒤 발전 가능성"];

function shuffled<T>(values: T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function createBehaviorVariations(count: number): BehaviorVariation[] {
  const structurePool = shuffled(structures);
  const openingPool = shuffled(openings);
  const orderPool = shuffled(focusOrders);
  return Array.from({ length: count }, (_, index) => ({
    structure: structurePool[index % structurePool.length],
    opening: openingPool[index % openingPool.length],
    focusOrder: orderPool[(index + Math.floor(index / orderPool.length)) % orderPool.length],
  }));
}
