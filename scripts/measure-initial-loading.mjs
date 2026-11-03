import { readFile } from "node:fs/promises";

// One login and two rounds of four initial GETs plus the full comments read.
// Never print credentials,
// cookies, response bodies, student data, or arbitrary upstream error messages.
const base = "https://giroksam-recording.vercel.app";
const credentialPath = process.argv[2];
if (!credentialPath) throw new Error("Provide an existing lab credential file path");
const content = await readFile(credentialPath, "utf8");
const email = content.match(/^이메일:\s*(.+)$/m)?.[1]?.trim();
const password = content.match(/^초기 비밀번호:\s*(.+)$/m)?.[1]?.trim();
if (!email?.endsWith("@giroksam.test") || !password) throw new Error("Lab credentials required");
const measurements = [];
async function measure(path, options = {}, round = 0) {
  const start = performance.now();
  try {
    const response = await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(30_000), redirect: "manual" });
    const headersMs = Math.round(performance.now() - start);
    const body = await response.arrayBuffer();
    measurements.push({ path, round, status: response.status, headersMs, totalMs: Math.round(performance.now() - start), bytes: body.byteLength, serverTiming: response.headers.get("server-timing") });
    return response;
  } catch {
    measurements.push({ path, round, error: "request-failed-or-timed-out", totalMs: Math.round(performance.now() - start) });
    return null;
  }
}
const login = await measure("/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, returnTo: "/" }),
});
if (login?.status === 200) {
  const cookie = login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  for (const round of [1, 2]) await Promise.all([
    "/api/assessment-plan", "/api/class-data", "/api/generated-comments?summary=1", "/api/student-behaviors", "/api/generated-comments",
  ].map(path => measure(path, { headers: { Cookie: cookie }, cache: "no-store" }, round)));
}
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), scope: "production lab account, current sample only", measurements }, null, 2));
if (measurements.some(item => item.status !== 200)) process.exitCode = 1;
