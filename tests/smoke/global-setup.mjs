import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { smokeRunRoot } from "./smokeProject.mjs";

// The web-server launcher prepares the disposable project before Vite starts.
// No authoring files are backed up, rewritten or restored by the smoke suite.
export default async function globalSetup() {
  await access(resolve(smokeRunRoot(), "baseline.json"));
}
