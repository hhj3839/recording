import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

function runWithoutApproval(script, mode, approvalVariable) {
  const env = { ...process.env };
  delete env[approvalVariable];
  return spawnSync(process.execPath, [script, mode], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

test("blocks every paid comment load-test mode before login without explicit approval", () => {
  const cases = [
    ["sample", "RUN_COMMENT_5_TEST"],
    ["subject", "RUN_COMMENT_25_TEST"],
    ["start", "RUN_FULL_225_TEST"],
  ];
  for (const [mode, variable] of cases) {
    const result = runWithoutApproval("scripts/load-test-comments.mjs", mode, variable);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`${variable}=YES`));
    assert.doesNotMatch(result.stderr, /Lab credential|login failed/i);
  }
});

test("blocks behavior data writes and paid generation modes without explicit approval", () => {
  const cases = [
    ["seed", "SEED_BEHAVIOR_TEST_DATA"],
    ["sample", "RUN_BEHAVIOR_5_TEST"],
    ["full", "RUN_BEHAVIOR_25_TEST"],
  ];
  for (const [mode, variable] of cases) {
    const result = runWithoutApproval("scripts/load-test-behaviors.mjs", mode, variable);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`${variable}=YES`));
    assert.doesNotMatch(result.stderr, /Lab credential|login failed/i);
  }
});

test("always refreshes generated result counts without browser caching", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.equal((page.match(/fetch\("\/api\/generated-comments", \{ cache: "no-store" \}\)/g) ?? []).length, 4);
  assert.equal((page.match(/fetch\("\/api\/student-behaviors", \{ cache: "no-store" \}\)/g) ?? []).length, 4);

  for (const route of ["app/api/generated-comments/route.ts", "app/api/student-behaviors/route.ts"]) {
    assert.match(readFileSync(route, "utf8"), /"Cache-Control": "private, no-store"/);
  }
});
