import { recordSimilarity, validateRecord } from "./record-validation.ts";

type PeerRecord = { studentId: number; content: string };

export function confirmationIssue(content: string, studentId: number, peers: PeerRecord[], behavior = false) {
  const validation = validateRecord(content, behavior);
  if (!validation.valid) {
    return {
      status: 400,
      error: behavior
        ? "검수 항목을 모두 통과한 행동특성만 확정할 수 있습니다."
        : "검수 항목을 모두 통과한 평어만 확정할 수 있습니다.",
      validation,
    };
  }
  const duplicate = peers.find((item) =>
    item.studentId !== studentId && recordSimilarity(content, item.content) >= 0.82);
  if (duplicate) {
    return {
      status: 409,
      error: behavior
        ? "다른 학생의 행동특성과 지나치게 유사하여 확정할 수 없습니다."
        : "같은 과목의 다른 학생 평어와 지나치게 유사하여 확정할 수 없습니다.",
      duplicateStudentId: duplicate.studentId,
    };
  }
  return null;
}
