import { readFile, writeFile } from "node:fs/promises";
import { PerspectiveCamera } from "three";
import { SMOKE_SCENE, smokePublicPath } from "./smokeProject.mjs";
import { expect, test, type Page } from "./test";

async function currentRange(page: Page): Promise<{ min: number; max: number }> {
  return page.evaluate(() =>
    (window as unknown as { sculptRange: () => { min: number; max: number } }).sculptRange(),
  );
}

for (const tiles of [1, 2]) {
  test(`Landscape ${tiles}x${tiles}: Shift reverses Raise/Lower, including during a drag`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

    // Use only disposable smoke content and a known view of the flat terrain.
    const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SCENE), "utf8"));
    level.landscapes = [];
    level.instances = [];
    level.characters = [];
    level.actors = [];
    level.riverWaters = [];
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
    await page.evaluate(async () => {
      // Observe real brush results without exposing editor internals in production.
      const modulePath = "/src/scene/SceneApp.ts";
      const { SceneApp } = await import(modulePath);
      const original = SceneApp.prototype.getLandscapeSculptSettings;
      SceneApp.prototype.getLandscapeSculptSettings = function (this: {
        worldTerrains: Map<string, { tiles: Map<string, { heights: Float32Array }> }>;
      }) {
        (window as unknown as { sculptRange: () => { min: number; max: number } }).sculptRange = () => {
          const heights: number[] = [];
          for (const world of this.worldTerrains.values()) {
            for (const tile of world.tiles.values()) heights.push(...tile.heights);
          }
          return heights.reduce((range, height) => ({ min: Math.min(range.min, height), max: Math.max(range.max, height) }),
            { min: Infinity, max: -Infinity });
        };
        return original.call(this);
      };
    });
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
    const toolButton = (tool: string) => page.locator(`[data-landscape-tool="${tool}"]`);
    await expect(toolButton("raise")).toBeVisible();
    await expect(page.getByText("Hold Shift to swap Raise and Lower while sculpting.")).toBeVisible();
    await page.locator('[data-landscape-number="brushSize"]').fill("3");
    await page.locator('[data-landscape-number="brushSize"]').press("Tab");
    await page.locator('[data-landscape-number="strength"]').fill("1");
    await page.locator('[data-landscape-number="strength"]').press("Tab");

    const box = await page.locator("#game-canvas").boundingBox();
    if (!box) throw new Error("Missing canvas");
    // Avoid the transform gizmo at the single-tile Landscape's origin.
    const x = box.x + box.width * 0.5 + 40;
    const y = box.y + box.height * 0.5 + 70;
    for (const tool of ["raise", "lower"] as const) {
      await toolButton(tool).click();
      // Releasing Shift must restore the selected direction on the next stroke.
      for (const shift of [true, false]) {
        if (shift) await page.keyboard.down("Shift");
        await page.mouse.click(x, y);
        await page.keyboard.up("Shift");
        const range = await currentRange(page);
        const raises = (tool === "raise") !== shift;
        expect(raises ? range.max : -range.min).toBeGreaterThan(0.1);
        // Newly loaded u16 terrain can start within half a step of zero.
        expect(Math.abs(raises ? range.min : range.max)).toBeLessThan(0.01);
        await expect(toolButton(tool)).toHaveClass(/active/);
        await page.getByTestId("editor-undo").click();
      }
    }

    await toolButton("raise").click();
    await page.mouse.move(x - 90, y);
    await page.mouse.down();
    await page.keyboard.down("Shift");
    await page.mouse.move(x, y);
    await page.keyboard.up("Shift");
    await page.mouse.move(x + 90, y);
    await page.mouse.up();
    const mixed = await currentRange(page);
    expect(mixed.min).toBeLessThan(-0.1);
    expect(mixed.max).toBeGreaterThan(0.1);
    await expect(toolButton("raise")).toHaveClass(/active/);
    await page.screenshot({ path: testInfo.outputPath("shift-sculpt.png") });
    await page.getByTestId("editor-undo").click();
    const undone = await currentRange(page);
    expect(Math.abs(undone.min)).toBeLessThan(0.01);
    expect(Math.abs(undone.max)).toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });
}
