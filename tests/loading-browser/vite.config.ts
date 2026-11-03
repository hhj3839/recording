import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: "tests/loading-browser", plugins: [react(), {
    name: "stalled-body-fixture",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== "/api/auth/login" || request.headers["x-test-response"] !== "stall-body") return next();
        response.writeHead(200, { "Content-Type": "application/json" });
        response.write('{"returnTo":');
        // Remain open until the browser aborts. No real authentication occurs.
        request.on("close", () => response.destroy());
      });
    },
  }], envDir: false,
  resolve: { alias: { "next/navigation": path.resolve("tests/loading-browser/navigation.ts") } },
  server: { host: "127.0.0.1", port: 4183, strictPort: true, fs: { allow: [process.cwd()] } },
});
