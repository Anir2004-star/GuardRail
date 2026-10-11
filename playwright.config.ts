import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 2,
  timeout: 45_000,
  use: { baseURL: "http://localhost:3100", browserName: "chromium", trace: "retain-on-failure" },
  webServer: { command: `${process.platform === "win32" ? "npm.cmd" : "npm"} run start -- -p 3100`, url: "http://localhost:3100", reuseExistingServer: false, timeout: 90_000 },
});
