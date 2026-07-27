import { randomInt } from "node:crypto";

export type CommentVariation = { structure: string; opening: string; focusOrder: string };

const structures = ["성취 결과 중심", "학습 과정 중심", "적용과 활용 중심", "성장과 향상 중심", "두 평가영역 연결형", "핵심 역량 종합형"];
const openings = [
  "수업·평가에서 수행한 구체적인 활동 장면으로 시작",
  "평가 요소를 이해하고 갖춘 능력으로 시작",
  "과제를 수행해 달성한 결과로 시작",
  "배운 내용을 새로운 자료나 상황에 적용한 모습으로 시작",
  "자료를 관찰·탐색·분석한 과정으로 시작",
  "여러 방법을 비교·판단하여 선택한 행동으로 시작",
  "원리나 방법을 자신의 말로 설명한 행동으로 시작",
  "주어진 내용을 표현·구성·재구성한 행동으로 시작",
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
