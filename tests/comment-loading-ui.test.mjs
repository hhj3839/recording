import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("saved comments must load before generation targets are selectable", () => {
  assert.match(source, /useState<"loading" \| "ready" \| "error">\("loading"\)/);
  for (const name of ["openSubjectGenerationDialog", "generateSubjectComments"]) {
    const handler = source.slice(source.indexOf(`const ${name} =`));
    assert.match(handler.slice(0, 200), /if \(!commentsReady\) return;/);
  }
  assert.match(source, /disabled=\{!commentsReady \|\| loading \|\| !eligibleCount\}/);
  assert.match(source, /commentsReady && generationDialogOpen/);
});

test("loading and failures are not displayed as empty saved results", () => {
  assert.match(source, /role="status">\{commentsReady \?/);
  assert.match(source, /commentsReady && <div className="comments-table-wrap">/);
  assert.match(source, /setCommentsLoadState\("ready"\)/);
  assert.match(source, /catch \{\s*setCommentsLoadState\("error"\)/);
  assert.match(source, /onClick=\{\(\) => void loadGeneratedComments\(\)\}>다시 불러오기/);
});
