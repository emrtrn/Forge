import { expect, test } from "./test";

test("editor toolbar keeps its controls inside the viewport after resizing", async ({ page }, testInfo) => {
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("quality-button").hover();
  await page.locator('[data-quality-choice="medium"]').click();
  await expect(page.locator("[data-quality-label]")).toHaveText("Medium");
  await page.mouse.move(0, 400);
  for (const width of [1920, 1601, 1600, 1440, 1280, 1024, 800]) {
    await page.setViewportSize({ width, height: 900 });
    const controls = await page.locator('.editor-lead > button, .editor-history-actions button, .editor-tools button, .editor-snaps select, .add-actor-menu > button, .editor-view-controls > .topbar-menu > button, .editor-play-button').evaluateAll((elements) =>
      elements.filter((element) => (element as HTMLElement).offsetParent !== null).map((element) => {
        const rect = element.getBoundingClientRect();
        return { name: element.getAttribute("aria-label") ?? element.textContent?.trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }));
    await page.screenshot({ path: testInfo.outputPath(`toolbar-${width}.png`) });
    expect.soft(controls.filter((control) => control.left < 0 || control.right > width || control.top < 0 || control.bottom > 900), `toolbar at ${width}px`).toEqual([]);
    for (let index = 1; index < controls.length; index += 1) {
      const a = controls[index - 1]!;
      const b = controls[index]!;
      expect.soft(a.right <= b.left || a.bottom <= b.top || b.bottom <= a.top, `${a.name} and ${b.name} at ${width}px`).toBe(true);
    }
  }
  await page.getByTestId("quality-button").hover();
  await page.locator('[data-quality-choice="auto"]').click();
  await expect(page.locator("[data-quality-label]")).toHaveText("Auto");
});

test("manual Save remains busy until its response completes", async ({ page }) => {
  await page.goto("/?editor");
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });
  const save = page.getByTestId("editor-save");
  await save.click();
  await expect(save).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId("editor-status")).toContainText("Saved");

  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/__save-layout", async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await save.click();
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute("aria-busy", "true");
  } finally {
    release();
  }
  await expect(save).toBeEnabled({ timeout: 60_000 });
  await expect(save).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("editor-status")).toContainText("Saved");
});
