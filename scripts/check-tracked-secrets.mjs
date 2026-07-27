import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const patterns = [
  ["OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["Google OAuth client secret", /\bGOCSPX-[A-Za-z0-9_-]{20,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["configured OpenAI key", /^\s*OPENAI_API_KEY\s*=\s*(?!YOUR_|\.{3}|$)\S+/m],
  ["configured Supabase service key", /^\s*SUPABASE_SERVICE_ROLE_KEY\s*=\s*(?!YOUR_|\.{3}|$)\S+/m],
  ["configured Google client secret", /^\s*GOOGLE_CLIENT_SECRET\s*=\s*(?!YOUR_|\.{3}|$)\S+/m],
];

const findings = [];
for (const file of tracked) {
  const content = await readFile(file).catch(() => null);
  if (!content || content.includes(0)) continue;
  const text = content.toString("utf8");
  for (const [kind, pattern] of patterns) {
    if (pattern.test(text)) findings.push(`${file}: ${kind}`);
  }
}

assert.deepEqual(
  findings,
  [],
  `Potential secrets found in tracked files (values hidden):\n${findings.join("\n")}`,
);
process.stdout.write(`tracked secret scan ok: ${tracked.length} files checked\n`);
