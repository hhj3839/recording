import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [manifestText, lockfile] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"),
]);
const manifest = JSON.parse(manifestText);
const declared = {
  ...(manifest.dependencies ?? {}),
  ...(manifest.devDependencies ?? {}),
  ...(manifest.optionalDependencies ?? {}),
};

const unsafeSpecifiers = Object.entries(declared).filter(([, specifier]) =>
  /^(?:git(?:\+|:)|github:|https?:|file:|link:)/i.test(String(specifier)));
assert.deepEqual(
  unsafeSpecifiers,
  [],
  `Direct Git, URL, or local-file dependencies are not allowed: ${unsafeSpecifiers.map(([name]) => name).join(", ")}`,
);

const unsafeLockfileSources = lockfile.match(/(?:^|\s)(?:git\+|git@|http:\/\/|file:|link:|tarball:)/gim) ?? [];
assert.deepEqual(unsafeLockfileSources, [], "Lockfile contains a non-registry or insecure package source");

const resolutions = lockfile.match(/^    resolution:/gm) ?? [];
const sha512Resolutions = lockfile.match(/^    resolution: \{integrity: sha512-[A-Za-z0-9+/=]+\}$/gm) ?? [];
assert.ok(resolutions.length > 0, "Lockfile has no package resolutions");
assert.equal(
  sha512Resolutions.length,
  resolutions.length,
  `Every registry package must have sha512 integrity (${sha512Resolutions.length}/${resolutions.length})`,
);

process.stdout.write(`lockfile safety ok: ${resolutions.length} registry packages with sha512 integrity\n`);
