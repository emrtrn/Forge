import { addLandscapeFromMenu, readSavedTerrain } from "./terrain";
import { expect, test, type Page } from "./test";

test.setTimeout(240_000);

async function saveLayout(page: Page): Promise<void> {
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-save")).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 10_000 });
}

async function setRuleNumber(page: Page, rule: number, field: string, value: string): Promise<void> {
  const input = page.locator(`[data-auto-rule="${rule}"][data-auto-field="${field}"]`);
  await input.fill(value);
  await input.press("Tab");
}

/** Auto Paint tab: a base layer and a slope rule repaint the whole terrain in one undo step. */
test("editor Landscape Auto Paint: height/slope rules repaint the terrain, undoable", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });

  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });
  const existing = page.getByTestId("outliner-row").filter({ hasText: "Landscape" });
  if (await existing.count()) {
    await existing.first().click();
    await page.keyboard.press("Delete");
    await expect(existing).toHaveCount(0);
  }
  await addLandscapeFromMenu(page);
  await page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first().click();
  await expect(page.locator("[data-landscape-mode]")).toBeVisible();

  // A raised bump gives the flat terrain some slope.
  await page.locator("[data-landscape-mode]").selectOption("sculpt");
  await page.locator('[data-landscape-tool="raise"]').click();
  await page.evaluate(() => {
    for (const [key, value] of [["brushSize", "12"], ["strength", "2"]] as const) {
      const input = document.querySelector<HTMLInputElement>(`[data-landscape-number="${key}"]`);
      if (!input) throw new Error(`missing landscape input: ${key}`);
      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  const box = await page.locator("#game-canvas").boundingBox();
  if (!box) throw new Error("missing canvas bounds");
  const [x, y] = [box.x + box.width * 0.5, box.y + box.height * 0.55];
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) await page.mouse.move(x + (i % 2) * 4, y + 1);
  await page.mouse.up();

  await page.locator("[data-landscape-mode]").selectOption("paint");
  await page.locator('[data-landscape-paint-panel="auto"]').click();
  // The brush controls give way to the rules.
  await expect(page.locator("[data-landscape-paint-tool]")).toHaveCount(0);
  await expect(page.locator("[data-landscape-fill]")).toHaveCount(0);
  await page.locator("[data-auto-base-layer]").selectOption("dirt");
  await page.locator('[data-landscape-layer="rock"]').click();
  await page.locator("[data-auto-rule-add]").click();
  await expect(page.locator("[data-auto-rule-layer=\"0\"]")).toHaveValue("rock");
  await setRuleNumber(page, 0, "slopeMin", "8");
  await setRuleNumber(page, 0, "heightMin", "-100");
  await setRuleNumber(page, 0, "heightMax", "100");
  await page.locator("[data-world-terrain-tools]").screenshot({ path: "test-results/landscape-auto-paint-panel.png" });

  await page.locator("[data-auto-apply]").click();
  await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Landscape Auto Paint", { timeout: 30_000 });
  // Rules survive the panel re-render.
  await expect(page.locator('[data-auto-rule="0"][data-auto-field="slopeMin"]')).toHaveValue("8");
  await saveLayout(page);
  const painted = await readSavedTerrain(page);
  const weights = (id: string) => painted.layers.find((layer) => layer.id === id)!.weights;
  const rock = weights("rock").filter((weight) => weight > 0.99).length;
  const dirt = weights("dirt").filter((weight) => weight > 0.99).length;
  expect(rock, "the bump's flanks are rock").toBeGreaterThan(0);
  expect(dirt, "flat ground is the base layer").toBeGreaterThan(rock);
  expect(weights("grass").every((weight) => weight === 0)).toBe(true);

  await page.getByTestId("editor-undo").click();
  await saveLayout(page);
  const undone = await readSavedTerrain(page);
  expect(undone.layers.find((layer) => layer.id === "grass")!.weights.every((weight) => weight === 1)).toBe(true);
  expect(pageErrors).toEqual([]);
});
