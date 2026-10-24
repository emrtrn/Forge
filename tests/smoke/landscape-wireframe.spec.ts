import { expect, test, type Page } from "./test";
import { SMOKE_SPLINE_SCENE } from "./smokeProject.mjs";
import { addLandscapeFromMenu } from "./terrain";

// Observe the live chunk materials without exposing editor internals in production.
async function observeTerrain(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const modulePath = "/src/scene/SceneApp.ts";
    const { SceneApp } = await import(modulePath);
    const original = SceneApp.prototype.setViewMode;
    SceneApp.prototype.setViewMode = function (mode: string) {
      const app = this as { landscapeObjects: import("three").Group[] };
      (window as unknown as { terrainMaterials: () => { id: string; wireframe: boolean }[] }).terrainMaterials = () =>
        app.landscapeObjects.flatMap((root) => {
          const materials: { id: string; wireframe: boolean }[] = [];
          root.traverse((object) => {
            if (object.name !== "landscape-terrain") return;
            const mesh = object as import("three").Mesh;
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              materials.push({ id: material.uuid, wireframe: (material as import("three").MeshStandardMaterial).wireframe });
            }
          });
          return materials;
        });
      original.call(this, mode);
    };
  });
}

async function terrainMaterials(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { terrainMaterials: () => { id: string; wireframe: boolean }[] }).terrainMaterials(),
  );
}

async function expectTerrainMode(page: Page, wireframe: boolean): Promise<void> {
  await expect.poll(async () => {
    const materials = await terrainMaterials(page);
    return materials.length > 0 && materials.every((material) => material.wireframe === wireframe);
  }).toBe(true);
}

async function setViewMode(page: Page, mode: "lit" | "wireframe"): Promise<void> {
  await page.locator("[data-viewmode-button]").hover();
  await page.locator(`[data-view-mode="${mode}"]`).click();
}

test("terrain follows Wireframe and Lit across material rebuilds and new landscapes", async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  expect((await request.post("/__open-level", { data: { path: SMOKE_SPLINE_SCENE } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto("/?editor");
  await expect(page.locator("[data-project-name]")).toHaveText("__playwright-smoke-spline", { timeout: 60_000 });
  const landscapeRows = page.getByTestId("outliner-row").filter({ hasText: "Landscape" });
  await landscapeRows.first().click();
  await page.keyboard.press("f");
  await observeTerrain(page);

  await setViewMode(page, "lit");
  await expectTerrainMode(page, false);
  await page.screenshot({ path: testInfo.outputPath("terrain-lit.png") });
  await setViewMode(page, "wireframe");
  await expectTerrainMode(page, true);
  await page.screenshot({ path: testInfo.outputPath("terrain-wireframe.png") });

  // Landscape visualization rebuilds its material independently of viewport shading.
  const before = (await terrainMaterials(page))[0]!.id;
  await page.locator("[data-landscape-view]").selectOption("height");
  await expect.poll(async () => (await terrainMaterials(page))[0]?.id).not.toBe(before);
  await expectTerrainMode(page, true);
  await page.locator("[data-landscape-view]").selectOption("lit");
  await expectTerrainMode(page, true);
  await setViewMode(page, "lit");
  await expectTerrainMode(page, false);

  await setViewMode(page, "wireframe");
  await landscapeRows.first().click();
  await page.keyboard.press("Delete");
  await expect(landscapeRows).toHaveCount(0);
  await addLandscapeFromMenu(page);
  await expect(landscapeRows).toHaveCount(1);
  await expectTerrainMode(page, true);
  await setViewMode(page, "lit");
  await expectTerrainMode(page, false);
  expect(errors).toEqual([]);
});
