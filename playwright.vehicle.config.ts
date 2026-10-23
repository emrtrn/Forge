import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Vehicle tests route their own level and use a unique temporary save file.
// They need none of the shared suite's mutable level/landscape fixtures.
const config = { ...base };
delete config.globalSetup;
delete config.globalTeardown;
export default defineConfig({ ...config, testMatch: "vehicle.spec.ts" });
