import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildRidgeboundPreview, RIDGEBOUND_LEVEL, RIDGEBOUND_RECIPE } from "../../tools/world/ridgeboundSpatial";
import { normalizeWorldRecipe, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { REPO_ROOT, smokePublicPath } from "./smokeProject.mjs";
import { expect, test } from "./test";

test("Ridgebound metric master: preview, blockout undo, save/reload and repeat without replacing authored levels", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  const bytes = await readFile(resolve(REPO_ROOT, "tests/engine/fixtures/ridgebound-spatial-master-v0.2.json"));
  const preview = buildRidgeboundPreview(JSON.parse(bytes.toString("utf8")), createHash("sha256").update(bytes).digest("hex"));
  for (const [path, value] of [[RIDGEBOUND_LEVEL, preview.level], [RIDGEBOUND_RECIPE, preview.recipe]] as const) {
    const output = smokePublicPath(path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(value, null, 2));
  }
  expect((await request.post("/__open-level", { data: { path: RIDGEBOUND_LEVEL } })).ok()).toBeTruthy();
  await page.addInitScript(() => {
    localStorage.clear();
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __rbRenderers: any[] };
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__rbRenderers = [];
    w.__THREE_DEVTOOLS__.addEventListener("observe", ((event: CustomEvent) => {
      if (event.detail?.isWebGLRenderer) w.__rbRenderers.push(event.detail);
    }) as EventListener);
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  const boot = async () => {
    await page.goto(`/?editor&ridgebound=${Date.now()}`);
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("world-builder-tab").click();
    await expect(page.getByTestId("world-builder-recipe")).toContainText("ridgebound_p0", { timeout: 30_000 });
  };
  await boot();
  await expect(page.getByTestId("world-builder-panel")).toContainText("2 settlements, 7 landmarks");
  await page.getByTestId("world-builder-dry-run-planBlockout").click();
  await expect(page.getByTestId("world-builder-counts")).toHaveText("+11 added · ~0 updated · −0 removed · 0 unchanged");
  await expect(page.getByTestId("world-builder-recipe")).not.toContainText("unsaved");
  await page.getByTestId("world-builder-preview-focus").click();
  await page.locator("[data-camera-button]").hover();
  await page.locator('[data-camera-view="top"]').click();
  await expect(page.locator("[data-camera-label]")).toHaveText("Top");
  await page.getByTestId("world-builder-preview-focus").click();
  await page.mouse.move(900, 500);
  // Count visible geometry in the actual render camera, rather than trusting the panel's item count.
  const visible = await page.evaluate(() => new Promise<{ vertices: number; maxXY: number; maxZ: number }>(done => {
    const w = window as unknown as { __rbRenderers: any[] };
    for (const renderer of w.__rbRenderers) {
      const render = renderer.render;
      renderer.render = function (scene: any, camera: any) {
        const overlay = scene?.getObjectByName?.("world-builder-preview");
        if (overlay?.children.length) {
          renderer.render = render;
          let vertices = 0, maxXY = 0, maxZ = 0;
          overlay.traverse((node: any) => {
            const positions = node.geometry?.getAttribute("position");
            if (!positions) return;
            for (let i = 0; i < positions.count; i++) {
              const p = node.position.clone().set(positions.getX(i), positions.getY(i), positions.getZ(i)).applyMatrix4(node.matrixWorld).project(camera);
              vertices++; maxXY = Math.max(maxXY, Math.abs(p.x), Math.abs(p.y)); maxZ = Math.max(maxZ, Math.abs(p.z));
            }
          });
          done({ vertices, maxXY, maxZ });
        }
        return render.call(this, scene, camera);
      };
    }
  }));
  expect(visible.vertices).toBeGreaterThan(0);
  expect(visible.maxXY).toBeLessThan(1);
  expect(visible.maxZ).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath("ridgebound-plan-preview.png") });
  await page.getByTestId("world-builder-apply-planBlockout").click();
  await expect(page.getByTestId("world-builder-panel")).toContainText("11 generated objects");
  await page.getByTestId("editor-undo").click();
  await expect(page.getByTestId("world-builder-panel")).toContainText("0 generated objects");
  await page.getByTestId("editor-redo").click();
  const save = page.waitForResponse(r => r.url().endsWith("/__save-worldrecipe") && r.request().method() === "POST");
  await page.getByTestId("editor-save").click();
  expect((await save).ok()).toBeTruthy();
  const recipe = JSON.parse(await readFile(smokePublicPath(RIDGEBOUND_RECIPE), "utf8")) as WorldRecipe;
  expect(normalizeWorldRecipe(recipe).issues).toEqual([]);
  expect(recipe.plan).toEqual(preview.recipe.plan);
  expect(recipe.plan.landmarks.some(p => p.id === "POI-07")).toBe(false);
  await boot();
  await page.getByTestId("world-builder-dry-run-planBlockout").click();
  await expect(page.getByTestId("world-builder-counts")).toHaveText("+0 added · ~0 updated · −0 removed · 11 unchanged");
  expect(errors).toEqual([]);
});
