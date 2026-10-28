import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RoomLayout } from "../../engine/scene/layout";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { levelTerrainPath, terrainGlobalMapPath, terrainTilePath, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { createFlatWorldTerrain } from "../../engine/terrain/worldTerrainCreate";
import { createWorldRecipe, worldRecipePath, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { expect, test } from "./test";
import { REPO_ROOT, smokePublicPath } from "./smokeProject.mjs";

/**
 * World Builder F1 steps 5b and 6b: the left panel's World Builder tab reads
 * the open level's recipe, a Dry Run reports without changing the level, Apply
 * adds the plan blockout (placements) or the roads (World Terrain splines) as
 * one undo step, Save Layout writes the recipe first, then the terrain and the
 * level, and after a reload each stage is up to date.
 */
const LEVEL = "layouts/__playwright-world-builder.level.json";
const MARKERS = ["wb-blockout-settlement-village", "wb-blockout-settlement-hamlet", "wb-blockout-landmark-depot"];

async function writeFileIn(path: string, data: string | Uint8Array) {
  await mkdir(dirname(smokePublicPath(path)), { recursive: true });
  await writeFile(smokePublicPath(path), data);
}

const writeJson = (path: string, value: unknown) => writeFileIn(path, `${JSON.stringify(value, null, 2)}\n`);

const readJson = async <T>(path: string) => JSON.parse(await readFile(smokePublicPath(path), "utf8")) as T;

function cubeIds(level: RoomLayout): string[] {
  return (level.instances.find((group) => group.assetId === "shape:cube")?.placements ?? [])
    .flatMap((placement) => (placement.id ? [placement.id] : []))
    .sort();
}

test("World Builder tab: dry run, apply as one undo step, save the recipe, up to date after reload", async ({ page, request }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  const base = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  await writeJson(LEVEL, { ...base, name: "__playwright-world-builder" });
  const recipe = createWorldRecipe("playwright_world_builder", 4);
  recipe.plan.settlements.push(
    { id: "village", source: "reference", observed: true, confidence: 0.8, center: [6, 4], type: "village" },
    { id: "hamlet", source: "manual", center: [-8, -6], type: "hamlet" },
  );
  recipe.plan.landmarks.push({ id: "depot", source: "manual", kind: "logistics.depot", position: [0, 10] });
  await writeJson(worldRecipePath(LEVEL), recipe);
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1440, height: 900 });

  const bootEditor = async () => {
    await page.goto(`/?editor&worldBuilder=${Date.now()}`);
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("world-builder-tab").click();
    await expect(page.getByTestId("world-builder-recipe")).toContainText("playwright_world_builder", { timeout: 30_000 });
  };
  const markerRows = () => page.getByTestId("outliner-row")
    .filter({ has: page.locator("strong", { hasText: /^(village|hamlet|depot)$/ }) });

  await bootEditor();
  await expect(page.getByTestId("world-builder-panel")).toContainText("Plan: 2 settlements, 1 landmarks");

  await page.getByTestId("world-builder-dry-run-planBlockout").click();
  await expect(page.getByTestId("world-builder-counts")).toHaveText("+3 added · ~0 updated · −0 removed · 0 unchanged");
  await expect(page.getByTestId("world-builder-recipe")).not.toContainText("unsaved");

  await page.getByTestId("world-builder-apply-planBlockout").click();
  await expect(page.getByTestId("world-builder-recipe")).toContainText("unsaved");
  await expect(page.getByTestId("world-builder-panel")).toContainText("3 generated objects");
  await page.locator('[data-outliner-tab="scene"]').click();
  await expect(markerRows()).toHaveCount(3);

  await page.getByTestId("editor-undo").click();
  await expect(markerRows()).toHaveCount(0);
  await page.getByTestId("editor-redo").click();
  await expect(markerRows()).toHaveCount(3);

  const recipeSaved = page.waitForResponse((res) => res.url().endsWith("/__save-worldrecipe") && res.request().method() === "POST");
  const layoutSaved = page.waitForResponse((res) => res.url().endsWith("/__save-layout") && res.request().method() === "POST");
  await page.getByTestId("editor-save").click();
  expect((await recipeSaved).ok()).toBeTruthy();
  expect((await layoutSaved).ok()).toBeTruthy();

  const savedRecipe = await readJson<WorldRecipe>(worldRecipePath(LEVEL));
  expect(Object.keys(savedRecipe.ownership.placements).sort()).toEqual([...MARKERS].sort());
  expect(savedRecipe.generators).toEqual({ planBlockout: 1 });
  expect(cubeIds(await readJson<RoomLayout>(LEVEL))).toEqual([...MARKERS].sort());

  await bootEditor();
  await expect(page.getByTestId("world-builder-recipe")).not.toContainText("unsaved");
  await page.getByTestId("world-builder-dry-run-planBlockout").click();
  await expect(page.getByTestId("world-builder-report")).toContainText("Up to date");
  await expect(page.getByTestId("world-builder-counts")).toHaveText("+0 added · ~0 updated · −0 removed · 3 unchanged");
  expect(errors).toEqual([]);
});

const ROADS_LEVEL = "layouts/__playwright-world-builder-roads.level.json";
const TERRAIN_ID = "wb-terrain";
const TERRAIN_REF = levelTerrainPath(ROADS_LEVEL, TERRAIN_ID);
const ROADS = ["wb-road-main", "wb-road-spur"];

test("World Builder roads: apply writes terrain splines as one undo step, recipe saves first, up to date after reload", async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  // One flat 64 m tile at y = 3 (x, z in -32..32) holding a hand-made spline.
  const world = createFlatWorldTerrain({ name: "WB Terrain", tilesX: 1, tilesZ: 1, tileQuads: 64, spacing: 1, baseHeight: 3 });
  world.def.splines = [{
    id: "spline-1", coordinateSpace: "world",
    points: [{ id: "p0", position: [-20, 3, -20], width: 6, falloff: 3 }, { id: "p1", position: [-10, 3, -20], width: 6, falloff: 3 }],
    segments: [{ id: "s0", startPointId: "p0", endPointId: "p1" }],
  }];
  for (const [key, tile] of world.tiles) {
    await writeFileIn(terrainTilePath(TERRAIN_REF, key), encodeTerrainTile(tile, { ...world.def, heightFormat: "f32" }));
  }
  await writeFileIn(TERRAIN_REF, JSON.stringify(world.def));
  await writeFileIn(terrainGlobalMapPath(TERRAIN_REF), encodeTerrainGlobalMap(world.def,
    buildTerrainGlobalAttributes(worldTerrainRenderSource(world.def, world.tiles))));
  const base = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  await writeJson(ROADS_LEVEL, {
    ...base, name: "__playwright-world-builder-roads",
    landscapes: [{ id: TERRAIN_ID, name: "WB Terrain", position: worldTerrainActorPosition(world.def), dataRef: TERRAIN_REF }],
  });
  const recipe = createWorldRecipe("playwright_world_builder_roads", 4);
  recipe.plan.roadGraph.nodes.push(
    { id: "west", source: "manual", position: [-25, 0], kind: "end" },
    { id: "east", source: "manual", position: [25, 0], kind: "junction" },
    { id: "north", source: "manual", position: [25, 25], kind: "end" },
  );
  recipe.plan.roadGraph.edges.push(
    { id: "main", source: "manual", from: "west", to: "east", roadClass: "local" },
    { id: "spur", source: "manual", from: "east", to: "north", roadClass: "track", guide: [[15, 10], [15, 20]] },
  );
  await writeJson(worldRecipePath(ROADS_LEVEL), recipe);
  expect((await request.post("/__open-level", { data: { path: ROADS_LEVEL } })).ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1440, height: 900 });

  const bootEditor = async () => {
    await page.goto(`/?editor&worldBuilderRoads=${Date.now()}`);
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("world-builder-tab").click();
    await expect(page.getByTestId("world-builder-recipe")).toContainText("playwright_world_builder_roads", { timeout: 30_000 });
  };
  const savedSplineIds = async () =>
    ((await readJson<WorldTerrainDef>(TERRAIN_REF)).splines ?? []).map((spline) => spline.id).sort();
  /** Save Layout; returns the order of the recipe / terrain definition / level writes. */
  const save = async () => {
    const order: string[] = [];
    const onRequest = (req: { url(): string; method(): string }) => {
      if (req.method() !== "POST") return;
      const url = new URL(req.url());
      if (url.pathname === "/__save-worldrecipe") order.push("recipe");
      else if (url.pathname === "/__save-terrain" && !url.search) order.push("terrain");
      else if (url.pathname === "/__save-layout") order.push("level");
    };
    page.on("request", onRequest);
    const layoutSaved = page.waitForResponse((res) => res.url().endsWith("/__save-layout") && res.request().method() === "POST");
    await page.getByTestId("editor-save").click();
    expect((await layoutSaved).ok()).toBeTruthy();
    await expect(page.getByTestId("world-builder-recipe")).not.toContainText("unsaved");
    page.off("request", onRequest);
    return order;
  };

  await bootEditor();
  await expect(page.getByTestId("world-builder-panel")).toContainText("3 road nodes, 2 road edges");

  await page.getByTestId("world-builder-dry-run-roads").click();
  await expect(page.getByTestId("world-builder-counts")).toHaveText("+2 added · ~0 updated · −0 removed · 0 unchanged");
  await expect(page.getByTestId("world-builder-report")).toContainText("no region profile road spec for local");
  await expect(page.getByTestId("world-builder-recipe")).not.toContainText("unsaved");

  await page.getByTestId("world-builder-apply-roads").click();
  await expect(page.getByTestId("world-builder-recipe")).toContainText("unsaved");
  await expect(page.getByTestId("world-builder-panel")).toContainText("2 generated objects");
  expect(await save()).toEqual(["recipe", "terrain", "level"]);
  expect(await savedSplineIds()).toEqual(["spline-1", ...ROADS]);
  const saved = await readJson<WorldTerrainDef>(TERRAIN_REF);
  const main = saved.splines!.find((spline) => spline.id === "wb-road-main")!;
  expect(main.coordinateSpace).toBe("world");
  expect(main.points.map((point) => point.position)).toEqual([[-25, 3, 0], [-15, 3, 0], [-5, 3, 0], [5, 3, 0], [15, 3, 0], [25, 3, 0]]);
  expect(main.segments.every((segment) => segment.deform?.enabled && segment.mesh === undefined)).toBe(true);
  expect(saved.tiles).toEqual(world.def.tiles);
  const savedRecipe = await readJson<WorldRecipe>(worldRecipePath(ROADS_LEVEL));
  expect(Object.keys(savedRecipe.ownership.splines)).toEqual(ROADS);
  expect(savedRecipe.ownership.splines["wb-road-spur"]!.edge).toBe("spur");
  expect(savedRecipe.generators).toEqual({ roads: 3 });

  // Undo and redo swap the terrain's splines and the recipe together.
  await page.getByTestId("editor-undo").click();
  await expect(page.getByTestId("world-builder-panel")).toContainText("0 generated objects");
  expect(await save()).toEqual(["recipe", "terrain", "level"]);
  expect(await savedSplineIds()).toEqual(["spline-1"]);
  expect((await readJson<WorldRecipe>(worldRecipePath(ROADS_LEVEL))).ownership.splines).toEqual({});
  await page.getByTestId("editor-redo").click();
  await expect(page.getByTestId("world-builder-panel")).toContainText("2 generated objects");
  await save();
  expect(await savedSplineIds()).toEqual(["spline-1", ...ROADS]);

  await bootEditor();
  await page.getByTestId("world-builder-dry-run-roads").click();
  await expect(page.getByTestId("world-builder-report")).toContainText("Up to date");
  await expect(page.getByTestId("world-builder-counts")).toHaveText("+0 added · ~0 updated · −0 removed · 2 unchanged");
  expect(errors).toEqual([]);
});

const VILLAGE_LEVEL = "layouts/__playwright-world-builder-village.level.json";
const VILLAGE_TERRAIN_REF = levelTerrainPath(VILLAGE_LEVEL, TERRAIN_ID);
const VILLAGE_PROFILE = "layouts/__playwright-world-builder.regionprofile.json";
const VILLAGE_STAGES = ["roads", "settlementSites", "streets", "parcels", "landUse", "buildings"];

/**
 * World Builder F1 steps 9–12: the settlement chain on a slope — roads, site,
 * inner streets, parcels, land use, coloured building placeholders — then
 * Apply Pads bakes the pads into the terrain; everything saves, and after a
 * reload the buildings are up to date with their baked pads.
 */
test("World Builder village: the settlement chain places coloured buildings, Apply Pads bakes their pads", async ({ page, request }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  // 2 × 2 tiles of 128 m at 2 m spacing (x, z in -128..128), rising 6 cm per metre north.
  const world = createFlatWorldTerrain({ name: "WB Village", tilesX: 2, tilesZ: 2, tileQuads: 64, spacing: 2, baseHeight: 3 });
  for (const [key, tile] of world.tiles) {
    for (let iz = 0; iz < tile.size; iz += 1) {
      for (let ix = 0; ix < tile.size; ix += 1) {
        const worldZ = world.def.origin[2] + (tile.z * world.def.tileQuads + iz) * world.def.spacing;
        tile.heights[iz * tile.size + ix] = 0.06 * worldZ;
      }
    }
    const summary = world.def.tiles.find((entry) => entry.key === key)!;
    summary.minHeight = Math.min(...tile.heights);
    summary.maxHeight = Math.max(...tile.heights);
  }
  const tileBytes = new Map<string, Uint8Array>();
  for (const [key, tile] of world.tiles) {
    const bytes = encodeTerrainTile(tile, { ...world.def, heightFormat: "f32" });
    tileBytes.set(key, bytes);
    await writeFileIn(terrainTilePath(VILLAGE_TERRAIN_REF, key), bytes);
  }
  await writeFileIn(VILLAGE_TERRAIN_REF, JSON.stringify(world.def));
  await writeFileIn(terrainGlobalMapPath(VILLAGE_TERRAIN_REF), encodeTerrainGlobalMap(world.def,
    buildTerrainGlobalAttributes(worldTerrainRenderSource(world.def, world.tiles))));
  await writeFileIn(VILLAGE_PROFILE, await readFile(resolve(REPO_ROOT, "tests/engine/fixtures/neutral.regionprofile.json"), "utf8"));
  const base = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  await writeJson(VILLAGE_LEVEL, {
    ...base, name: "__playwright-world-builder-village",
    landscapes: [{ id: TERRAIN_ID, name: "WB Village", position: worldTerrainActorPosition(world.def), dataRef: VILLAGE_TERRAIN_REF }],
  });
  const recipe = createWorldRecipe("playwright_world_builder_village", 4);
  recipe.regionProfile = VILLAGE_PROFILE;
  recipe.plan.settlements.push({ id: "village", source: "manual", center: [0, 0], radius: 40, type: "village", population: 45 });
  recipe.plan.roadGraph.nodes.push(
    { id: "west", source: "manual", position: [-120, 0], kind: "end" },
    { id: "east", source: "manual", position: [120, 0], kind: "end" },
  );
  recipe.plan.roadGraph.edges.push({ id: "main", source: "manual", from: "west", to: "east", roadClass: "local" });
  await writeJson(worldRecipePath(VILLAGE_LEVEL), recipe);
  expect((await request.post("/__open-level", { data: { path: VILLAGE_LEVEL } })).ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1440, height: 900 });

  const bootEditor = async () => {
    await page.goto(`/?editor&worldBuilderVillage=${Date.now()}`);
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("world-builder-tab").click();
    await expect(page.getByTestId("world-builder-recipe")).toContainText("playwright_world_builder_village", { timeout: 30_000 });
  };
  const save = async () => {
    const layoutSaved = page.waitForResponse((res) => res.url().endsWith("/__save-layout") && res.request().method() === "POST");
    await page.getByTestId("editor-save").click();
    expect((await layoutSaved).ok()).toBeTruthy();
    await expect(page.getByTestId("world-builder-recipe")).not.toContainText("unsaved");
  };

  await bootEditor();
  await expect(page.getByTestId("world-builder-panel")).toContainText("Neutral test profile (loaded)");
  await expect(page.getByTestId("world-builder-apply-pads")).toBeDisabled();
  for (const stage of VILLAGE_STAGES) {
    await page.getByTestId(`world-builder-apply-${stage}`).click();
    await expect(page.getByTestId("world-builder-report")).toContainText("Changes pending");
    await expect(page.getByTestId("world-builder-report")).not.toContainText("Errors");
  }
  await expect(page.getByTestId("world-builder-apply-pads")).toBeEnabled();
  await page.getByTestId("world-builder-apply-pads").click();
  await save();

  const savedRecipe = await readJson<WorldRecipe>(worldRecipePath(VILLAGE_LEVEL));
  expect(Object.keys(savedRecipe.generators).sort()).toEqual([...VILLAGE_STAGES].sort());
  const buildings = ((await readJson<RoomLayout>(VILLAGE_LEVEL)).instances.find((group) => group.assetId === "shape:cube")?.placements ?? [])
    .filter((placement) => placement.id?.startsWith("wb-building-"));
  expect(buildings.length).toBeGreaterThan(5);
  expect(buildings.every((placement) => /^#[0-9a-f]{6}$/i.test(placement.color ?? "") && placement.role)).toBe(true);
  expect(savedRecipe.generated.pads.map((pad) => pad.id).sort()).toEqual(buildings.map((placement) => placement.id).sort());
  // The pads changed the ground under the village.
  let changed = 0;
  for (const [key, bytes] of tileBytes) {
    const saved = new Uint8Array(await readFile(smokePublicPath(terrainTilePath(VILLAGE_TERRAIN_REF, key))));
    if (Buffer.compare(Buffer.from(saved), Buffer.from(bytes)) !== 0) changed += 1;
  }
  expect(changed).toBeGreaterThan(0);

  // Apply Pads levelled the ground: stages reading it near the pads (sites, streets, parcels) would
  // re-sample, but land use does not read the ground and buildings stand on their own pads.
  await bootEditor();
  for (const stage of ["landUse", "buildings"]) {
    await page.getByTestId(`world-builder-dry-run-${stage}`).click();
    await expect(page.getByTestId("world-builder-report")).toContainText("Up to date");
  }
  expect(errors).toEqual([]);
});
