import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("dashboard hides placeholder counts and completion notices until loaded", () => {
  const dashboard = source.slice(source.indexOf("function Dashboard("), source.indexOf("type ManagedClassroom"));
  assert.match(dashboard, /loadState === "loading" \? "확인 중" : "조회 실패"/);
  assert.match(dashboard, /loadState === "ready" \? card.value : statusText/);
  assert.match(dashboard, /loadState === "ready" \? card.detail/);
  assert.match(dashboard, /loadState === "ready" && pendingTasks.map/);
  assert.match(dashboard, /loadState === "ready" && !pendingTasks.length/);
  assert.match(source, /classLoadState, setClassLoadState.*\("loading"\)/);
  assert.match(source, /countsLoadState, setCountsLoadState.*\("loading"\)/);
  assert.match(source, /setClassLoadState\("error"\)/);
  assert.match(source, /if \(!cancelled\) setCountsLoadState\("error"\)/);
});

test("behavior loading and failures cannot expose editable empty results", () => {
  const behavior = source.slice(source.indexOf("function Behavior("));
  assert.match(behavior, /behaviorLoadState, setBehaviorLoadState.*useState<"loading" \| "ready" \| "error">\("loading"\)/);
  assert.match(behavior, /if \(!response.ok \|\| !Array.isArray\(result.behaviors\)\) throw/);
  assert.match(behavior, /catch \{\s*setBehaviorLoadState\("error"\)/);
  assert.match(behavior, /if \(behaviorLoadState !== "ready"\) return <section>/);
  assert.match(behavior, /onClick=\{\(\) => void loadBehaviors\(\)\}>다시 불러오기/);
  for (const name of ["openGenerationDialog", "generateAll"]) {
    const handler = behavior.slice(behavior.indexOf(`const ${name} =`));
    assert.match(handler.slice(0, 200), /if \(behaviorLoadState !== "ready"\) return;/);
  }
});

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
