import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const workflowsDirectory = new URL("../.github/workflows/", import.meta.url);
const workflowFiles = (await readdir(workflowsDirectory))
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));

assert.ok(workflowFiles.length > 0, "No GitHub Actions workflows found");

const unpinnedActions = [];
let externalActionCount = 0;

for (const fileName of workflowFiles) {
  const content = await readFile(new URL(fileName, workflowsDirectory), "utf8");
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*uses:\s*([^\s#]+)/);
    if (!match || match[1].startsWith("./")) continue;

    externalActionCount += 1;
    const reference = match[1].split("@").at(-1) ?? "";
    if (!/^[0-9a-f]{40}$/i.test(reference)) {
      unpinnedActions.push(`${fileName}:${index + 1} (${match[1]})`);
    }
  }
}

assert.ok(externalActionCount > 0, "No external GitHub Actions found");
assert.deepEqual(
  unpinnedActions,
  [],
  `External actions must use a full 40-character commit SHA: ${unpinnedActions.join(", ")}`,
);

process.stdout.write(`workflow action pins ok: ${externalActionCount} references checked\n`);
