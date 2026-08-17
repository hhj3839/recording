import { randomInt } from "node:crypto";

export type CommentVariation = {
  structure: string;
  opening: string;
  focusOrder: string;
  verbStrategy: string;
  endingStyle: string;
  syntaxPattern: string;
};

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
const verbStrategies = [
  "평가기준의 첫 동사를 그대로 시작에 쓰지 말고 문장 중간에 자연스럽게 배치",
  "평가기준의 핵심 수행 동사를 문장 끝의 명사형 서술어로 배치",
  "평가기준에 있는 두 수행을 연결하되 뒤 수행을 핵심 서술어로 배치",
  "수행 대상과 결과를 먼저 제시하고 근거에 있는 동작을 뒤에서 설명",
  "근거의 핵심 동작을 의미가 같은 자연스러운 학교생활기록부 표현으로 전환",
];
const endingStyles = [
  "근거의 핵심 동작을 살린 자연스러운 ~함. 종결",
  "능력이나 수행 정도가 근거에 있을 때만 ~뛰어남. 종결",
  "태도가 근거에 있을 때만 ~돋보임. 종결, 없으면 수행 동사의 ~함. 종결",
  "성장이나 변화가 근거에 있을 때만 ~인상적임. 종결, 없으면 수행 동사의 ~함. 종결",
  "상태·이해가 근거에 적합하면 ~임.·~음. 종결, 아니면 수행 동사의 ~함. 종결",
];
const syntaxPatterns = [
  "수행 대상을 먼저 쓰고 핵심 행동과 결과를 이어 쓰기",
  "근거에 있는 수행 결과를 먼저 쓰고 그 방법이나 대상을 뒤에 연결하기",
  "근거에 있는 방법이나 조건을 먼저 쓰고 핵심 수행으로 끝내기",
  "핵심 개념을 먼저 쓰고 관찰 가능한 행동을 뒤에 배치하기",
  "핵심 수행 동사로 시작하고 그 대상과 범위를 뒤에 설명하기",
  "두 수행 요소가 있으면 첫 수행을 원인·방법으로, 둘째 수행을 결과로 연결하기",
  "두 수행 요소가 있으면 둘째 수행을 먼저 드러낸 뒤 첫 수행을 근거로 연결하기",
  "수행 대상과 조건을 먼저 묶고 마지막에 핵심 행동을 명사형으로 제시하기",
  "근거의 목적을 먼저 드러내고 그 목적에 맞는 수행 행동으로 끝내기",
  "평가기준의 핵심어는 보존하되 조사·어순·절 연결 방식을 바꾸어 쓰기",
];

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
  const verbPool = shuffled(verbStrategies);
  const endingPool = shuffled(endingStyles);
  const syntaxPool = shuffled(syntaxPatterns);
  return Array.from({ length: count }, (_, index) => ({
    structure: structurePool[index % structurePool.length],
    opening: openingPool[index % openingPool.length],
    focusOrder: orderPool[(index + Math.floor(index / orderPool.length)) % orderPool.length],
    verbStrategy: verbPool[(index + Math.floor(index / verbPool.length)) % verbPool.length],
    endingStyle: endingPool[(index * 2 + Math.floor(index / endingPool.length)) % endingPool.length],
    syntaxPattern: syntaxPool[index % syntaxPool.length],
  }));
}
