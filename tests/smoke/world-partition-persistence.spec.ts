import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RoomLayout } from "../../engine/scene/layout";
import { mergeWorldCells, normalizeWorldPartitionSettings, worldCellPath, type WorldCellDocument } from "../../engine/world/worldPartition";
import { expect, test } from "./test";
import { smokePublicPath } from "./smokeProject.mjs";

const LEVEL = "layouts/__playwright-world-cells.level.json";
const ACTOR = "assets/__playwright-world-cells.actor.json";
const KEYS = ["-1_0", "0_0", "1_0", "0_1", "1_1"];
const NAMES = ["Cell Cube A", "Cell Cube B", "Cell Cube C", "Cell Lamp", "Cell Actor", "Cell Sun", "Cell Ground", "Player Start"];

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(smokePublicPath(path)), { recursive: true });
  await writeFile(smokePublicPath(path), `${JSON.stringify(value, null, 2)}\n`);
}

const diskLevel = async () => JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8")) as RoomLayout;
const diskCell = async (key: string) => JSON.parse(await readFile(smokePublicPath(worldCellPath(LEVEL, "main", key)), "utf8")) as WorldCellDocument;

test("world partition saves cells, rewrites only an edited cell and loads the merged level in editor and runtime", async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await writeJson(ACTOR, {
    schema: 1, type: "actor", name: "Cell Actor Class", parentClass: "actor",
    components: [{ id: "root", component: "Transform", props: {} }],
    variables: [], interfaces: [], references: [], dispatchers: [], eventBindings: [], messageBindings: [], construction: null,
  });
  const fixture: RoomLayout = {
    schema: 1, name: "World Cell Persistence", loadGroups: [], characters: [],
    worldSettings: {
      partition: normalizeWorldPartitionSettings({ enabled: true, grids: { main: { cellSize: 16 } } }),
      gameMode: "assets/starter-content/Gameplay/Script_GameMode.actor.json",
    },
    instances: [
      { assetId: "shape:cube", placements: [
        { name: "Cell Cube A", position: [2, 1, 2] },
        { name: "Cell Cube B", position: [18, 1, 2] },
        { name: "Cell Cube C", position: [-14, 1, 2] },
        { name: "Cell Ground", position: [0, -1, 0], scale: [80, 1, 80], spatiallyLoaded: false },
      ] },
      { assetId: "marker:playerStart", placements: [{ name: "Player Start", position: [0, 0, 0] }] },
    ],
    lights: [
      { id: "sun", name: "Cell Sun", type: "directional", position: [4, 8, 4], intensity: 3, castShadow: false },
      { id: "lamp", name: "Cell Lamp", type: "point", position: [2, 3, 18], intensity: 1 },
    ],
    actors: [{ name: "Cell Actor", classRef: ACTOR, position: [18, 0, 18] }],
  };
  await writeJson(LEVEL, fixture);
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  const assertOutliner = async () => {
    for (const name of NAMES) await expect(page.getByTestId("outliner-row").filter({ hasText: name }).first()).toBeVisible({ timeout: 30_000 });
  };
  await assertOutliner();
  const save = async () => {
    const saved = page.waitForResponse((res) => res.url().endsWith("/__save-layout") && res.request().method() === "POST");
    await page.getByTestId("editor-save").click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.getByTestId("editor-status")).toContainText("Saved");
  };
  await save();
  const persistent = await diskLevel();
  expect(persistent.worldCells).toEqual(KEYS);
  expect(persistent.instances.flatMap((group) => group.placements).map((item) => item.name).sort()).toEqual(["Cell Ground", "Player Start"]);
  expect(persistent.actors).toEqual([]);
  expect(persistent.lights?.map((light) => light.id)).toEqual(["sun"]);
  expect((await diskCell("0_0")).instances?.[0]?.placements[0]?.name).toBe("Cell Cube A");
  expect((await diskCell("1_0")).instances?.[0]?.placements[0]?.name).toBe("Cell Cube B");
  expect((await diskCell("-1_0")).instances?.[0]?.placements[0]?.name).toBe("Cell Cube C");
  expect((await diskCell("0_1")).lights?.[0]?.id).toBe("lamp");
  expect((await diskCell("1_1")).actors?.[0]?.name).toBe("Cell Actor");
  const before = new Map(await Promise.all(KEYS.map(async (key) => {
    const path = smokePublicPath(worldCellPath(LEVEL, "main", key));
    return [key, { bytes: await readFile(path), mtime: (await stat(path)).mtimeMs }] as const;
  })));
  const batches: { cells: WorldCellDocument[]; keep?: string[] }[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/__save-world-cells") && req.method() === "POST") batches.push(req.postDataJSON());
  });
  await page.getByTestId("outliner-row").filter({ hasText: "Cell Cube A" }).first().click();
  await expect(page.getByTestId("detail-px")).toBeVisible();
  await page.evaluate(() => {
    const input = [...document.querySelectorAll<HTMLInputElement>('[data-testid="detail-px"]')].find((item) => item.offsetParent !== null)!;
    input.value = "3";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await save();
  // A save writes changed cells (no deletion), then the level, then cleans up with the full index.
  const writes = batches.filter((batch) => batch.keep === undefined);
  expect(writes.at(-1)?.cells.map((cell) => cell.key)).toEqual(["0_0"]);
  expect(batches.at(-1)).toMatchObject({ cells: [], keep: KEYS });
  expect((await diskCell("0_0")).instances?.[0]?.placements[0]?.position[0]).toBe(3);
  for (const key of KEYS) {
    const path = smokePublicPath(worldCellPath(LEVEL, "main", key));
    expect((await readFile(path)).equals(before.get(key)!.bytes), key).toBe(key !== "0_0");
    if (key !== "0_0") expect((await stat(path)).mtimeMs, key).toBe(before.get(key)!.mtime);
  }
  await page.goto(`/?editor&reload=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await assertOutliner();
  const loaded = new Set<string>();
  page.on("response", (res) => { if (res.ok() && res.url().endsWith(".cell.json")) loaded.add(new URL(res.url()).pathname); });
  await page.goto("/");
  await expect(page.locator("#game-canvas")).toBeVisible();
  // The overlay may not exist yet when the page starts, so wait for the cells themselves.
  await expect.poll(() => KEYS.filter((key) => !loaded.has(`/${worldCellPath(LEVEL, "main", key)}`)), { timeout: 60_000 }).toEqual([]);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 60_000 });
  // The overlay keeps its (hidden) error box in the DOM; only a shown one is a failure.
  await expect(page.locator(".forge-loading-error")).toBeHidden();
  await expect(page.locator(".forge-boot-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("world partition disabling saves the merged level and removes stale cells and empty directories", async ({ page, request }) => {
  const persistent: RoomLayout = { schema: 1, name: "Disable Cells", loadGroups: [], instances: [], characters: [], worldCells: ["0_0"] };
  const cell: WorldCellDocument = { schema: 1, type: "worldCell", grid: "main", key: "0_0", instances: [
    { assetId: "shape:cube", placements: [{ name: "Recovered Cube", position: [2, 0, 2] }] },
  ] };
  await writeJson(LEVEL, persistent);
  await writeJson(worldCellPath(LEVEL, "main", cell.key), cell);
  // A leftover file outside the index must also be pruned.
  await writeJson(worldCellPath(LEVEL, "main", "9_9"), { ...cell, key: "9_9" });
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.goto("/?editor");
  await expect(page.getByTestId("outliner-row").filter({ hasText: "Recovered Cube" })).toBeVisible({ timeout: 60_000 });
  const pruned = page.waitForResponse((res) => res.url().endsWith("/__save-world-cells") && res.request().method() === "POST");
  await page.getByTestId("editor-save").click();
  expect((await pruned).ok()).toBeTruthy();
  await expect(page.getByTestId("editor-status")).toContainText("Saved");
  const saved = await diskLevel();
  expect(saved.worldCells).toBeUndefined();
  expect(saved.instances).toEqual(mergeWorldCells(persistent, [cell]).instances);
  await expect(stat(dirname(dirname(smokePublicPath(worldCellPath(LEVEL, "main", "0_0")))))).rejects.toMatchObject({ code: "ENOENT" });
});
