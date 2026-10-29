import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** F4 uses installed Chrome and hardware WebGL, with isolated smoke data. */
export default defineConfig({
  ...base,
  testMatch: "terrain-lake-editor.spec.ts",
  grep: /Water F4/,
  outputDir: ".dev-server/water-f4",
  projects: [{ name: "chrome-hardware", use: { channel: "chrome", headless: false,
    launchOptions: { args: ["--start-maximized", "--force-device-scale-factor=1", "--js-flags=--expose-gc", "--disable-background-timer-throttling"] } } }],
});
