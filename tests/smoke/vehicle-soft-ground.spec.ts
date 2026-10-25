import { expect, test } from "./test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { smokePublicPath } from "./smokeProject.mjs";
import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";

interface SoilReadback { seconds: number; speed: number; sinks: number[]; forces: number[]; slip: number[]; contacts: number; tracks: number }
declare global { interface Window { softGroundQA: { read(): SoilReadback; enter(kmh: number): void } } }
test.use({ viewport: { width: 960, height: 540 } });

for (const material of ["mud", "snow"]) {
  test(`soft ground LandscapeTest: ${material} retains resistance through fast entry and throttle release`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("forge.userSettings", JSON.stringify({ schema: 1, updatedAt: new Date().toISOString(),
        payload: { graphics: { selectedQualityLevel: "custom", manuallySelected: true, adaptiveOptimizationEnabled: false,
          customSettings: { renderScale: 0.5, maxPixelRatio: 1, aoAllowed: false, dofAllowed: false, bloomAllowed: false,
            smaaAllowed: false, shadowsEnabled: false, particleDensity: 0.3, grassDensity: 0, foliageCullDistanceScale: 0.3 } } } }));
    });
    // Override only response data in flight; authored scene, terrain and assets stay untouched.
    const terrainRoot = smokePublicPath("assets/starter-content/Levels/LandscapeTest.landscapes");
    const definition = JSON.parse(await readFile(resolve(terrainRoot, "landscape-1.terrain.json"), "utf8"));
    const tile = decodeTerrainTile(await readFile(resolve(terrainRoot, "landscape-1.tiles/2_1.tile.bin")));
    const height = terrainHeightAt(definition, { tile: (x, z) => x === 2 && z === 1 ? tile : undefined }, 12, -43.84)!;
    await page.route("**/LandscapeTest.level.json", async (route) => {
      const response = await route.fetch();
      const level = await response.json() as { actors: { classRef: string; position: number[]; rotation: number[]; scale: number }[];
        worldSettings?: { gameMode?: string } };
      // Own the test vehicle: authoring may remove/reorder actors. Keep the
      // truck beside the asphalt, on the isolated terrain snapshot itself.
      level.actors = [{ classRef: "assets/vehicles/gaz52/Script_Gaz52.actor.json", position: [12, height + 0.15, -43.84], rotation: [-1, 0, 0], scale: 1 }];
      level.worldSettings = { ...level.worldSettings, gameMode: "forge.vehicle" };
      await route.fulfill({ response, json: level });
    });
    await page.route("**/LandscapeTest.landscapes/landscape-1.terrain.json", async (route) => {
      const response = await route.fetch();
      const terrain = await response.json() as { layers: { physicalMaterial?: string }[] };
      for (const layer of terrain.layers) layer.physicalMaterial = material;
      await route.fulfill({ response, json: terrain });
    });
    await page.goto("/tests/smoke/pages/soft-ground-runtime.html");
    await page.waitForFunction(() => !!window.softGroundQA, undefined, { timeout: 90_000 });
    await expect.poll(() => page.evaluate(() => window.softGroundQA.read()), { timeout: 60_000 }).toMatchObject({ contacts: 4 });
    await page.locator("#game-canvas").click();
    await page.keyboard.down("KeyW");
    await expect.poll(() => page.evaluate(() => Math.max(...window.softGroundQA.read().slip)), { timeout: 30_000 }).toBeGreaterThan(0.15);
    await page.evaluate(() => window.softGroundQA.enter(40));
    const entry = await page.evaluate(() => window.softGroundQA.read());
    expect(entry.speed).toBeGreaterThan(8);
    await page.waitForFunction((time) => window.softGroundQA.read().seconds > time + 0.75, entry.seconds);
    const powered = await page.evaluate(() => window.softGroundQA.read());
    expect(powered.forces.reduce((sum, force) => sum + force, 0)).toBeGreaterThan(500);
    expect(Math.max(...powered.sinks)).toBeGreaterThan(0.01);
    await page.keyboard.up("KeyW");
    await page.waitForFunction((time) => window.softGroundQA.read().seconds > time + 0.75, powered.seconds);
    const coasting = await page.evaluate(() => window.softGroundQA.read());
    // Near rest, mud now retains its finite plough threshold while the rolling
    // part fades. It need not reach the former full-rolling 500 N threshold.
    expect(coasting.forces.reduce((sum, force) => sum + force, 0)).toBeGreaterThan(material === "mud" ? 100 : 500);
    expect(coasting.tracks).toBeGreaterThan(0);
    expect(Number.isFinite(coasting.speed)).toBe(true);
    await page.screenshot({ path: `test-results/landscape-soft-ground-${material}.png` });
    console.info(`[LandscapeTest ${material}] ${JSON.stringify({ entry, powered, coasting })}`);
    expect(errors).toEqual([]);
  });
}
