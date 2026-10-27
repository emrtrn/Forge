import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PerspectiveCamera } from "three";
import { normalizeWorldTerrain } from "../../engine/terrain/terrainDefinition";
import { encodeHeightmapPng16 } from "../../engine/terrain/heightmapPng";
import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { levelTerrainPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { openWorldFogPatch } from "../../engine/world/openWorldSetup";
import { expect, test, type Page } from "./test";
import { SMOKE_SPLINE_SCENE, smokePublicPath } from "./smokeProject.mjs";

/**
 * Add Actor → Landscape (OPEN_WORLD_PLAN Faz 2): the dialog defaults to one
 * tile, flags the single-tile-only spline/river tools once more tiles are
 * picked, creates a flat 2×2 grid, and Save writes its u16 tiles and
 * definition into the level's terrain folder before the level. Undo + Save
 * prunes the files, Redo writes them again, a reload shows the terrain, and the
 * pawn stands on it in Play.
 */

const LEVEL = "layouts/__playwright-terrain-create.level.json";
const OPEN_WORLD_LEVEL = "layouts/__playwright-open-world-create.level.json";
const ROUND_TRIP_LEVEL = "layouts/__playwright-terrain-round-trip.level.json";
const HEIGHTMAP_LEVEL = "layouts/__playwright-terrain-heightmap-create.level.json";
const BASE_HEIGHT = 2;

async function exists(path: string): Promise<boolean> {
  return access(smokePublicPath(path)).then(() => true, () => false);
}

async function writeLevel(path = LEVEL): Promise<void> {
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  level.name = `__playwright-${path.slice("layouts/__playwright-".length, -".level.json".length)}`;
  level.instances = level.instances.filter((group: { assetId: string }) => group.assetId === "marker:playerStart");
  const start = level.instances[0];
  if (!start) throw new Error("smoke spline level has no Player Start");
  start.placements = [{ ...start.placements[0], position: [6, BASE_HEIGHT + 3, -4] }];
  level.landscapes = [];
  level.riverWaters = [];
  // The open world flow starts from a level with no partition, view distance or fog.
  delete level.heightFog;
  if (level.worldSettings) {
    delete level.worldSettings.partition;
    delete level.worldSettings.viewDistance;
  }
  await mkdir(dirname(smokePublicPath(path)), { recursive: true });
  await writeFile(smokePublicPath(path), JSON.stringify(level, null, 2));
}

function saved(page: Page, path: "/__save-terrain" | "/__save-layout") {
  return page.waitForResponse((response) => response.url().endsWith(path) && response.request().method() === "POST", { timeout: 30_000 });
}

test("Add Actor → Landscape creates a flat multi-tile terrain that saves, undoes, reloads and collides", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await writeLevel();
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`/?editor&create=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 60_000 });

  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Terrain/ }).hover();
  await page.locator("[data-add-categories]").getByRole("button", { name: "Landscape", exact: true }).click();
  const dialog = page.locator("[data-world-terrain-dialog]");
  await expect(dialog).toBeVisible();
  const create = dialog.locator("[data-world-terrain-create]");
  await expect(dialog.locator('[data-field="tilesX"]')).toHaveValue("1");
  await expect(dialog.locator('[data-field="tilesZ"]')).toHaveValue("1");
  await expect(dialog.locator("[data-world-terrain-multitile]")).toBeHidden();
  await expect(create).toBeEnabled();
  await dialog.locator('[data-field="tilesX"]').fill("0");
  await expect(create).toBeDisabled();
  await dialog.locator('[data-field="tilesX"]').fill("2");
  await dialog.locator('[data-field="tilesZ"]').fill("2");
  await dialog.locator('[data-field="tileQuads"]').selectOption("64");
  await dialog.locator('[data-field="spacing"]').fill("1");
  await dialog.locator('[data-field="baseHeight"]').fill(String(BASE_HEIGHT));
  await expect(dialog.locator("[data-world-terrain-summary]")).toContainText("128 m × 128 m · 4 tiles of 64 m");
  await expect(dialog.locator("[data-world-terrain-multitile]")).toBeVisible();
  await expect(create).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("dialog.png") });

  // Save order: tiles, definition, then the level that names them.
  let terrainSave = saved(page, "/__save-terrain");
  let layoutSave = saved(page, "/__save-layout");
  await create.click();
  await expect(dialog).toHaveCount(0);
  expect((await terrainSave).ok()).toBeTruthy();
  expect((await layoutSave).ok()).toBeTruthy();
  const row = page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first();
  await expect(row).toBeVisible();
  await expect(page.locator("[data-world-terrain]")).toContainText("2 × 2");
  await expect(page.locator("[data-world-terrain]")).toContainText("128 m × 128 m");

  const level = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  expect(level.landscapes).toHaveLength(1);
  const [actor] = level.landscapes;
  const definitionPath = levelTerrainPath(LEVEL, actor.id);
  expect(actor.dataRef).toBe(definitionPath);
  expect(actor.position).toEqual([0, BASE_HEIGHT, 0]);
  const definition = normalizeWorldTerrain(JSON.parse(await readFile(smokePublicPath(definitionPath), "utf8")));
  expect([definition.tilesX, definition.tilesZ, definition.tileQuads, definition.origin]).toEqual([2, 2, 64, [-64, BASE_HEIGHT, -64]]);
  for (const { key } of definition.tiles) {
    const tile = decodeTerrainTile(await readFile(smokePublicPath(terrainTilePath(definitionPath, key))));
    expect(tile.heightFormat, key).toBe("u16");
    expect(tile.heights.every((height) => Math.abs(height) < 0.01), key).toBe(true);
  }

  // Undo + autosave prunes the now unreferenced level terrain; Redo writes it again.
  layoutSave = saved(page, "/__save-layout");
  await page.getByTestId("editor-undo").click();
  expect((await layoutSave).ok()).toBeTruthy();
  await expect(row).toHaveCount(0);
  await expect.poll(() => exists(definitionPath)).toBe(false);
  terrainSave = saved(page, "/__save-terrain");
  layoutSave = saved(page, "/__save-layout");
  await page.getByTestId("editor-redo").click();
  expect((await terrainSave).ok()).toBeTruthy();
  expect((await layoutSave).ok()).toBeTruthy();
  expect(await exists(definitionPath)).toBe(true);
  expect(await exists(terrainTilePath(definitionPath, "1_1"))).toBe(true);

  // A reload reads it back as a multi-tile World Terrain.
  await page.goto(`/?editor&create=${Date.now()}`);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
  await expect(page.locator("[data-world-terrain]")).toContainText("2 × 2");

  // Play: the pawn lands on the flat terrain at the base height.
  await page.goto(`/?debug&create=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  const stats = page.locator("#debug-stats");
  await expect(stats).toContainText(/movement: walking \(grounded\)/, { timeout: 30_000 });
  const text = (await stats.textContent()) ?? "";
  const y = Number(text.match(/pos: (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/)?.[2]);
  console.log(`[terrain-create] pawn y ${y}`);
  expect(Math.abs(y - BASE_HEIGHT)).toBeLessThan(0.2);
  expect(errors).toEqual([]);
});

/**
 * New Open World (OPEN_WORLD_PLAN Faz 8): the dialog's Open World section sets
 * World Partition, view distance and a fitted Height Fog for any grid, and the
 * u16 height range for a multi-tile one, all created with the terrain as one
 * undo step.
 */
test("New Landscape's Open World section sets partition, view distance, fog and height range in one undo step", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await writeLevel(OPEN_WORLD_LEVEL);
  expect((await request.post("/__open-level", { data: { path: OPEN_WORLD_LEVEL } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?editor&openWorld=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 60_000 });

  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Terrain/ }).hover();
  await page.locator("[data-add-categories]").getByRole("button", { name: "Landscape", exact: true }).click();
  const dialog = page.locator("[data-world-terrain-dialog]");
  const section = dialog.locator("[data-open-world]");
  const notes = dialog.locator("[data-open-world-notes]");
  const create = dialog.locator("[data-world-terrain-create]");
  // A 1x1 Landscape is an open world too; only the u16 height range is multi-tile.
  await expect(section).toBeVisible();
  await expect(section.locator('[data-world="partition"]')).toBeVisible();
  await expect(section.locator('[data-field="heightMin"]')).toBeHidden();
  await expect(notes).not.toContainText("cm steps");
  await dialog.locator('[data-field="tilesX"]').fill("4");
  await dialog.locator('[data-field="tilesZ"]').fill("2");
  await dialog.locator('[data-field="tileQuads"]').selectOption("64");
  await dialog.locator('[data-field="spacing"]').fill("2");
  await expect(section.locator('[data-field="heightMin"]')).toBeVisible();
  // Seeded from the level: nothing switched on.
  await expect(section.locator('[data-world="partition"]')).not.toBeChecked();
  await expect(section.locator('[data-world="cellSize"]')).toBeDisabled();
  await expect(section.locator('[data-world="viewDistance"]')).toHaveValue("");
  await section.locator('[data-field="heightMin"]').fill("-20");
  await section.locator('[data-field="heightMax"]').fill("300");
  await expect(notes).toContainText("0.5 cm steps");

  // 512 m × 256 m world: the suggestion sees across it and stays under far view mode.
  await section.locator("[data-open-world-suggest]").click();
  await expect(section.locator('[data-world="viewDistance"]')).toHaveValue("600");
  await expect(section.locator('[data-world="partition"]')).toBeChecked();
  await expect(section.locator('[data-world="fitFog"]')).not.toBeChecked();
  await section.locator('[data-world="cellSize"]').fill("64");
  await expect(notes).toContainText("About 32 actor cells");
  await section.locator('[data-world="viewDistance"]').fill("10");
  await expect(create).toBeDisabled();
  await section.locator('[data-world="viewDistance"]').fill("1500");
  await expect(notes).toContainText("hard edge");
  await section.locator('[data-world="fitFog"]').check();
  await expect(notes).not.toContainText("hard edge");
  await expect(create).toBeEnabled();
  await dialog.screenshot({ path: testInfo.outputPath("open-world-dialog.png") });

  const layoutSave = saved(page, "/__save-layout");
  await create.click();
  await expect(dialog).toHaveCount(0);
  expect((await layoutSave).ok()).toBeTruthy();
  const row = page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first();
  await expect(row).toBeVisible();

  const level = async () => JSON.parse(await readFile(smokePublicPath(OPEN_WORLD_LEVEL), "utf8"));
  // Autosave may be mid-write while polling: a partial file reads as "not yet".
  const settled = async <T>(read: (current: any) => T): Promise<T | "writing"> => {
    try {
      return read(await level());
    } catch {
      return "writing";
    }
  };
  const created = await level();
  expect(created.worldSettings.partition.enabled).toBe(true);
  expect(created.worldSettings.partition.grids.main).toEqual({ cellSize: 64, loadRange: 384 });
  expect(created.worldSettings.viewDistance).toBe(1500);
  expect(created.heightFog).toMatchObject(openWorldFogPatch(1500));
  const definition = normalizeWorldTerrain(JSON.parse(await readFile(smokePublicPath(levelTerrainPath(OPEN_WORLD_LEVEL, created.landscapes[0].id)), "utf8")));
  expect([definition.tilesX, definition.tilesZ, definition.heightMin, definition.heightMax]).toEqual([4, 2, -20, 300]);

  // One undo takes the terrain, the world settings and the fog back together.
  await page.getByTestId("editor-undo").click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => settled((current) => [
    current.landscapes?.length ?? 0, current.worldSettings?.partition ?? null, current.worldSettings?.viewDistance ?? null, current.heightFog ?? null,
  ]), { timeout: 30_000 }).toEqual([0, null, null, null]);
  await page.getByTestId("editor-redo").click();
  await expect(row).toBeVisible();
  await expect.poll(() => settled((current) => [
    current.landscapes?.length ?? 0, current.worldSettings?.viewDistance ?? null, current.heightFog?.mode ?? null,
  ]), { timeout: 30_000 }).toEqual([1, 1500, "exp"]);
  expect(errors).toEqual([]);
});

/**
 * OPEN_WORLD_PLAN Faz 8 editor acceptance: a new world created in the editor,
 * a Raise stroke across a tile seam, Save, and a reopened editor that sees
 * the same heights. The editor's own height query (the terrain mesh's CPU
 * heightfield raycast) is read before and after the reload; the saved tiles
 * are u16, so the reopened surface may differ by half a height step.
 */
test("a world created in the editor keeps a seam stroke's heights through Save and a reopen", async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await writeLevel(ROUND_TRIP_LEVEL);
  expect((await request.post("/__open-level", { data: { path: ROUND_TRIP_LEVEL } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 860 });
  // 2x2 tiles of 64 quads at 1 m, centred on the origin: the x = 0 seam runs between tiles 0_1 and 1_1 at z = 20.
  const seam = [0, BASE_HEIGHT, 20] as const;
  const camera = new PerspectiveCamera();
  camera.position.set(seam[0] - 18, seam[1] + 14, seam[2] + 18);
  camera.lookAt(...seam);
  const pose = { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] };
  await page.addInitScript(({ key, value }) => {
    localStorage.clear();
    localStorage.setItem(key, value);
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __roundTripScenes: unknown[] };
    w.__roundTripScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isScene) w.__roundTripScenes.push(object);
    });
  }, { key: `forge.editor.cameraPose.${encodeURIComponent(ROUND_TRIP_LEVEL)}`, value: JSON.stringify(pose) });
  const row = page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first();
  const openEditor = async () => {
    await page.goto(`/?editor&roundTrip=${Date.now()}`);
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 60_000 });
  };
  /** World Y the editor's terrain reports straight below each X/Z (its picking raycast). */
  const editorHeights = (points: readonly (readonly [number, number])[]) => page.evaluate((probes) => {
    const w = window as unknown as { __roundTripScenes: { traverse(fn: (node: any) => void): void }[] };
    let terrain: any = null;
    for (const scene of w.__roundTripScenes) scene.traverse((node) => { if (node.userData?.forgeTerrain) terrain = node; });
    if (!terrain) return null;
    const Vector = terrain.position.constructor;
    return probes.map(([x, z]) => {
      const hits: { point: { y: number } }[] = [];
      terrain.raycast({ ray: { origin: new Vector(x, 1000, z), direction: new Vector(0, -1, 0) }, near: 0, far: Infinity }, hits);
      return hits[0]?.point.y ?? null;
    });
  }, points);

  await openEditor();
  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Terrain/ }).hover();
  await page.locator("[data-add-categories]").getByRole("button", { name: "Landscape", exact: true }).click();
  const dialog = page.locator("[data-world-terrain-dialog]");
  await dialog.locator('[data-field="tilesX"]').fill("2");
  await dialog.locator('[data-field="tilesZ"]').fill("2");
  await dialog.locator('[data-field="tileQuads"]').selectOption("64");
  await dialog.locator('[data-field="spacing"]').fill("1");
  await dialog.locator('[data-field="baseHeight"]').fill(String(BASE_HEIGHT));
  const created = saved(page, "/__save-terrain");
  const createdLevel = saved(page, "/__save-layout");
  await dialog.locator("[data-world-terrain-create]").click();
  expect((await created).ok()).toBeTruthy();
  expect((await createdLevel).ok()).toBeTruthy();
  const level = JSON.parse(await readFile(smokePublicPath(ROUND_TRIP_LEVEL), "utf8"));
  const definitionPath = levelTerrainPath(ROUND_TRIP_LEVEL, level.landscapes[0].id);

  // Raise across the seam at the viewport centre; autosave writes the terrain.
  await row.click();
  await page.locator("[data-world-terrain-tools] [data-landscape-mode]").selectOption("sculpt");
  await page.locator('[data-world-terrain-tools] [data-landscape-tool="raise"]').click();
  await page.locator('[data-landscape-number="brushSize"]').fill("6");
  await page.locator('[data-landscape-number="brushSize"]').press("Enter");
  await page.locator('[data-landscape-number="strength"]').fill("0.5");
  await page.locator('[data-landscape-number="strength"]').press("Enter");
  const written: string[] = [];
  page.on("request", (req) => {
    const tile = req.url().match(/__save-terrain-tile\?.*key=(\d+_\d+)/);
    if (tile) written.push(tile[1]!);
  });
  const viewport = (await page.locator("[data-viewport-host]").boundingBox())!;
  const centre = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
  const stroke = saved(page, "/__save-terrain");
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 3, centre.y + 1, { steps: 3 });
  await page.mouse.up();
  expect((await stroke).ok()).toBeTruthy();
  expect([...new Set(written)].sort(), "only the two seam tiles").toEqual(["0_1", "1_1"]);

  const probes = [[0, 20], [-2, 20], [2, 21], [-40, -40]] as const;
  const before = (await editorHeights(probes))!;
  console.log(`[terrain-round-trip] editor heights before reopen ${JSON.stringify(before)}`);
  expect(before.every((height) => height !== null)).toBe(true);
  expect(before[0]!).toBeGreaterThan(BASE_HEIGHT + 0.05);
  expect(Math.abs(before[3]! - BASE_HEIGHT), "an untouched tile stays flat").toBeLessThan(0.01);

  // On disk the seam column is written identically on both sides.
  const definition = normalizeWorldTerrain(JSON.parse(await readFile(smokePublicPath(definitionPath), "utf8")));
  const [left, right] = await Promise.all(["0_1", "1_1"].map(async (key) =>
    decodeTerrainTile(await readFile(smokePublicPath(terrainTilePath(definitionPath, key))))));
  const size = definition.tileQuads + 1;
  for (let z = 0; z < size; z += 1) expect(left!.heights[z * size + size - 1], `seam row ${z}`).toBe(right!.heights[z * size]);

  // A reopened editor reads the same surface, within the u16 half step.
  await openEditor();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await editorHeights(probes))?.every((height) => height !== null) ?? false, { timeout: 30_000 }).toBe(true);
  const after = (await editorHeights(probes))!;
  console.log(`[terrain-round-trip] editor heights after reopen ${JSON.stringify(after)}`);
  const halfStep = (definition.heightMax - definition.heightMin) / 65535 / 2;
  after.forEach((height, index) => expect(Math.abs(height! - before[index]!), `probe ${probes[index]}`).toBeLessThanOrEqual(halfStep + 1e-4));
  expect(errors).toEqual([]);
});

/**
 * New Landscape from a heightmap (OPEN_WORLD_PLAN Faz 8): picking a 16-bit PNG
 * fits the grid to its size (or refuses a size no grid fills), and the created
 * terrain carries the PNG's codes as its u16 tiles over the chosen 0/65535
 * metres, all in the one Add Landscape undo step.
 */
test("New Landscape starts from a 16-bit PNG heightmap: the grid fits its size and the tiles keep its codes", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await writeLevel(HEIGHTMAP_LEVEL);
  expect((await request.post("/__open-level", { data: { path: HEIGHTMAP_LEVEL } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?editor&heightmap=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Terrain/ }).hover();
  await page.locator("[data-add-categories]").getByRole("button", { name: "Landscape", exact: true }).click();
  const dialog = page.locator("[data-world-terrain-dialog]");
  const status = dialog.locator("[data-heightmap-status]");
  const create = dialog.locator("[data-world-terrain-create]");
  await expect(dialog.locator('[data-heightmap-min]')).toBeHidden();

  // A size no grid fills is refused, never resampled.
  const ramp = (width: number, height: number) => {
    const samples = new Uint16Array(width * height);
    for (let z = 0; z < height; z += 1) for (let x = 0; x < width; x += 1) samples[z * width + x] = (x * 509 + z * 131) % 65536;
    return samples;
  };
  const odd = await encodeHeightmapPng16(100, 100, ramp(100, 100));
  await dialog.locator("[data-heightmap-file]").setInputFiles({ name: "odd.png", mimeType: "image/png", buffer: Buffer.from(odd) });
  await expect(status).toContainText("odd.png: 100 × 100 samples fit no tile grid");
  await expect(create).toBeDisabled();

  // 129 × 65: two 64-quad tiles side by side.
  const samples = ramp(129, 65);
  const png = await encodeHeightmapPng16(129, 65, samples);
  await dialog.locator("[data-heightmap-file]").setInputFiles({ name: "hills.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await expect(status).toContainText("hills.png: 129 × 65 samples → 2 × 1 tiles of 64 quads");
  await expect(dialog.locator('[data-field="tilesX"]')).toHaveValue("2");
  await expect(dialog.locator('[data-field="tilesZ"]')).toHaveValue("1");
  await expect(dialog.locator('[data-field="tileQuads"]')).toHaveValue("64");
  await expect(dialog.locator("[data-heightmap-raw]")).toBeHidden();
  await expect(dialog.locator('[data-field="heightMin"]')).toBeHidden();
  await dialog.locator("[data-heightmap-min]").fill("-10");
  await dialog.locator("[data-heightmap-max]").fill("90");
  await expect(dialog.locator("[data-open-world-notes]")).toContainText("(the heightmap's range)");
  // Changing the grid away from the heightmap blocks Create with the size it needs.
  await dialog.locator('[data-field="tilesX"]').fill("3");
  await expect(dialog.locator("[data-world-terrain-problems]")).toContainText("needs exactly 193 × 65");
  await expect(create).toBeDisabled();
  await dialog.locator('[data-field="tilesX"]').fill("2");
  await expect(create).toBeEnabled();
  await dialog.screenshot({ path: testInfo.outputPath("heightmap-dialog.png") });

  const terrainSave = saved(page, "/__save-terrain");
  const layoutSave = saved(page, "/__save-layout");
  await create.click();
  expect((await terrainSave).ok()).toBeTruthy();
  expect((await layoutSave).ok()).toBeTruthy();
  const level = JSON.parse(await readFile(smokePublicPath(HEIGHTMAP_LEVEL), "utf8"));
  const definitionPath = levelTerrainPath(HEIGHTMAP_LEVEL, level.landscapes[0].id);
  const definition = normalizeWorldTerrain(JSON.parse(await readFile(smokePublicPath(definitionPath), "utf8")));
  expect([definition.tilesX, definition.tilesZ, definition.tileQuads, definition.heightMin, definition.heightMax]).toEqual([2, 1, 64, -10, 90]);
  for (const x of [0, 1]) {
    const bytes = await readFile(smokePublicPath(terrainTilePath(definitionPath, `${x}_0`)));
    const tile = decodeTerrainTile(bytes);
    expect(tile.heightFormat).toBe("u16");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let mismatches = 0;
    for (let vz = 0; vz < 65; vz += 1) {
      for (let vx = 0; vx < 65; vx += 1) {
        if (view.getUint16(32 + (vz * 65 + vx) * 2, true) !== samples[vz * 129 + x * 64 + vx]) mismatches += 1;
      }
    }
    expect(mismatches, `tile ${x}_0 codes`).toBe(0);
  }
  // One undo removes the whole terrain.
  await page.getByTestId("editor-undo").click();
  await expect(page.getByTestId("outliner-row").filter({ hasText: "Landscape" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
