import { assembleRotatedComment } from "./comment-assembly.ts";

// Missing provenance is protected too: never assume an old/manual record is safe to overwrite.
export function protectCommentFromReassignment(comment: string, confirmed: boolean, parts: Array<{ assessmentIndex: number; sentence: string }>, studentId: number) {
  if (!comment.trim()) return false;
  if (confirmed || !parts.length) return true;
  return comment !== assembleRotatedComment(parts.map((part) => ({ assessmentIndex: part.assessmentIndex, text: part.sentence })), studentId);
}
