import { randomInt } from "node:crypto";

export type CommentVariation = { structure: string; opening: string; focusOrder: string };

const structures = ["수행 결과 중심", "근거의 행동 순서 중심", "대상과 행동 연결", "방법과 결과 연결", "핵심 행동의 어순 변환", "목적어와 서술어 연결"];
const openings = [
  "평가 근거에 적힌 핵심 행동으로 바로 시작",
  "수행 대상과 근거에 적힌 행동을 함께 제시하며 시작",
  "평가 근거에 적힌 수행 결과를 먼저 제시하며 시작",
  "영역의 핵심 개념과 근거에 적힌 행동으로 시작",
  "근거의 목적어나 핵심 개념을 먼저 제시하며 시작",
  "근거에 적힌 방법과 결과를 자연스럽게 연결하며 시작",
  "성취기준의 핵심 동작을 다른 어순으로 바꾸어 시작",
  "수준 기준의 핵심 내용을 구체적인 행동으로 바꾸어 시작",
];
const focusOrders = ["수행 대상 뒤 근거의 행동", "근거의 행동 뒤 수행 대상", "방법 뒤 근거의 결과", "근거의 결과 뒤 수행 방법"];

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
