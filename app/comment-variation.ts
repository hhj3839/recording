import { randomInt } from "node:crypto";

export type CommentVariation = { structure: string; opening: string; focusOrder: string };

const structures = ["성취 결과 중심", "학습 과정 중심", "적용과 활용 중심", "성장과 향상 중심", "두 평가영역 연결형", "핵심 역량 종합형"];
const openings = [
  "평가 근거에 적힌 핵심 행동으로 바로 시작",
  "수행 대상과 근거에 적힌 행동을 함께 제시하며 시작",
  "평가 근거에 적힌 수행 결과를 먼저 제시하며 시작",
  "영역의 핵심 개념과 근거에 적힌 행동으로 시작",
  "평가 활동의 대상과 수행 내용을 근거 표현 안에서 시작",
  "근거에 적힌 방법과 결과를 자연스럽게 연결하며 시작",
  "성취기준의 핵심 동작을 다른 어순으로 바꾸어 시작",
  "수준 기준의 핵심 내용을 구체적인 행동으로 바꾸어 시작",
];
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
