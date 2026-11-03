import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createWorldRecipe, worldRecipePath } from "../../engine/worldbuilder/recipe";
import { REPO_ROOT, smokePublicPath } from "./smokeProject.mjs";
import { expect, test } from "./test";
import { expectNoSidewaysOverflow, openWorldBuilder, parkWorldBuilder, showWorldBuilderTab } from "./worldBuilder";

test.beforeEach(async ({ page }) => {
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
});

/**
 * WORLD_BUILDER_WINDOW_PLAN D3–D4: the non-modal World Builder window opens
 * from Add Actor, keeps its place and tab across a reload, stays inside a
 * shrinking browser window, pairs form rows when wide, and works together
 * with the viewport — a handle drag while it is open, Apply then Ctrl+Z, a
 * Delete typed in a field that is not a plan delete, and a preview that
 * outlives closing the window.
 */
const LEVEL = "layouts/__playwright-world-builder-window.level.json";

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(smokePublicPath(path)), { recursive: true });
  await writeFile(smokePublicPath(path), `${JSON.stringify(value, null, 2)}\n`);
}

test("World Builder window: opens from Add Actor, remembers place and tab, clamps, and works with the viewport", async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  const base = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  await writeJson(LEVEL, { ...base, name: "__playwright-world-builder-window" });
  const recipe = createWorldRecipe("playwright_world_builder_window", 4);
  recipe.plan.settlements.push(
    { id: "village", source: "manual", center: [0, 0], type: "village" },
    { id: "hamlet", source: "manual", center: [-6, -4], type: "hamlet" },
  );
  await writeJson(worldRecipePath(LEVEL), recipe);
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  // A fresh context starts with empty storage; it is kept across the reload below.
  await page.addInitScript(() => {
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __wbRenderers: any[] };
    w.__wbRenderers = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isWebGLRenderer) w.__wbRenderers.push(object);
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const boot = async () => {
    await page.goto(`/?editor&wbWindow=${Date.now()}`);
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  };
  const frame = page.getByTestId("world-builder-window");

  // Add Actor → Terrain → World Builder…; the outliner has no World Builder tab any more.
  await boot();
  await expect(page.locator('[data-outliner-tab="worldBuilder"]')).toHaveCount(0);
  await expect(frame).toHaveCount(0);
  await openWorldBuilder(page);
  await expect(page.getByTestId("world-builder-recipe")).toContainText("playwright_world_builder_window", { timeout: 30_000 });

  // Dragged by its title bar, it moves; after a reload it opens there, on the same tab.
  await showWorldBuilderTab(page, "stages");
  await parkWorldBuilder(page);
  const parked = await frame.boundingBox();
  await boot();
  await openWorldBuilder(page);
  await expect(page.getByTestId("world-builder-panel")).toHaveAttribute("data-tab", "stages", { timeout: 30_000 });
  expect(await frame.boundingBox()).toEqual(parked);

  // Wide, the form rows pair up and nothing spills sideways; at the default width they stack.
  await showWorldBuilderTab(page, "setup");
  const reference = page.getByTestId("world-builder-reference");
  const columns = () => reference.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(await columns()).toBe(1);
  const titlebar = frame.locator("[data-forge-window-titlebar]");
  const resize = frame.locator("[data-forge-window-resize]");
  const dragBy = async (handle: typeof titlebar, dx: number, dy: number) => {
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + Math.min(40, box.width / 2), box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(40, box.width / 2) + dx, box.y + box.height / 2 + dy, { steps: 8 });
    await page.mouse.up();
  };
  await dragBy(titlebar, -500, 0);
  await dragBy(resize, 300, 0);
  expect((await frame.boundingBox())!.width).toBeGreaterThanOrEqual(800);
  expect(await columns()).toBe(2);
  await expectNoSidewaysOverflow(page);
  // A smaller browser window pulls it back inside: never past the edge, the title bar below the toolbar.
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect.poll(async () => {
    const box = (await frame.boundingBox())!;
    return box.x >= 0 && box.x + box.width <= 1000 && box.y + box.height <= 700;
  }).toBe(true);
  const viewportTop = (await page.locator("[data-viewport-host]").boundingBox())!.y;
  expect((await titlebar.boundingBox())!.y).toBeGreaterThanOrEqual(viewportTop - 1);
  await expectNoSidewaysOverflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await dragBy(resize, -400, 0);
  await parkWorldBuilder(page);

  // With the window open, a plan handle drags in the viewport; the pick brings the Plan tab forward.
  await showWorldBuilderTab(page, "plan");
  await page.locator("[data-camera-button]").hover();
  await page.locator('[data-camera-view="top"]').click();
  await page.getByTestId("world-builder-plan-edit-toggle").click();
  await expect(page.getByTestId("world-builder-plan-handles")).toHaveAttribute("data-handles", "2");
  await showWorldBuilderTab(page, "layers");
  const target = await page.evaluate(() => new Promise<{ x: number; y: number }>((done) => {
    const w = window as unknown as { __wbRenderers: any[] };
    const restore: Array<() => void> = [];
    for (const renderer of w.__wbRenderers) {
      const render = renderer.render;
      restore.push(() => { renderer.render = render; });
      renderer.render = function (scene: any, camera: any) {
        let handles: any = null;
        scene?.traverse?.((node: any) => { if (node.name === "world-builder-plan-handles") handles = node; });
        if (handles) {
          for (const undo of restore) undo();
          const attr = handles.geometry.getAttribute("position");
          const ndc = handles.position.clone().set(attr.getX(0), attr.getY(0), attr.getZ(0)).project(camera);
          const rect = renderer.domElement.getBoundingClientRect();
          done({ x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width, y: rect.top + (-ndc.y * 0.5 + 0.5) * rect.height });
        }
        return render.call(this, scene, camera);
      };
    }
  }));
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 20, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("world-builder-panel")).toHaveAttribute("data-tab", "plan");
  await expect(page.getByTestId("world-builder-plan-selection")).toHaveAttribute("data-id", "village");
  await expect(page.getByTestId("world-builder-recipe")).toContainText("unsaved");
  const village = page.getByTestId("world-builder-plan-settlement-village");

  // Delete typed in a field edits the field; it does not delete the selected element.
  const kind = page.getByTestId("world-builder-plan-field-kind");
  await kind.click();
  await kind.press("End");
  await kind.press("Delete");
  await kind.press("Backspace");
  await expect(village).toHaveCount(1);
  await expect(page.getByTestId("world-builder-plan-selection")).toHaveAttribute("data-id", "village");
  await expect(kind).toHaveValue("villag");
  // Put the text back and leave the field unchanged, so no correction is committed.
  await kind.press("e");
  await kind.evaluate((element) => (element as HTMLElement).blur());
  await page.locator("#game-canvas").hover({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("world-builder-plan-selection")).toHaveCount(0);
  // Escape belonged to the plan selection; the window stays open.
  await expect(frame).toBeVisible();

  // Apply, then Ctrl+Z in the viewport: the panel shows the step undone.
  await showWorldBuilderTab(page, "setup");
  const panel = page.getByTestId("world-builder-panel");
  await expect(panel).toContainText("0 generated objects");
  await showWorldBuilderTab(page, "stages");
  await page.getByTestId("world-builder-apply-planBlockout").click();
  await showWorldBuilderTab(page, "setup");
  await expect(panel).toContainText("2 generated objects");
  await page.locator("#game-canvas").hover({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(panel).toContainText("0 generated objects");

  // Closing with × keeps the dry run's preview in the viewport; reopening lists it again.
  await showWorldBuilderTab(page, "stages");
  await page.getByTestId("world-builder-dry-run-planBlockout").click();
  const badge = page.getByTestId("world-builder-window-tab-preview-badge");
  await expect(badge).toHaveText("2");
  // The preview overlay's drawn objects in the next rendered frames (0 when no frame draws it).
  const previewDrawn = () => page.evaluate(() => new Promise<number>((done) => {
    const w = window as unknown as { __wbRenderers: any[] };
    const restore: Array<() => void> = [];
    let frames = 0;
    const finish = (count: number) => { for (const undo of restore) undo(); done(count); };
    for (const renderer of w.__wbRenderers) {
      const render = renderer.render;
      restore.push(() => { renderer.render = render; });
      renderer.render = function (scene: any, camera: any) {
        const overlay = scene?.getObjectByName?.("world-builder-preview");
        if (overlay?.visible && overlay.children.length) finish(overlay.children.length);
        else if (++frames > 120) finish(0);
        return render.call(this, scene, camera);
      };
    }
  }));
  const drawnOpen = await previewDrawn();
  expect(drawnOpen).toBeGreaterThan(0);
  await frame.locator("[data-forge-window-close]").click();
  await expect(frame).toBeHidden();
  expect(await previewDrawn()).toBe(drawnOpen);
  await openWorldBuilder(page, "preview");
  await expect(page.getByTestId("world-builder-preview")).toHaveAttribute("data-drawn", "2");
  expect(errors).toEqual([]);
});
