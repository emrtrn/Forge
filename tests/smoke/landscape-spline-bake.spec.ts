import { addLandscapeFromMenu, readSavedTerrain } from "./terrain";
import { expect, test, type Page } from "./test";

test.setTimeout(210_000);

// Saves stay inside the per-run smoke project.

async function save(page: Page): Promise<void> {
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 10_000 });
}

/**
 * Spline Apply Deform / Apply Paint bake into a 1×1 Landscape and undo through
 * rectangle-sized tile patches (OPEN_WORLD_FAZ2_EDITOR_PLAN step 3).
 */
test("Landscape spline Apply Deform and Apply Paint bake, save and undo to the exact grid", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });
  const landscapeRows = page.getByTestId("outliner-row").filter({ hasText: "Landscape" });
  if ((await landscapeRows.count()) > 0) {
    await landscapeRows.first().click();
    await page.keyboard.press("Delete");
    await expect(landscapeRows).toHaveCount(0);
  }
  await addLandscapeFromMenu(page);
  await landscapeRows.first().click();
  await save(page);
  const original = await readSavedTerrain(page);
  expect(original.heights.every((height) => height === 0)).toBe(true);

  // Two clicks in Splines mode draw one segment across the middle of the view.
  await page.locator("[data-landscape-mode]").selectOption("splines");
  await page.locator("[data-landscape-spline-create]").click();
  const box = (await page.locator("#game-canvas").boundingBox())!;
  for (const x of [0.38, 0.62]) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * 0.55);
    await page.waitForTimeout(300);
  }
  await expect(page.locator("[data-landscape-spline-segment]")).toHaveCount(1);

  const flag = (key: string) => page.locator(`[data-landscape-segment-flag="${key}"]`);
  await flag("deform.enabled").check();
  await page.locator('[data-landscape-segment-number="deform.targetOffset"]').fill("2");
  await page.locator('[data-landscape-segment-number="deform.targetOffset"]').press("Enter");
  await page.locator("[data-landscape-spline-apply-deform]").click();
  await expect(page.getByTestId("editor-status")).toContainText("Spline terrain deform applied.");

  await flag("paint.enabled").check();
  await page.locator("[data-landscape-segment-layer]").selectOption("rock");
  await page.locator('[data-landscape-segment-number="paint.strength"]').fill("1");
  await page.locator('[data-landscape-segment-number="paint.strength"]').press("Enter");
  await page.locator("[data-landscape-spline-apply-paint]").click();
  await expect(page.getByTestId("editor-status")).toContainText("Spline layer paint applied.");

  await save(page);
  const baked = await readSavedTerrain(page);
  const raised = baked.heights.filter((height) => height > 1.5).length;
  const rock = baked.layers.find((layer) => layer.id === "rock")!.weights.filter((weight) => weight > 0.5).length;
  console.log(`[landscape-spline-bake] raised ${raised} vertices, painted ${rock} rock vertices`);
  expect(raised).toBeGreaterThan(20);
  expect(rock).toBeGreaterThan(20);
  // The bake touched a corridor, not the whole grid.
  expect(baked.heights.filter((height) => height === 0).length).toBeGreaterThan(baked.heights.length / 2);

  // Undo back through the deform bake (segment edits in between are commands
  // too): the grid on disk is the original again.
  const undo = page.getByTestId("editor-undo");
  for (let i = 0; i < 12 && (await undo.getAttribute("aria-label")) !== "Undo Apply Spline Terrain Deform"; i += 1) await undo.click();
  await expect(undo).toHaveAttribute("aria-label", "Undo Apply Spline Terrain Deform");
  await undo.click();
  await save(page);
  const undone = await readSavedTerrain(page);
  expect(undone.heights).toEqual(original.heights);
  expect(undone.layers.map((layer) => layer.weights)).toEqual(original.layers.map((layer) => layer.weights));

  expect(pageErrors).toEqual([]);
});
