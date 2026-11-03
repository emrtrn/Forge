import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { createFlatTerrainTile, terrainTilePath, terrainGlobalMapPath, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { worldTerrainRenderSource, buildTerrainGlobalAttributes } from "../../engine/terrain/terrainRenderSource";
import { expect, test } from "./test";
import { SMOKE_SPLINE_SCENE, smokePublicPath } from "./smokeProject.mjs";

test("Puddle live bed follows real Rapier wheel tracks, preserves level and suppresses the duplicate terrain film", async ({ page }, info) => {
  test.setTimeout(240_000);
  const terrainPath = "landscapes/__playwright-puddle-bed.terrain.json", levelPath = "layouts/__playwright-puddle-bed.level.json";
  const def: WorldTerrainDef = { schema: 1, type: "worldTerrain", name: "Mud basin", tileQuads: 32, spacing: 1,
    tilesX: 1, tilesZ: 1, origin: [-16, 0, -16], heightMin: -2, heightMax: 4, collision: true,
    layers: [{ id: "mud", name: "Mud", color: "#493226", physicalMaterial: "mud" }], tiles: [{ key: "0_0", minHeight: .19, maxHeight: 4 }] };
  const tile = createFlatTerrainTile(def, 0, 0);
  for (let z = 0; z < tile.size; z++) for (let x = 0; x < tile.size; x++) tile.heights[z * tile.size + x] = .19 + Math.max(0, Math.max(Math.abs(x - 16), Math.abs(z - 16)) - 6) * .3;
  const write = async (path: string, data: string | Uint8Array) => { await mkdir(dirname(smokePublicPath(path)), { recursive: true }); await writeFile(smokePublicPath(path), data); };
  await write(terrainPath, JSON.stringify(def));
  const binaryPath = terrainTilePath(terrainPath, "0_0"), globalPath = terrainGlobalMapPath(terrainPath);
  await write(binaryPath, encodeTerrainTile(tile, { heightMin: -2, heightMax: 4, heightFormat: "f32" }));
  await write(globalPath, encodeTerrainGlobalMap(def, buildTerrainGlobalAttributes(worldTerrainRenderSource(def, new Map([["0_0", tile]])))));
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  level.instances = []; level.actors = [{ classRef: "assets/starter-content/Gameplay/Script_ReferenceCar.actor.json", position: [0, 1.2, -2], rotationYDeg: 0, scale: 1 }];
  level.characters = []; level.riverWaters = []; level.waterBodies = []; delete level.postProcess; delete level.foliage;
  level.landscapes = [{ id: "terrain", name: "Mud basin", position: [0, 0, 0], dataRef: terrainPath }];
  level.puddleWaters = [{ schema: 1, kind: "puddle", coordinateSpace: "world", id: "puddle-1", terrainRef: "terrain",
    seed: [0, 0], bounds: { min: [-8, -8], max: [8, 8] }, surfaceLevel: .2, appearance: { color: "#537f91", opacity: .6, reflectionMode: "environment" } }];
  level.worldSettings = { ...level.worldSettings, gameMode: "forge.vehicle", killZ: -10 };
  await write(levelPath, JSON.stringify(level));
  const hash = async () => createHash("sha256").update(await readFile(smokePublicPath(binaryPath))).digest("hex"), beforeHash = await hash();
  await page.addInitScript(() => localStorage.setItem("forge.userSettings", JSON.stringify({ schema: 1, updatedAt: new Date().toISOString(), payload: { graphics: {
    selectedQualityLevel: "custom", manuallySelected: true, adaptiveOptimizationEnabled: false,
    customSettings: { renderScale: .7, maxPixelRatio: 1, shadowsEnabled: false, aoAllowed: false, bloomAllowed: false, dofAllowed: false, smaaAllowed: false,
      particleDensity: 0, grassDensity: 0, terrainTrackDetailLevels: 2, lakeReflectionQuality: "off" },
  } } })));
  await page.route("**/landscapes/__playwright-puddle-bed*.bin", async route => route.fulfill({ body: await readFile(smokePublicPath(new URL(route.request().url()).pathname.slice(1))), contentType: "application/octet-stream" }));
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/tests/smoke/pages/puddle-deformation.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!(window as any).puddleBedQA);
  const before = await page.evaluate(() => (window as any).puddleBedQA.read()); expect(before.vehicles).toBe(1);
  const settled = await page.evaluate(() => (window as any).puddleBedQA.advance(150)); expect(settled.contacts).toBeGreaterThanOrEqual(2);
  const driven = await page.evaluate(() => (window as any).puddleBedQA.advance(180, true));
  expect(driven.tracks).toBeGreaterThan(10); expect(driven.rutDepth).toBeGreaterThan(.02);
  expect(driven.ripples).toBeGreaterThan(0); expect(driven.ripples).toBeLessThanOrEqual(12);
  expect(driven.result.status).toBe("ready"); expect(driven.result.spacing).toBe(.25); expect(driven.maxDepth).toBeGreaterThan(before.maxDepth + .01);
  expect(driven.maxLevelError).toBeLessThan(1e-6); expect(driven.waterRevision).toBeGreaterThan(before.waterRevision);
  const visible = await page.evaluate(() => (window as any).puddleBedQA.render(true)); expect(visible.glError).toBe(0);
  const ripples = await page.evaluate(() => (window as any).puddleBedQA.rippleProbe());
  expect(ripples.count).toBeGreaterThan(0); expect(ripples.changed).toBeGreaterThan(20); expect(ripples.glError).toBe(0);
  await page.screenshot({ path: info.outputPath("puddle-real-wheels-water.png") });
  await page.evaluate(() => (window as any).puddleBedQA.renderRippleDebug());
  await page.screenshot({ path: info.outputPath("puddle-wheel-ripple-normals.png") });
  await page.evaluate(() => (window as any).puddleBedQA.render(false)); await page.screenshot({ path: info.outputPath("puddle-real-wheels-bed.png") });
  const film = await page.evaluate(() => (window as any).puddleBedQA.filmProbe()); expect(film.glError).toBe(0);
  const barrier = await page.evaluate(() => (window as any).puddleBedQA.barrierProbe());
  expect(barrier.status).toBe("ready"); expect(barrier.open.shadow).toBeGreaterThan(100);
  expect(barrier.blocked.shadow).toBe(0); expect(barrier.blocked.free).toBeGreaterThan(100); expect(barrier.glError).toBe(0);
  expect(film.masked).toBeLessThan(film.unmasked); expect(await hash()).toBe(beforeHash); expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as any).puddleBedQA.remove())).toBe(0);
  await writeFile(info.outputPath("puddle-wheel-ripples.json"),JSON.stringify({before,settled,driven,film,ripples,barrier},null,2));
  await info.attach("puddle-real-wheels", { body: JSON.stringify({ before, settled, driven, film, ripples, barrier }), contentType: "application/json" });
});
