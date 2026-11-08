import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PerspectiveCamera } from "three";
import { foliageDataPath, normalizeFoliageType, type LandscapeFoliageRule } from "../../engine/scene/foliage";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import {
  createFlatTerrainTile, terrainGlobalMapPath, terrainTileHeightRange, terrainTilePath, tileKey,
  type TerrainTileData, type WorldTerrainDef,
} from "../../engine/terrain/terrainTypes";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { expect, test, type Page } from "./test";
import { SMOKE_SPLINE_SCENE, smokePublicPath } from "./smokeProject.mjs";

/**
 * Far foliage billboards: a Landscape rule whose type has a Far Distance past
 * its Cull End grows impostors out to that distance, in the editor and in Play.
 * The world is 2 km wide and Play keeps only ~512 m of tiles resident, so the
 * far blocks must grow from the global map. The impostor shader must compile,
 * and the type's Far Tint reaches the terrain renderer.
 */

const LEVEL = "layouts/__playwright-far-foliage.level.json";
const TERRAIN = "landscapes/__playwright-far-world.terrain.json";
const Q = 64;
const TILES = 8;

function fixture(): { def: WorldTerrainDef; tiles: Map<string, TerrainTileData> } {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Far World", tileQuads: Q, spacing: 4, tilesX: TILES, tilesZ: TILES,
    origin: [-1024, 0, -1024], heightMin: -64, heightMax: 64,
    layers: [{ id: "grass", name: "Grass", color: "#4f7f3a" }],
    tiles: [], collision: true,
  };
  const tiles = new Map<string, TerrainTileData>();
  for (let tz = 0; tz < TILES; tz += 1) {
    for (let tx = 0; tx < TILES; tx += 1) {
      const tile = createFlatTerrainTile(def, tx, tz);
      for (let z = 0; z <= Q; z += 1) {
        for (let x = 0; x <= Q; x += 1) {
          const gx = tx * Q + x, gz = tz * Q + z;
          tile.heights[z * (Q + 1) + x] = Math.fround(8 * Math.sin(gx * 0.02) * Math.cos(gz * 0.017));
          tile.weights[(z * (Q + 1) + x) * 4] = 255;
        }
      }
      const range = terrainTileHeightRange(tile);
      def.tiles.push({ key: tileKey(tx, tz), minHeight: range.min, maxHeight: range.max });
      tiles.set(tileKey(tx, tz), tile);
    }
  }
  return { def, tiles };
}

const world = fixture();
const SPAWN: [number, number] = [-700, -700];
const SPAWN_GROUND = terrainHeightAt(world.def, { tile: (x, z) => world.tiles.get(tileKey(x, z)) }, SPAWN[0], SPAWN[1])!;

async function write(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(smokePublicPath(path)), { recursive: true });
  await writeFile(smokePublicPath(path), data);
}

async function writeFixture(typeId: string): Promise<void> {
  for (const [key, tile] of world.tiles) {
    await write(terrainTilePath(TERRAIN, key), encodeTerrainTile(tile, { heightMin: -64, heightMax: 64, heightFormat: "f32" }));
  }
  await write(terrainGlobalMapPath(TERRAIN), encodeTerrainGlobalMap(world.def,
    buildTerrainGlobalAttributes(worldTerrainRenderSource(world.def, world.tiles))));
  await write(TERRAIN, JSON.stringify(world.def, null, 2));
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  level.name = "__playwright-far-foliage";
  level.instances = level.instances.filter((group: { assetId: string }) => group.assetId === "marker:playerStart");
  level.instances[0].placements = [{ ...level.instances[0].placements[0], position: [SPAWN[0], SPAWN_GROUND + 2, SPAWN[1]] }];
  level.riverWaters = [];
  level.landscapes = [{ id: "world", name: "Far World", position: worldTerrainActorPosition(world.def), dataRef: TERRAIN }];
  await write(LEVEL, JSON.stringify(level, null, 2));

  const typePath = `assets/${typeId}.foliagetype.json`;
  const manifestPath = smokePublicPath("assets/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const mesh = manifest.assets.find((asset: { id: string }) => asset.id === "forest-tree-01");
  if (!mesh) throw new Error("smoke manifest has no forest-tree-01");
  if (!manifest.assets.some((asset: { id: string }) => asset.id === typeId)) {
    manifest.assets.push({ ...mesh, id: typeId, name: "Far Trees", assetType: "foliageType", path: typePath, placeable: false });
    await writeFile(manifestPath, JSON.stringify(manifest));
  }
  await write(typePath, JSON.stringify(normalizeFoliageType({
    name: "Far Trees", meshAssetId: mesh.id, alignToNormal: false, cullEnd: 150, farDistance: 1500, farTint: 0.8,
  })));
  const rule: LandscapeFoliageRule = { id: "far-rule", landscapeId: "world", layerId: "grass", foliageTypeId: typeId, density: 0.01, minWeight: 0, seed: 3 };
  await write(foliageDataPath(LEVEL), JSON.stringify({
    schema: 1, type: "foliage",
    groups: [{ id: "painted", foliageTypeId: typeId, target: { kind: "landscape", id: "world" }, instances: [] }],
    landscapeRules: [rule],
  }));
}

/** The far tint window `[start, end]` of every World Terrain renderer in the captured scenes. */
function farTints(page: Page): Promise<number[][]> {
  return page.evaluate(() => {
    const out: number[][] = [];
    for (const scene of (window as unknown as { __scenes: any[] }).__scenes) {
      scene.traverse((node: any) => {
        const terrain = node.userData?.forgeTerrain;
        const value = terrain?.materials?.uniforms?.uTerrainFarTint?.value;
        if (value) out.push([value.x, value.y]);
      });
    }
    return out;
  });
}

/** Billboards in every captured scene: blocks and instances. */
function farCount(page: Page): Promise<{ blocks: number; instances: number }> {
  return page.evaluate(() => {
    let blocks = 0, instances = 0;
    for (const scene of (window as unknown as { __scenes: any[] }).__scenes) {
      scene.traverse((node: any) => {
        if (node.isInstancedMesh && node.name?.startsWith("foliage-far:")) { blocks += 1; instances += node.count; }
      });
    }
    return { blocks, instances };
  });
}

test("far foliage billboards grow past the cull distance from the global map, in the editor and in Play", async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await writeFixture("__playwright-far-trees");
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  const camera = new PerspectiveCamera();
  camera.position.set(SPAWN[0], SPAWN_GROUND + 40, SPAWN[1]);
  camera.lookAt(0, 0, 0);
  const pose = JSON.stringify({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] });
  await page.addInitScript(({ key, pose }) => {
    localStorage.clear();
    localStorage.setItem(key, pose);
    // A fixed profile (cull scale 0.85: billboards to 1275 m): hardware hints would pick one at random.
    localStorage.setItem("forge.userSettings", JSON.stringify({
      schema: 1,
      updatedAt: new Date().toISOString(),
      payload: { graphics: { selectedQualityLevel: "high", manuallySelected: true, adaptiveOptimizationEnabled: false } },
    }));
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __scenes: unknown[] };
    w.__scenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail as { isScene?: boolean } | null;
      if (object?.isScene) w.__scenes.push(object);
    });
  }, { key: `forge.editor.cameraPose.${encodeURIComponent(LEVEL)}`, pose });

  await page.goto(`/?editor&far=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("outliner-row").filter({ hasText: "Far World" }).first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await farCount(page)).instances, { timeout: 60_000 }).toBeGreaterThan(500);
  // Far Tint: the terrain blends toward the trees from their cull distance (150 m) out.
  await expect.poll(() => farTints(page), { timeout: 30_000 }).toContainEqual([150, 300]);
  // A few frames with billboards on screen: the impostor program must compile.
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);

  await page.goto(`/?debug&farPlay=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  const play = await farCount(page);
  expect(play.blocks).toBeGreaterThan(4);
  expect(play.instances).toBeGreaterThan(500);
  // Play's high profile scales the cull distance by 0.85.
  await expect.poll(() => farTints(page), { timeout: 30_000 }).toContainEqual([127.5, 255]);
  await page.waitForTimeout(1500);
  expect(messages.some((message) => message.includes("impostor bake failed"))).toBe(false);
  expect(errors).toEqual([]);
});
