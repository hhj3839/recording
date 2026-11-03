import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/loading-browser", testMatch: "*.spec.ts", workers: 1,
  timeout: 30_000, expect: { timeout: 5_000 },
  use: { baseURL: "http://127.0.0.1:4183", serviceWorkers: "block", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], ...(process.platform === "win32" ? { channel: "chrome" } : {}) } }],
  webServer: { command: "node node_modules/vite/bin/vite.js --config tests/loading-browser/vite.config.ts", url: "http://127.0.0.1:4183", reuseExistingServer: false },
  outputDir: "test-results/loading-browser",
});
