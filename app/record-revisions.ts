import { eq, insertRows, selectRows } from "../db/supabase";

type RevisionScope = { ownerId: string; ownerEmail: string; classId: number; studentId: number; source: string };

export async function archiveComment(scope: RevisionScope & { subject: string; nextContent: string }) {
  const current = (await selectRows<{ comment: string; confirmed: boolean }>("generated_comments", {
    owner_id: eq(scope.ownerId), class_id: eq(scope.classId), student_id: eq(scope.studentId), subject: eq(scope.subject), limit: 1,
  }))[0];
  if (!current?.comment || current.comment === scope.nextContent) return;
  await insertRows("record_revisions", [{
    owner_id: scope.ownerId, owner_email: scope.ownerEmail, class_id: scope.classId,
    record_type: "comment", student_id: scope.studentId, subject: scope.subject,
    content: current.comment, characteristic: "", confirmed: Boolean(current.confirmed),
    source: scope.source, created_at: new Date().toISOString(),
  }]);
}

export async function archiveBehavior(scope: RevisionScope & { nextContent: string; nextCharacteristic: string }) {
  const current = (await selectRows<{ behavior: string; characteristic: string; confirmed: boolean }>("student_behaviors", {
    owner_id: eq(scope.ownerId), class_id: eq(scope.classId), student_id: eq(scope.studentId), limit: 1,
  }))[0];
  if (!current?.behavior || (current.behavior === scope.nextContent && current.characteristic === scope.nextCharacteristic)) return;
  await insertRows("record_revisions", [{
    owner_id: scope.ownerId, owner_email: scope.ownerEmail, class_id: scope.classId,
    record_type: "behavior", student_id: scope.studentId, subject: "",
    content: current.behavior, characteristic: current.characteristic, confirmed: Boolean(current.confirmed),
    source: scope.source, created_at: new Date().toISOString(),
  }]);
}
