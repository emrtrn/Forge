import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { createFlatTerrainTile, terrainGlobalMapPath, terrainTileHeightRange, terrainTilePath, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { expect, test } from "./test";
import { SMOKE_SPLINE_SCENE, smokePublicPath } from "./smokeProject.mjs";

const LEVEL = "layouts/__playwright-terrain-streaming.level.json";
const TERRAIN = "landscapes/__playwright-streaming.terrain.json";
const Q = 64;
const SPAWN: [number, number] = [32, 352];

function fixture() {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Streaming smoke", tileQuads: Q, spacing: 1, tilesX: 6, tilesZ: 6,
    origin: [0, 2, 0], heightMin: -16, heightMax: 32,
    layers: [{ id: "grass", name: "Grass", color: "#4f7f3a" }], tiles: [], collision: true,
  };
  const tiles = new Map<string, TerrainTileData>();
  for (let tz = 0; tz < 6; tz += 1) for (let tx = 0; tx < 6; tx += 1) {
    const key = tileKey(tx, tz);
    const tile = createFlatTerrainTile(def, tx, tz);
    for (let z = 0; z <= Q; z += 1) for (let x = 0; x <= Q; x += 1) {
      tile.heights[z * (Q + 1) + x] = Math.fround(5 + 0.003 * (tx * Q + x) + 0.002 * (tz * Q + z));
    }
    const range = terrainTileHeightRange(tile);
    def.tiles.push({ key, minHeight: range.min, maxHeight: range.max });
    tiles.set(key, tile);
  }
  return { def, tiles };
}

const world = fixture();
const lookup = { tile: (x: number, z: number) => world.tiles.get(tileKey(x, z)) };

async function writeFixture() {
  const write = async (path: string, data: string | Uint8Array) => {
    await mkdir(dirname(smokePublicPath(path)), { recursive: true });
    await writeFile(smokePublicPath(path), data);
  };
  for (const [key, tile] of world.tiles) await write(terrainTilePath(TERRAIN, key), encodeTerrainTile(tile, {
    heightMin: world.def.heightMin, heightMax: world.def.heightMax, heightFormat: "f32",
  }));
  await write(terrainGlobalMapPath(TERRAIN), encodeTerrainGlobalMap(world.def, buildTerrainGlobalAttributes(worldTerrainRenderSource(world.def, world.tiles))));
  await write(TERRAIN, JSON.stringify(world.def));
  const playerPath = "assets/__playwright-streaming-player.actor.json";
  const modePath = "assets/__playwright-streaming-mode.actor.json";
  const player = JSON.parse(await readFile(smokePublicPath("assets/starter-content/Gameplay/Script_PlayerCharacter.actor.json"), "utf8"));
  // Walk across five tiles in a few seconds, using normal input and possession.
  player.components.find((c: { component: string }) => c.component === "CharacterMovement").props.maxWalkSpeed = 60;
  await write(playerPath, JSON.stringify(player));
  const mode = JSON.parse(await readFile(smokePublicPath("assets/starter-content/Gameplay/Script_GameMode.actor.json"), "utf8"));
  mode.variables.find((v: { key: string }) => v.key === "defaultPawnClassRef").default = playerPath;
  await write(modePath, JSON.stringify(mode));
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  level.name = "__playwright-terrain-streaming";
  level.worldSettings.gameMode = modePath;
  level.instances = level.instances.filter((group: { assetId: string }) => group.assetId === "marker:playerStart");
  level.instances[0].placements = [{ ...level.instances[0].placements[0], position: [SPAWN[0], terrainHeightAt(world.def, lookup, ...SPAWN)! + 2, SPAWN[1]] }];
  level.riverWaters = [];
  level.landscapes = [{ id: "stream", name: "World Terrain", position: worldTerrainActorPosition(world.def), dataRef: TERRAIN }];
  await write(LEVEL, JSON.stringify(level));
}

function readStats(text: string) {
  const counts = text.match(/terrain streaming: loaded:(\d+) active:(\d+) queued:(\d+) physics:(\d+)/);
  const position = text.match(/pos: (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/);
  if (!counts || !position) throw new Error(`Missing streaming/pawn stats:\n${text}`);
  return { loaded: Number(counts[1]), active: Number(counts[2]), queued: Number(counts[3]), physics: Number(counts[4]),
    x: Number(position[1]), y: Number(position[2]), z: Number(position[3]),
    keys: (text.match(/terrain active:([^\n]*)/)?.[1] ?? "").trim().split(/\s+/),
    colliders: (text.match(/terrain physics:([^\n]*)/)?.[1] ?? "").trim().split(/\s+/) };
}

test("Play streams a bounded subset of 6x6 terrain, activates destination heightfields and releases the spawn corner without falling", async ({ page, request }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const requested = new Set<string>();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (req) => { if (req.url().includes("__playwright-streaming.tiles/")) requested.add(req.url()); });
  await writeFixture();
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.addInitScript(() => {
    localStorage.clear();
    // Every loading-overlay status line, so a quick phase cannot slip between polls.
    const statuses: string[] = [];
    (window as unknown as { loadingStatuses: string[] }).loadingStatuses = statuses;
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.classList.contains("forge-loading-status")) statuses.push(target.textContent ?? "");
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto(`/?debug&streaming=${Date.now()}`);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 60_000 });
  const overlay = page.locator("#debug-stats");
  await expect(overlay).toContainText("terrain streaming:", { timeout: 30_000 });
  await expect(overlay).toContainText("movement: walking (grounded)", { timeout: 30_000 });
  await expect(overlay).toContainText(/queued:0 physics:/, { timeout: 30_000 });
  const start = readStats((await overlay.textContent())!);
  expect(start.loaded).toBeGreaterThan(0);
  expect(start.loaded).toBeLessThan(36);
  expect(requested.size).toBeLessThan(36);
  expect(start.keys).toContain("0_5");
  expect(start.physics).toBeLessThan(start.active);
  expect(Math.abs(start.y - terrainHeightAt(world.def, lookup, start.x, start.z)!)).toBeLessThan(0.2);
  // The ?debug map draws one square per tile: 36 here, the spawn corner with colliders.
  const map = page.locator(".forge-debug-panel-map");
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("data-tiles", /physics:\d+/);
  const tally: Record<string, number> = Object.fromEntries((await map.getAttribute("data-tiles"))!.split(" ").map((entry) => [entry.split(":")[0], Number(entry.split(":")[1])]));
  expect(Object.values(tally).reduce((sum, count) => sum + count, 0)).toBe(36);
  expect(tally.unloaded).toBeGreaterThan(0);
  expect((await map.boundingBox())!.width).toBeGreaterThan(100);
  await testInfo.attach("spawn.png", { body: await page.screenshot(), contentType: "image/png" });

  // Initial TPS control yaw faces -Z. W+D runs from (0,5) towards (5,0).
  const trail: string[] = [];
  await page.keyboard.down("w");
  await page.keyboard.down("d");
  try {
    await expect.poll(async () => {
      const current = readStats((await overlay.textContent())!);
      trail.push(`${current.x.toFixed(1)},${current.y.toFixed(2)},${current.z.toFixed(1)} a${current.active} p${current.physics}`);
      const ground = terrainHeightAt(world.def, lookup, current.x, current.z);
      expect(ground).not.toBeNull();
      expect(current.y).toBeGreaterThan(ground! - 0.2);
      return current.x > 294 && current.z < 90;
      // ~400 m at run speed takes ~25 s; the margin covers slow CI machines.
    }, { timeout: 150_000, intervals: [250] }).toBeTruthy();
  } finally {
    console.log(`[terrain-streaming] trail ${trail.filter((_, index) => index % 40 === 0).concat(trail.slice(-3)).join(" | ")}`);
    await page.keyboard.up("w");
    await page.keyboard.up("d");
  }
  await expect(overlay).toContainText("movement: walking (grounded)");
  await expect.poll(async () => readStats((await overlay.textContent())!).keys.includes("0_5"), { timeout: 20_000 }).toBe(false);
  await expect(overlay).toContainText(/queued:0 physics:/, { timeout: 30_000 });
  const end = readStats((await overlay.textContent())!);
  const key = tileKey(Math.floor(end.x / Q), Math.floor(end.z / Q));
  expect(end.colliders).toContain(key);
  expect(end.colliders).not.toContain("0_5");
  expect(end.loaded).toBeLessThan(36);
  expect(end.active).toBeLessThan(36);
  expect(Math.abs(end.y - terrainHeightAt(world.def, lookup, end.x, end.z)!)).toBeLessThan(0.2);
  expect(requested.size).toBeGreaterThan(start.active);
  await testInfo.attach("destination.png", { body: await page.screenshot(), contentType: "image/png" });
  console.log(`[terrain-streaming] spawn ${JSON.stringify(start)}; destination ${JSON.stringify(end)}`);

  // Save here, then load: the level rebuilds around the far spawn corner and the
  // restore moves the pawn back here, so the load must block until this area is
  // streamed instead of handing over a pawn held on unloaded terrain.
  await page.keyboard.press("Escape");
  await page.locator('[data-ui-id="quick-save"]').click();
  await expect(page.locator('[data-ui-id="quick-load"]')).toBeEnabled();
  await page.evaluate(() => { (window as unknown as { loadingStatuses: string[] }).loadingStatuses.length = 0; });
  await page.locator('[data-ui-id="quick-load"]').click();
  await expect(page.locator(".forge-loading")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 60_000 });
  const statuses = await page.evaluate(() => (window as unknown as { loadingStatuses: string[] }).loadingStatuses);
  expect(statuses).toContain("Loading terrain around spawn");
  expect(statuses).toContain("Loading terrain around player");
  await expect.poll(async () => {
    const restored = readStats((await overlay.textContent())!);
    return Math.hypot(restored.x - end.x, restored.z - end.z) < 1 && !restored.keys.includes("0_5");
  }, { timeout: 15_000 }).toBe(true);
  const restoredText = (await overlay.textContent())!;
  expect(restoredText).not.toContain("(holding pawn)");
  const restored = readStats(restoredText);
  expect(restored.colliders).toContain(tileKey(Math.floor(restored.x / Q), Math.floor(restored.z / Q)));
  expect(Math.abs(restored.y - terrainHeightAt(world.def, lookup, restored.x, restored.z)!)).toBeLessThan(0.2);
  expect(errors).toEqual([]);
});
