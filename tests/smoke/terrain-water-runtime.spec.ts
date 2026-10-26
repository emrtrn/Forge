import { writeFile } from "node:fs/promises";
import { expect, test } from "./test";

test("terrain water runtime: LandscapeTest GAZ-52 contacts reach the planar renderer", async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 960, height: 640 });
  await page.context().addInitScript(() => localStorage.setItem("forge.userSettings", JSON.stringify({ schema: 1,
    updatedAt: new Date().toISOString(), payload: { graphics: { manuallySelected: true, adaptiveOptimizationEnabled: false,
      selectedQualityLevel: "custom", customSettings: { renderScale: 0.7, maxPixelRatio: 1, aoAllowed: false, dofAllowed: false,
        bloomAllowed: false, smaaAllowed: false, shadowsEnabled: false, grassDensity: 0, particleDensity: 0,
        terrainTrackDetailLevels: 2, terrainWaterQuality: "high" } } } })));
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch(); const project = await response.json();
    project.editor.defaultScene = "assets/starter-content/Levels/LandscapeTest.level.json";
    await route.fulfill({ response, json: project });
  });
  await page.route("**/Levels/LandscapeTest.level.json", async (route) => {
    const response = await route.fetch(); const level = await response.json();
    // Keep the actual terrain, lights, atmosphere, post-process and truck.
    // Unrelated streamed props add CPU software-renderer cost, not water coverage.
    delete level.worldCells;
    level.actors = [{ classRef: "assets/vehicles/gaz52/Script_Gaz52.actor.json", position: [20.96, 0.12, -44.42], rotationYDeg: 0, scale: 1 }];
    await route.fulfill({ response, json: level });
  });
  // Force only the physical profile in this isolated browser response: authored
  // height/paint files and the user's open editor remain untouched.
  await page.route("**/LandscapeTest.landscapes/landscape-1.terrain.json", async (route) => {
    const response = await route.fetch(); const def = await response.json();
    for (const layer of def.layers) layer.physicalMaterial = "mud";
    await route.fulfill({ response, json: def });
  });
  await page.goto("/tests/smoke/pages/terrain-water-runtime.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__terrainWaterRuntime?.ready)), { timeout: 120_000 }).toBe(true);
  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(() => page.evaluate(() => (window as any).__terrainWaterRuntime.snapshot()?.water?.sites ?? 0), { timeout: 30_000 }).toBeGreaterThan(3);
  await page.keyboard.up("KeyW");
  const snapshot = await page.evaluate(() => (window as any).__terrainWaterRuntime.captureUltra());
  await writeFile(info.outputPath("terrain-water-runtime.json"), JSON.stringify(snapshot, null, 2));
  await page.screenshot({ path: info.outputPath("terrain-water-runtime.png") });
  await page.evaluate(() => (window as any).__terrainWaterRuntime.vehicleReflection(true));
  await page.screenshot({ path: info.outputPath("terrain-water-runtime-reflection.png") });
  const difference = await page.evaluate(() => (window as any).__terrainWaterRuntime.vehicleReflection(false));
  await page.screenshot({ path: info.outputPath("terrain-water-runtime-no-car-reflection.png") });
  await writeFile(info.outputPath("terrain-water-runtime-reflection-diff.json"), JSON.stringify(difference, null, 2));
  expect(difference.maxDifference).toBeGreaterThan(25);
  expect(difference.changed).toBeGreaterThan(25);
  expect(snapshot.snapshot.water.resolution).toBe(512);
  expect(snapshot.snapshot.water.captures).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
