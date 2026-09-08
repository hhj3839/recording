# image-size 2.0.2 local security patch

Date: 2026-09-08. This is an application-maintained patch, **not an upstream release**.

Advisories:
- https://github.com/advisories/GHSA-5p2g-fcmc-qvqq (JXL/HEIF)
- https://github.com/advisories/GHSA-w3rx-r6r6-pgpr (ICNS)

The registry still provides 2.0.2. Earlier audit metadata named 2.0.3, but the current advisory page says no patched version. Do not assume 2.0.3 exists.

`pnpm-workspace.yaml` registers `image-size@2.0.2.patch`; pnpm records its hash in the lockfile and applies it on frozen installs. The registry package integrity is retained. Do not edit installed node_modules or suppress advisories as a substitute for applying the patch.

`packageManager` pins pnpm 11.9.0, matching CI. Vercel otherwise selected pnpm 10 and rejected the v11 patch-lock format; keep package-manager versions aligned across environments.

Changes cover all 20 distributed CJS/ESM bundles containing the affected routines:
- ISO box parsing requires a complete 8-byte header and a positive advance of at least 8 bytes. Size zero means the remaining input (EOF), preserving valid zero-size boxes without looping. Undersized boxes fail closed.
- ICNS entry headers and lengths must fit both declared file length and input length and advance at least 8 bytes before recording dimensions.
- Package version, public API and unrelated codecs remain unchanged.

Regression probes run in child processes with a 5-second hard deadline. They cover main, fromFile and direct codec entry points, zero/undersized/oversized/truncated records, valid ICNS/HEIF/JXL (including zero-size EOF boxes), PNG and GIF dimensions. Run `node --test tests/image-size-security.test.mjs` or `pnpm test`.

Residual limitation: version-based `pnpm audit` continues to report two high advisories for 2.0.2; this is not an audit-clean dependency tree. Regression results establish mitigation of the tested loop paths, not a full parser security certification. Replace this patch with a verified official fixed release when available, keeping these tests and removing the patch registration only after validation.
