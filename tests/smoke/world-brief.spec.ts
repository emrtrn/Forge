import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runWorldBrief } from "../../tools/world/worldBriefRun";
import { expect, test } from "./test";
import { smokePublicPath } from "./smokeProject.mjs";

/**
 * World Builder pilot step 2: a level `world:brief` builds from the pilot's
 * world brief is already what the editor's Save Layout writes. Opening it in
 * the editor and saving changes no file: not the level, its World Partition
 * cells, the terrain, the recipe nor the foliage sidecar.
 */

const BRIEF = "assets/world-pilot/Levels/WbPilotValley.worldbrief.json";
const PARTITION = { enabled: true, grids: { main: { cellSize: 128, loadRange: 384 }, foliage: { cellSize: 64, loadRange: 256 } } };

/** Every file of the level, by public path → SHA-256. */
async function snapshot(level: string): Promise<Record<string, string>> {
  const base = level.replace(/\.level\.json$/, "");
  const files: Record<string, string> = {};
  const add = async (path: string) => {
    files[path] = createHash("sha256").update(await readFile(smokePublicPath(path))).digest("hex");
  };
  for (const path of [level, `${base}.worldrecipe.json`, `${base}.foliage.json`]) await add(path);
  for (const dir of [`${base}.cells`, `${base}.landscapes`]) {
    const entries = await readdir(smokePublicPath(dir), { recursive: true, withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parent = entry.parentPath.replace(/\\/g, "/");
      await add(`${dir}${parent.slice(parent.indexOf(dir) + dir.length)}/${entry.name}`);
    }
  }
  return files;
}

for (const partitioned of [false, true]) {
  test(`world brief: the built ${partitioned ? "partitioned " : ""}pilot opens and saves in the editor without a file changing`, async ({ page, request }) => {
    test.setTimeout(420_000);
    const level = `assets/world-pilot/Levels/__playwright-world-brief${partitioned ? "-wp" : ""}.level.json`;
    if (partitioned) {
      // The runner keeps the partition settings of the level it replaces.
      await mkdir(dirname(smokePublicPath(level)), { recursive: true });
      await writeFile(smokePublicPath(level), JSON.stringify({
        schema: 1, name: "stub", loadGroups: [], instances: [], characters: [], worldSettings: { partition: PARTITION },
      }));
    }
    const built = await runWorldBrief({ root: smokePublicPath(""), brief: BRIEF, out: level, force: partitioned });
    expect(built.build.cellKeys.length > 0).toBe(partitioned);
    const before = await snapshot(level);
    expect(Object.keys(before).filter((path) => path.includes(".cells/main/")).length).toBe(built.build.cellKeys.length);

    // Vite serves a new public file once its watcher reports it; a file written
    // while the fresh server's watcher is still scanning is missed. Writing it
    // again reports it.
    for (const path of Object.keys(before).filter((file) => file.endsWith(".json"))) {
      await expect.poll(async () => {
        const response = await request.get(`/${path}`).catch(() => null);
        if ((response?.headers()["content-type"] ?? "").includes("json")) return true;
        console.log(`[world-brief smoke] ${new Date().toISOString()} not served yet: ${path}`);
        const data = await readFile(smokePublicPath(path));
        await unlink(smokePublicPath(path));
        await writeFile(smokePublicPath(path), data);
        return false;
      }, { message: path, timeout: 180_000, intervals: [1_000, 2_000, 5_000] }).toBe(true);
    }
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    expect((await request.post("/__open-level", { data: { path: level } })).ok()).toBeTruthy();
    await page.addInitScript(() => localStorage.clear());
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.goto(`/?editor&worldBrief=${Date.now()}`);
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    for (const name of ["WB Pilot Valley", "Cabin", "Woodpile", "rock-high-0"]) {
      await expect(page.getByTestId("outliner-row").filter({ hasText: name }).first()).toBeVisible({ timeout: 90_000 });
    }
    const saved = page.waitForResponse((res) => res.url().endsWith("/__save-layout") && res.request().method() === "POST");
    await page.getByTestId("editor-save").click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 60_000 });
    await expect(page.getByTestId("editor-status")).not.toContainText("dropped");
    // Sidecar steps (cells cleanup, foliage) answer after the level.
    await page.waitForTimeout(2_000);

    expect(await snapshot(level)).toEqual(before);
    expect(errors).toEqual([]);
  });
}
