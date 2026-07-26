import { randomInt } from "node:crypto";

export type CommentVariation = { structure: string; opening: string; focusOrder: string };

const structures = ["성취 결과 중심", "학습 과정 중심", "적용과 활용 중심", "성장과 향상 중심", "두 평가영역 연결형", "핵심 역량 종합형"];
const openings = ["활동이나 수행 과정으로 시작", "이해하거나 갖춘 능력으로 시작", "달성한 결과로 시작", "활용하거나 적용한 모습으로 시작"];
const focusOrders = ["구체적 근거 뒤 종합 강점", "종합 강점 뒤 구체적 근거", "서로 다른 두 근거를 대등하게 연결", "핵심 근거를 먼저 쓰고 성장 가능성으로 마무리"];

function shuffled<T>(values: T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function createCommentVariations(count: number): CommentVariation[] {
  const structurePool = shuffled(structures);
  const openingPool = shuffled(openings);
  const orderPool = shuffled(focusOrders);
  return Array.from({ length: count }, (_, index) => ({
    structure: structurePool[index % structurePool.length],
    opening: openingPool[index % openingPool.length],
    focusOrder: orderPool[(index + Math.floor(index / orderPool.length)) % orderPool.length],
  }));
}
