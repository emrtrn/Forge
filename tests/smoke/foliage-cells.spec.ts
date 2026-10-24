import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { foliageDataPath, normalizeFoliageType, type LayoutFoliageData } from "../../engine/scene/foliage";
import { foliageCellPath, type FoliageCellDocument } from "../../engine/world/foliageCells";
import { normalizeWorldPartitionSettings } from "../../engine/world/worldPartition";
import { expect, test } from "./test";
import { REPO_ROOT, smokePublicPath } from "./smokeProject.mjs";

/**
 * OPEN_WORLD_PLAN Faz 6 F2: painted foliage of a World Partition level is
 * saved as an index sidecar plus `<Level>.cells/foliage/<x_z>.foliage.json`.
 * A level whose foliage is still one sidecar is re-partitioned by a Save with
 * no foliage edit; the reopened editor sees every instance; a second Save
 * writes no foliage file; Play reads the cells.
 */

const LEVEL = "layouts/__playwright-foliage-cells.level.json";
const TYPE_ID = "__playwright-cell-foliage";
const TYPE_PATH = `assets/${TYPE_ID}.foliagetype.json`;
const KEYS = ["0_0", "1_0", "-1_2"];

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(smokePublicPath(path)), { recursive: true });
  await writeFile(smokePublicPath(path), `${JSON.stringify(value, null, 2)}\n`);
}

const readJson = async <T>(path: string) => JSON.parse(await readFile(smokePublicPath(path), "utf8")) as T;

test("foliage cells: a partitioned level saves, reopens and plays its foliage from cell files", async ({ page, request }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  const foliageRequests: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/__save-foliage(-cells)?$/.test(req.url())) foliageRequests.push(new URL(req.url()).pathname);
  });

  const base = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  await writeJson(LEVEL, {
    ...base,
    name: "__playwright-foliage-cells",
    worldSettings: { ...base.worldSettings, partition: normalizeWorldPartitionSettings({ enabled: true }) },
  });
  const manifestPath = smokePublicPath("assets/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const cube = manifest.assets.find((asset: { id: string }) => asset.id === "shape-cube");
  manifest.assets.push({ ...cube, id: TYPE_ID, name: "Cell Foliage", assetType: "foliageType", path: TYPE_PATH, placeable: false });
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeJson(TYPE_PATH, normalizeFoliageType({ name: "Cell Foliage", meshAssetId: "shape-cube" }));
  const positions = [[10, 0, 10], [70, 0, 10], [-5, 0, 130], [12, 0, 20]];
  await writeJson(foliageDataPath(LEVEL), {
    schema: 1, type: "foliage", landscapeRules: [],
    groups: [{
      id: "cell-group", foliageTypeId: TYPE_ID, target: { kind: "staticMesh", id: "ground" },
      instances: positions.map((position) => ({ position, rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] })),
    }],
  });
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1440, height: 860 });

  const bootEditor = async () => {
    await page.goto(`/?editor&foliageCells=${Date.now()}`);
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    await page.locator('[data-inspector-tab="foliage"]').click();
    await expect(page.locator(".foliage-type-name")).toHaveText("Cell Foliage", { timeout: 30_000 });
    await expect(page.locator(".foliage-type-count")).toHaveText("4");
  };
  const save = async () => {
    const saved = page.waitForResponse((res) => res.url().endsWith("/__save-layout") && res.request().method() === "POST");
    await page.getByTestId("editor-save").click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 30_000 });
  };

  // A leftover cell file no index lists; the save's prune step removes it.
  const stale = foliageCellPath(LEVEL, "9_9");
  await writeJson(stale, { schema: 1, type: "foliageCell", key: "9_9", groups: [] });

  await bootEditor();
  // No foliage edit: the single sidecar no longer matches the partitioned level.
  await save();
  await expect(stat(smokePublicPath(stale))).rejects.toThrow();
  expect(foliageRequests).toEqual(["/__save-foliage-cells", "/__save-foliage", "/__save-foliage-cells"]);
  const index = await readJson<LayoutFoliageData>(foliageDataPath(LEVEL));
  expect(index.foliageCells).toEqual(KEYS);
  expect(index.groups.map((group) => [group.id, group.instances.length])).toEqual([["cell-group", 0]]);
  const counts = await Promise.all(KEYS.map(async (key) =>
    (await readJson<FoliageCellDocument>(foliageCellPath(LEVEL, key))).groups.map((group) => group.instances.length)));
  expect(counts).toEqual([[2], [1], [1]]);

  // Reopened from the cell files: same instances, and nothing to write.
  await bootEditor();
  foliageRequests.length = 0;
  await save();
  expect(foliageRequests).toEqual([]);

  // Play reads the index and every listed cell.
  const cellResponses: string[] = [];
  page.on("response", (res) => {
    if (res.url().includes(".cells/foliage/") && res.ok()) cellResponses.push(res.url().replace(/.*\/foliage\//, "").replace(/\?.*$/, ""));
  });
  await page.goto(`/?debug&foliageCellsPlay=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  expect([...new Set(cellResponses)].sort()).toEqual(KEYS.map((key) => `${key}.foliage.json`).sort());
  expect(errors).toEqual([]);
});
