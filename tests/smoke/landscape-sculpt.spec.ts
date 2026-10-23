import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { readSavedTerrain } from "./terrain";
import { expect, test, type Page } from "./test";

test.setTimeout(210_000);

// Saves stay inside the per-run smoke project.

async function deleteExistingLandscape(page: Page): Promise<void> {
  const landscapeRows = page.getByTestId("outliner-row").filter({ hasText: "Landscape" });
  if ((await landscapeRows.count()) === 0) return;
  await landscapeRows.first().click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("outliner-row").filter({ hasText: "Landscape" })).toHaveCount(0);
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 10_000 });
}

test("editor Landscape sculpt smoke: add, sculpt, edit during save, retry, reload", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });

  await deleteExistingLandscape(page);
  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Terrain/ }).hover();
  // Scope to the category submenu: the Undo button's aria-label is dynamic
  // ("Undo Delete Landscape"), so an unscoped "Landscape" role query is ambiguous.
  await page.locator("[data-add-categories]").getByRole("button", { name: "Landscape" }).click();

  const landscapeRows = page.getByTestId("outliner-row").filter({ hasText: "Landscape" });
  await expect(landscapeRows.first()).toBeVisible();
  await landscapeRows.first().click();
  // Type-specific controls identify the selection; the shared Details chrome
  // (`finalizeDetailsRender`) strips the `.detail-heading` the renderer emits.
  await expect(
    page.locator('[data-inspector-pane="details"] [data-landscape-tool="raise"]'),
  ).toBeVisible();

  await page.evaluate(() => {
    const setNumber = (key: string, value: string): void => {
      const input = document.querySelector<HTMLInputElement>(`[data-landscape-number="${key}"]`);
      if (!input) throw new Error(`missing landscape input: ${key}`);
      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setNumber("brushSize", "10");
    setNumber("strength", "1");
  });
  await expect(page.locator('[data-landscape-number="brushSize"]')).toHaveValue("10");
  await expect(page.locator('[data-landscape-number="strength"]')).toHaveValue("1");

  const canvas = page.locator("#game-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("missing canvas bounds");
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.55;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 4);
  await page.mouse.up();

  await expect(page.getByTestId("editor-undo")).toBeEnabled();
  await page.getByTestId("editor-undo").click();

  // Delay a real successful response after the server wrote the sculpted data.
  // Undo while it is pending must stay dirty and reach disk on the next Save.
  let releaseFirstSave!: () => void;
  const firstResponseGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
  let firstSaveStarted = false;
  let holdFirstResponse = true;
  const landscapeWrites: number[][] = [];
  await page.route("**/__save-terrain-tile?**", async (route) => {
    const heights = Array.from(decodeTerrainTile(route.request().postDataBuffer()!).heights);
    // An already queued autosave can still carry the earlier flat Undo
    // snapshot. Let it finish and hold the first sculpted snapshot explicitly.
    const hold = holdFirstResponse && heights.some((height) => Math.abs(height) > 0.001);
    if (hold) holdFirstResponse = false;
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    if (hold) {
      firstSaveStarted = true;
      await firstResponseGate;
    }
    await route.fulfill({ response });
    if (hold || firstSaveStarted) landscapeWrites.push(heights);
  });
  try {
    await page.getByTestId("editor-redo").click();
    await page.getByTestId("editor-save").click();
    await expect.poll(() => firstSaveStarted).toBe(true);
    await page.getByTestId("editor-undo").click();
    const firstResponse = page.waitForResponse((response) => response.url().includes("/__save-terrain-tile?"));
    releaseFirstSave();
    await firstResponse;

    await page.getByTestId("editor-save").click();
    await expect.poll(() => landscapeWrites.length).toBeGreaterThanOrEqual(2);
    expect(landscapeWrites[0]!.some((height) => Math.abs(height) > 0.001)).toBeTruthy();
    expect(landscapeWrites[1]!.every((height) => Math.abs(height) < 0.001)).toBeTruthy();
    const undoneHeights = (await readSavedTerrain(page)).heights;
    expect(undoneHeights).toEqual(landscapeWrites[1]);

    await page.getByTestId("editor-redo").click();
    await page.getByTestId("editor-save").click();
    await expect.poll(() => landscapeWrites.length).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 10_000 });
  } finally {
    releaseFirstSave();
    await page.unroute("**/__save-terrain-tile?**");
  }

  const landscapeData = await readSavedTerrain(page);
  expect(landscapeData.heights.some((height) => Math.abs(height) > 0.001)).toBeTruthy();

  await page.goto(`/?editor&landscapeSmokeReload=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first().click();
  await expect(
    page.locator('[data-inspector-pane="details"] [data-landscape-tool="raise"]'),
  ).toBeVisible();
  const reloadedData = await readSavedTerrain(page);
  expect(reloadedData.heights.some((height) => Math.abs(height) > 0.001)).toBeTruthy();

  expect(pageErrors).toEqual([]);
});
