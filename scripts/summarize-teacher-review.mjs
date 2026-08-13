import { readFile } from "node:fs/promises";
import { summarizeTeacherReview } from "./teacher-review-sample-policy.mjs";

const file = process.argv[2];
if (!file) throw new Error("Usage: pnpm audit:teacher-review <review-json-file>");
const document = JSON.parse(await readFile(file, "utf8"));
const rows = document.teacherReviewSample?.rows ?? document.rows;
if (!Array.isArray(rows) || rows.length === 0) throw new Error("Teacher review rows are required");
process.stdout.write(`${JSON.stringify({
  mode: "teacher-review-summary",
  sourceRows: rows.length,
  ...summarizeTeacherReview(rows),
}, null, 2)}\n`);
