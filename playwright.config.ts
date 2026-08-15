import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke runs own a dedicated port and always start their own server.
 *
 * A Forge fork is a copy of this repo, so a fork's dev server answers every
 * Forge route identically. On the shared 5173 with `reuseExistingServer`, a
 * fork's running `npm run dev` silently became the system under test: the editor
 * smokes passed against the wrong working copy while the runtime smokes timed
 * out loading *that* project's level — a failure that reads like a Forge
 * regression and cost three phases of misdiagnosis.
 *
 * `--strictPort` plus `reuseExistingServer: false` turns that into a loud
 * "port is already in use" instead of a silent wrong-repo run.
 */
export const SMOKE_PORT = 5273;
export const SMOKE_BASE_URL = `http://127.0.0.1:${SMOKE_PORT}`;

export default defineConfig({
  testDir: "./tests/smoke",
  outputDir: "test-results",
  timeout: 150_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/smoke/global-setup.mjs",
  globalTeardown: "./tests/smoke/global-teardown.mjs",
  use: {
    baseURL: SMOKE_BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:smoke",
    url: SMOKE_BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
