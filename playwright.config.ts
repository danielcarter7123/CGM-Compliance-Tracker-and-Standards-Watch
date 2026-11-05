import { defineConfig } from "@playwright/test";

// End-to-end tests against the local stack: `npm run db:start`, `npm run seed:dev`, `npm run import:pilot` first.
// Uses an already-running dev server on :3000, or starts one.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
