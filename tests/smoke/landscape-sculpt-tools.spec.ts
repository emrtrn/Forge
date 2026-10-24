import { readFile, writeFile } from "node:fs/promises";
import { PerspectiveCamera } from "three";
import { SMOKE_SCENE, smokePublicPath } from "./smokeProject.mjs";
import { expect, test, type Page } from "./test";

interface SculptHarness {
  heights(): number[];
  project(x: number, z: number): { x: number; y: number };
  previewVisible(): boolean;
}

async function attachHarness(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const modulePath = "/src/scene/SceneApp.ts";
    const { SceneApp } = await import(modulePath);
    const original = SceneApp.prototype.getLandscapeSculptSettings;
    SceneApp.prototype.getLandscapeSculptSettings = function (this: {
      landscapeData: Map<string, { heights: number[] }>;
      worldTerrains: Map<string, { tiles: Map<string, { heights: Float32Array }> }>;
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
  test(`Landscape ${tiles}x${tiles}: Noise, Ramp, Terrace and Stamp with undo, save and reload`, async ({ page }, testInfo) => {
    test.setTimeout(210_000);
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
    for (const name of ["raise", "lower", "smooth", "flatten", "noise", "ramp", "terrace", "stamp"]) await expect(tool(name)).toBeVisible();
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

    await tool("stamp").click();
    await page.locator("[data-landscape-stamp-shape]").selectOption("ridge");
    await number(page, "stampHeight", "8");
    await number(page, "stampRotation", "45");
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    const stamped = await heights(page);
    expect(Math.max(...stamped)).toBeGreaterThan(5);
    await page.mouse.move(point.x + 40, point.y, { steps: 8 });
    expect(await heights(page), "a drag must not repeat Stamp").toEqual(stamped);
    await page.mouse.up();
    await page.screenshot({ path: testInfo.outputPath("stamp.png") });
    await page.getByTestId("editor-undo").click();
    expect(await heights(page)).toEqual(baseline);
    await page.getByTestId("editor-redo").click();
    expect(await heights(page)).toEqual(stamped);

    await tool("terrace").click();
    await number(page, "terraceStep", "3");
    await number(page, "terraceSmoothing", "0");
    await page.mouse.click(point.x, point.y);
    expect(await heights(page)).not.toEqual(stamped);
    await page.screenshot({ path: testInfo.outputPath("terrace.png") });
    await page.getByTestId("editor-undo").click();
    expect(await heights(page)).toEqual(stamped);
    await page.getByTestId("editor-undo").click();
    expect(await heights(page)).toEqual(baseline);

    await tool("ramp").click();
    await number(page, "brushSize", "4");
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
