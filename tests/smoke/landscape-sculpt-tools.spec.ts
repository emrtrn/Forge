import { readFile, writeFile } from "node:fs/promises";
import { PerspectiveCamera } from "three";
import type { ForgeLandscapeData } from "../../engine/scene/landscape";
import type { TerrainTileData, WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { SMOKE_SCENE, smokePublicPath } from "./smokeProject.mjs";
import { expect, test, type Page } from "./test";

interface SculptHarness {
  heights(): number[];
  project(x: number, z: number): { x: number; y: number };
  previewVisible(): boolean;
  sample(x: number, z: number): number;
}

async function attachHarness(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const modulePath = "/src/scene/SceneApp.ts";
    const { SceneApp } = await import(modulePath);
    const heightModulePath = "/engine/terrain/terrainHeightQuery.ts";
    const { terrainHeightAt } = await import(heightModulePath);
    const original = SceneApp.prototype.getLandscapeSculptSettings;
    SceneApp.prototype.getLandscapeSculptSettings = function (this: {
      landscapeData: Map<string, ForgeLandscapeData>;
      worldTerrains: Map<string, { def: WorldTerrainDef; tiles: Map<string, TerrainTileData> }>;
      editorViewportCamera(): PerspectiveCamera;
      landscapeRampPreview: { visible: boolean } | null;
    }) {
      const app = this;
      (window as unknown as { sculptTools: SculptHarness }).sculptTools = {
        heights: () => [...app.landscapeData.values()].flatMap((data) => data.heights).concat(
          [...app.worldTerrains.values()].flatMap((world) => [...world.tiles.values()].flatMap((tile) => Array.from(tile.heights)))),
        project: (x, z) => {
          const camera = app.editorViewportCamera();
          const point = camera.position.clone().set(x, 0, z).project(camera);
          const box = document.querySelector("#game-canvas")!.getBoundingClientRect();
          return { x: box.x + (point.x + 1) * box.width / 2, y: box.y + (1 - point.y) * box.height / 2 };
        },
        previewVisible: () => app.landscapeRampPreview?.visible ?? false,
        sample: (x, z) => {
          const world = app.worldTerrains.values().next().value;
          if (world) return terrainHeightAt(world.def, { tile: (tx: number, tz: number) => world.tiles.get(`${tx}_${tz}`) }, x, z)!;
          const data = app.landscapeData.values().next().value!;
          const vx = Math.round(x / data.size.spacing + (data.size.verticesX - 1) / 2);
          const vz = Math.round(z / data.size.spacing + (data.size.verticesZ - 1) / 2);
          return data.heights[vz * data.size.verticesX + vx]! * data.size.heightScale;
        },
      };
      return original.call(this);
    };
  });
}

async function heights(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { sculptTools: SculptHarness }).sculptTools.heights());
}

async function project(page: Page, x: number, z: number) {
  return page.evaluate(([px, pz]) => (window as unknown as { sculptTools: SculptHarness }).sculptTools.project(px!, pz!), [x, z]);
}

async function number(page: Page, key: string, value: string): Promise<void> {
  const input = page.locator(`[data-landscape-number="${key}"]`);
  await input.fill(value);
  await input.press("Tab");
  await expect(input).toHaveValue(value);
}

for (const tiles of [1, 2]) {
  test(`Landscape ${tiles}x${tiles}: Noise, Ramp, Terrace and Thermal/Hydraulic Erosion with undo, save and reload`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SCENE), "utf8"));
    for (const field of ["landscapes", "instances", "characters", "actors", "riverWaters"]) level[field] = [];
    await writeFile(smokePublicPath(SMOKE_SCENE), JSON.stringify(level));
    const camera = new PerspectiveCamera();
    camera.position.set(0, 45, 45);
    camera.lookAt(0, 0, 0);
    await page.addInitScript(({ key, pose }) => {
      localStorage.clear();
      localStorage.setItem(key, pose);
    }, { key: `forge.editor.cameraPose.${encodeURIComponent(SMOKE_SCENE)}`,
      pose: JSON.stringify({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] }) });
    await page.goto("/?editor");
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 60_000 });
    await attachHarness(page);
    await page.getByTestId("add-actor-button").hover();
    await page.getByRole("button", { name: /^Terrain/ }).hover();
    await page.locator("[data-add-categories]").getByRole("button", { name: "Landscape", exact: true }).click();
    const dialog = page.locator("[data-world-terrain-dialog]");
    await dialog.locator('[data-field="tilesX"]').fill(String(tiles));
    await dialog.locator('[data-field="tilesZ"]').fill(String(tiles));
    await dialog.locator('[data-field="tileQuads"]').selectOption("64");
    await dialog.locator("[data-world-terrain-create]").click();
    await expect(dialog).toHaveCount(0);
    await page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first().click();
    const tool = (name: string) => page.locator(`[data-landscape-tool="${name}"]`);
    for (const name of ["raise", "lower", "smooth", "flatten", "noise", "ramp", "terrace", "erosion"]) await expect(tool(name)).toBeVisible();
    await expect(tool("stamp")).toHaveCount(0);
    await number(page, "brushSize", "8");
    await number(page, "strength", "1");
    const point = await project(page, 0, 8);
    const baseline = await heights(page);

    await tool("noise").click();
    await number(page, "noiseScale", "2");
    await number(page, "noiseSeed", "42");
    await page.mouse.click(point.x, point.y);
    const noise = await heights(page);
    expect(Math.min(...noise)).toBeLessThan(-0.05);
    expect(Math.max(...noise)).toBeGreaterThan(0.05);
    await page.screenshot({ path: testInfo.outputPath("noise.png") });
    await page.getByTestId("editor-undo").click();
    expect(await heights(page)).toEqual(baseline);
    await page.mouse.click(point.x, point.y);
    expect(await heights(page)).toEqual(noise);
    await page.getByTestId("editor-undo").click();

    await tool("raise").click();
    await number(page, "strength", "2");
    for (let i = 0; i < 6; i++) await page.mouse.click(point.x, point.y);
    const hill = await heights(page);
    await page.screenshot({ path: testInfo.outputPath("erosion-before.png") });
    await tool("erosion").click();
    const erosionType = page.locator("[data-landscape-erosion-type]");
    await expect(erosionType).toHaveValue("thermal");
    await number(page, "strength", "0.75");
    await number(page, "erosionTalus", "25");
    await number(page, "erosionIterations", "24");
    await page.mouse.click(point.x, point.y);
    const thermal = await heights(page);
    expect(thermal).not.toEqual(hill);
    expect(Math.max(...thermal)).toBeLessThan(Math.max(...hill));
    expect(thermal.some((height, i) => height > hill[i]! + 0.001)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("erosion-thermal.png") });
    await page.getByTestId("editor-undo").click();
    expect(await heights(page)).toEqual(hill);
    await page.getByTestId("editor-redo").click();
    expect(await heights(page)).toEqual(thermal);
    await page.getByTestId("editor-undo").click();
    await erosionType.selectOption("hydraulic");
    await expect(page.locator('[data-landscape-number="erosionTalus"]')).toHaveCount(0);
    await number(page, "erosionRainAmount", "1");
    await number(page, "erosionSedimentCapacity", "6");
    await number(page, "erosionEvaporation", "0.02");
    await number(page, "erosionSeed", "42");
    await page.mouse.click(point.x, point.y);
    const hydraulic = await heights(page);
    expect(Math.max(...hydraulic.map((height, i) => Math.abs(height - hill[i]!)))).toBeGreaterThan(0.01);
    expect(hydraulic).not.toEqual(thermal);
    await page.screenshot({ path: testInfo.outputPath("erosion-hydraulic.png") });
    await page.getByTestId("editor-undo").click();
    expect(await heights(page)).toEqual(hill);
    await page.getByTestId("editor-redo").click();
    expect(await heights(page)).toEqual(hydraulic);

    await page.getByTestId("editor-save").click();
    await expect.poll(async () => page.evaluate(async ({ scene, expected }) => {
      const level = await (await fetch(`/${scene}`)).json();
      const modulePath = "/src/scene/terrainDocument.ts";
      const { fetchTerrainActorDocument } = await import(modulePath);
      const doc = await fetchTerrainActorDocument(level.landscapes[0].dataRef);
      const saved = doc.kind === "landscape" ? doc.data.heights
        : [...doc.document.tiles.values()].flatMap((tile: { heights: Float32Array }) => Array.from(tile.heights));
      return saved.length === expected.length ? Math.max(...saved.map((height: number, i: number) => Math.abs(height - expected[i]!))) : Infinity;
    }, { scene: SMOKE_SCENE, expected: hydraulic }), { timeout: 20_000 }).toBeLessThan(0.01);

    await tool("terrace").click();
    await number(page, "terraceStep", "3");
    await number(page, "terraceSmoothing", "0");
    await page.mouse.click(point.x, point.y);
    expect(await heights(page)).not.toEqual(hydraulic);
    await page.screenshot({ path: testInfo.outputPath("terrace.png") });
    await page.getByTestId("editor-undo").click();
    expect(await heights(page)).toEqual(hydraulic);
    await page.getByTestId("editor-undo").click();
    for (let i = 0; i < 6; i++) await page.getByTestId("editor-undo").click();
    expect(await heights(page)).toEqual(baseline);

    // Reproduce the reported ridge with ordinary brush strength and falloff.
    await number(page, "strength", "0.25");
    await tool("ramp").click();
    const width = page.locator("[data-landscape-ramp-width]");
    await width.fill("8");
    await width.press("Tab");
    await expect(width).toHaveValue("8");
    await expect(page.locator('[data-landscape-number="strength"]')).toHaveCount(0);
    await number(page, "rampShoulder", "2");
    await number(page, "rampEndOffset", "6");
    const start = await project(page, -12, 8), end = await project(page, 12, 8);
    await page.mouse.click(start.x, start.y);
    expect(await heights(page), "a zero length ramp changes nothing").toEqual(baseline);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    expect(await heights(page), "ramp drag is a preview").toEqual(baseline);
    expect(await page.evaluate(() => (window as unknown as { sculptTools: SculptHarness }).sculptTools.previewVisible())).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("ramp-preview.png") });
    await page.mouse.up();
    const ramp = await heights(page);
    expect(Math.max(...ramp)).toBeGreaterThan(4);
    const crossSection = await page.evaluate(() => {
      const harness = (window as unknown as { sculptTools: SculptHarness }).sculptTools;
      return Array.from({ length: 7 }, (_, i) => harness.sample(0, 5 + i));
    });
    expect(Math.max(...crossSection) - Math.min(...crossSection), "the road must be flat across its width").toBeLessThan(0.001);
    expect(crossSection[3]).toBeGreaterThan(2.5);
    const shoulders = await page.evaluate(() => {
      const harness = (window as unknown as { sculptTools: SculptHarness }).sculptTools;
      return [harness.sample(0, 3), harness.sample(0, 13)];
    });
    for (const height of shoulders) expect(height).toBeLessThan(crossSection[3]!);
    await page.screenshot({ path: testInfo.outputPath("ramp-flat-road.png") });
    await page.getByTestId("editor-undo").click();
    expect(await heights(page)).toEqual(baseline);
    await page.getByTestId("editor-redo").click();
    expect(await heights(page)).toEqual(ramp);

    // Release outside the Landscape cancels instead of applying a stale endpoint.
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(1, 1);
    await page.mouse.up();
    expect(await heights(page)).toEqual(ramp);
    await page.getByTestId("editor-save").click();
    await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 20_000 });
    // A save may have completed an older in-flight snapshot. Finish the latest one.
    await page.getByTestId("editor-save").click();
    await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 20_000 });
    await page.screenshot({ path: testInfo.outputPath("sculpt-tools.png") });
    await page.goto(`/?editor&sculptToolsReload=${Date.now()}`);
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    await attachHarness(page);
    await page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first().click();
    await expect(tool("noise")).toBeVisible();
    const reloaded = await heights(page);
    expect(reloaded).toHaveLength(ramp.length);
    expect(Math.max(...reloaded.map((height, i) => Math.abs(height - ramp[i]!)))).toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });
}
