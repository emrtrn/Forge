import { readFile, writeFile } from "node:fs/promises";
import { test } from "@playwright/test";

const SIDECAR_PATH = "public/landscapes/landscape-1.landscape.json";

/**
 * Snapshots the authored landscape sidecar around a destructive landscape smoke.
 *
 * The sculpt/paint smokes delete the level's landscape and save a fresh one,
 * which rewrites `landscape-1.landscape.json` and drops the authored asphalt
 * spline chain that `landscape-spline-chain.spec.ts` asserts on. Specs run
 * serially in one worker and in file order, so without this the later spec sees
 * whatever the earlier ones left behind — and the file stays dirty in git.
 *
 * Call once at the top level of a spec file that saves a landscape.
 */
export function preserveLandscapeSidecar(): void {
  let backup: string | null = null;

  test.beforeEach(async () => {
    backup = await readFile(SIDECAR_PATH, "utf8").catch(() => null);
  });

  test.afterEach(async () => {
    if (backup !== null) await writeFile(SIDECAR_PATH, backup, "utf8");
    backup = null;
  });
}
