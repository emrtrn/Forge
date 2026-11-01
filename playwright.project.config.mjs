import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/project",
  outputDir: ".dev-server/project-browser-results",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
});
