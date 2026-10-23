import { test as base } from "@playwright/test";
import { resetSmokeDocuments } from "./smokeProject.mjs";

export * from "@playwright/test";

// One worker still owns the project. Each case gets the same authored starting
// documents, even when the previous case failed after a save or level change.
export const test = base.extend<{ smokeDocuments: void }>({
  smokeDocuments: [async ({}, use) => {
    await resetSmokeDocuments();
    await use();
  }, { auto: true }],
});
