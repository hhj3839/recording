import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// A process deadline is essential: node:test timeout cannot interrupt a sync loop.
for (const mode of ["main-esm", "main-cjs", "file-esm", "file-cjs", "direct-esm", "direct-cjs"]) {
  test(`image-size rejects malformed boxes and preserves dimensions: ${mode}`, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./helpers/image-size-probe.mjs", import.meta.url)), mode], { timeout: 5000, encoding: "utf8" });
    assert.equal(result.error, undefined, `parser hung: ${result.error?.message}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /image parser guards passed/);
  });
}
