import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/production",
  outputDir: "test-results-production",
  timeout: 150_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-production-report", open: "never" }]],
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  webServer: {
    command: "node tests/production/start-server.mjs",
    url: "http://127.0.0.1:5274/",
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: "production-root", use: { baseURL: "http://127.0.0.1:5274/" } },
    { name: "production-subpath", use: { baseURL: "http://127.0.0.1:5275/oyunlar/demo/" } },
  ],
});
