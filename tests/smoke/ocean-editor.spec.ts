import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test } from "./test";
import { SMOKE_SCENE, smokePublicPath } from "./smokeProject.mjs";
import { createFlatTerrainTile, terrainTilePath, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { observeBrowserErrors } from "./browserErrors";

test.use({ viewport: { width: 1100, height: 760 },
  trace: { mode: "retain-on-failure", screenshots: false, snapshots: true, sources: true }, launchOptions: {
  ...(process.env.FORGE_CHROMIUM_EXECUTABLE ? { executablePath: process.env.FORGE_CHROMIUM_EXECUTABLE } : {}),
  args: ["--enable-unsafe-swiftshader"],
} });

test("ocean: native editor create/edit/undo/save/reload and runtime Play render the same body", async ({ page, context }, info) => {
  // Full FFT + planar rendering on SwiftShader makes each real UI action slow.
  // This is a functional workflow check; hardware frame-time acceptance is separate.
  test.setTimeout(600_000);
  const dataRef = "landscapes/__playwright-ocean.terrain.json";
  const def: WorldTerrainDef = { schema: 1, type: "worldTerrain", name: "Ocean coast", tileQuads: 32, spacing: 2,
    tilesX: 1, tilesZ: 1, origin: [-32, 0, -32], heightMin: -10, heightMax: 10, collision: false,
    layers: [{ id: "sand", name: "Sand", color: "#b8a17c" }], tiles: [{ key: "0_0", minHeight: -4, maxHeight: 6 }] };
  const tile = createFlatTerrainTile(def, 0, 0);
  for (let z = 0; z < tile.size; z++) for (let x = 0; x < tile.size; x++)
    tile.heights[z * tile.size + x] = -4 + 10 * Math.exp(-((x - 16) ** 2 + (z - 16) ** 2) / 30);
  const write = async (path: string, contents: string | Uint8Array) => {
    await mkdir(dirname(smokePublicPath(path)), { recursive: true }); await writeFile(smokePublicPath(path), contents);
  };
  await write(dataRef, JSON.stringify(def)); await write(terrainTilePath(dataRef, "0_0"), encodeTerrainTile(tile, { heightMin: -10, heightMax: 10, heightFormat: "f32" }));
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SCENE), "utf8"));
  level.instances = []; level.characters = []; level.actors = []; level.riverWaters = []; level.waterBodies = []; level.puddleWaters = [];
  delete level.oceanWaters; delete level.postProcess; delete level.foliage; delete level.worldEnvironment;
  level.worldSettings = { ...level.worldSettings, gameMode: "forge.defaultCamera", viewDistance: 2500 };
  level.landscapes = [{ id: "ocean-terrain", name: "Ocean coast", dataRef, position: [0, 0, 0] }];
  await write(SMOKE_SCENE, JSON.stringify(level));
  // The test project has no favicon; keep its optional browser request out of
  // the console-error signal without filtering application/shader failures.
  await context.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.addInitScript(() => localStorage.setItem("forge.userSettings", JSON.stringify({ schema: 1, updatedAt: new Date().toISOString(), payload: {
    graphics: { selectedQualityLevel: "custom", manuallySelected: true, adaptiveOptimizationEnabled: false,
      customSettings: { renderScale: .5, maxPixelRatio: 1, shadowsEnabled: false, aoAllowed: false, bloomAllowed: false, dofAllowed: false, smaaAllowed: false, particleDensity: 0, grassDensity: 0 } },
  } })));
  if (process.env.FORGE_CHROMIUM_EXECUTABLE) await context.addInitScript((delayMs: number) => {
    // Keep the real render loop/FFT, with idle time for DOM input on software
    // GPUs. This test checks authoring/persistence; GPU timing is a separate gate.
    const requestFrame = window.requestAnimationFrame.bind(window), cancelFrame = window.cancelAnimationFrame.bind(window);
    const pending = new Map<number, () => void>(); let sequence = 0;
    window.requestAnimationFrame = callback => {
      const id = ++sequence;
      const timer = window.setTimeout(() => {
        const frame = requestFrame(time => { pending.delete(id); callback(time); });
        pending.set(id, () => cancelFrame(frame));
      }, delayMs);
      pending.set(id, () => clearTimeout(timer)); return id;
    };
    window.cancelAnimationFrame = id => {
      const cancelPending = pending.get(id);
      if (cancelPending) { pending.delete(id); cancelPending(); }
    };
  }, 250);
  const errors: (() => string[])[] = [];
  const observe = (target: typeof page) => { errors.push(observeBrowserErrors(target)); };
  observe(page);
  await page.goto("/?editor", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await page.locator('[data-object-id="landscape:0"]').click();
  await page.locator('[data-landscape-mode]').selectOption("water");
  await page.getByRole("button", { name: "Add Ocean", exact: true }).click();
  await expect(page.locator('[data-ocean-result="ready"]')).toBeVisible({ timeout: 60_000 });
  const levelInput = page.getByRole("spinbutton", { name: "Sea Level", exact: true });
  await levelInput.fill("1"); await levelInput.press("Tab");
  await expect(levelInput).toHaveValue("1");
  await page.getByTestId("editor-undo").click(); await expect(levelInput).toHaveValue("0");
  await page.getByTestId("editor-redo").click(); await expect(levelInput).toHaveValue("1");
  await expect(page.locator('[data-ocean-result="ready"]')).toBeVisible({ timeout: 60_000 });
  const reflectionMode = page.getByRole("combobox", { name: "Reflection Mode", exact: true });
  await reflectionMode.selectOption("sharedPlanar");
  await page.getByTestId("editor-undo").click(); await expect(reflectionMode).toHaveValue("environment");
  await page.getByTestId("editor-redo").click(); await expect(reflectionMode).toHaveValue("sharedPlanar");
  await page.getByRole("combobox", { name: "Reflection Quality", exact: true }).selectOption("medium");
  await page.getByRole("textbox", { name: "Reflection Group", exact: true }).fill("native-ocean");
  await page.getByRole("textbox", { name: "Reflection Group", exact: true }).press("Tab");
  await page.getByRole("spinbutton", { name: "Reflection Strength", exact: true }).fill("0.6");
  await page.getByRole("spinbutton", { name: "Reflection Strength", exact: true }).press("Tab");
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 60_000 });
  const saved = JSON.parse(await readFile(smokePublicPath(SMOKE_SCENE), "utf8"));
  expect(saved.oceanWaters).toHaveLength(1); expect(saved.oceanWaters[0].surfaceLevel).toBe(1);
  expect(saved.oceanWaters[0].appearance).toMatchObject({ reflectionMode: "sharedPlanar", reflectionGroup: "native-ocean", reflectionQuality: "medium", reflectionStrength: .6 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-object-id="ocean:0"]').click();
  await expect(page.locator('[data-ocean-result="ready"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("spinbutton", { name: "Sea Level", exact: true })).toHaveValue("1");
  await expect(reflectionMode).toHaveValue("sharedPlanar");
  await expect(page.getByRole("textbox", { name: "Reflection Group", exact: true })).toHaveValue("native-ocean");
  await page.keyboard.press("f");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: info.outputPath("ocean-editor.png") });
  const [runtime] = await Promise.all([context.waitForEvent("page"), page.getByTestId("editor-play").click()]); observe(runtime);
  const messages: string[] = []; runtime.on("console", message => messages.push(message.text()));
  await runtime.waitForLoadState("domcontentloaded");
  await expect(runtime.locator("#game-canvas")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => messages.some(message => message.includes(String(level.name))), { timeout: 60_000 }).toBe(true);
  await expect(runtime.locator(".forge-loading")).toBeHidden({ timeout: 60_000 });
  await runtime.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await runtime.screenshot({ path: info.outputPath("ocean-runtime.png") }); await runtime.close();
  await page.getByRole("button", { name: "Delete Ocean", exact: true }).click();
  await expect(page.locator('[data-object-id="ocean:0"]')).toHaveCount(0);
  await page.getByTestId("editor-undo").click(); await expect(page.locator('[data-object-id="ocean:0"]')).toHaveCount(1);
  expect(errors.flatMap(read => read())).toEqual([]);
});
