import { expect, test } from "@playwright/test";

test("scene outliner uses the extensible inspector tab shell", async ({ page }) => {
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  const outlinerTabs = page.getByRole("tablist", { name: "Outliner panels" });
  const sceneTab = outlinerTabs.getByRole("tab", { name: "Scene Outliner" });
  await expect(outlinerTabs).toBeVisible();
  await expect(sceneTab).toHaveAttribute("aria-selected", "true");
  await expect(sceneTab).toHaveAttribute("aria-controls", "scene-outliner-pane");
  const scenePane = page.locator('[data-outliner-pane="scene"]');
  await expect(scenePane).toBeVisible();
  await expect(outlinerTabs.getByTestId("outliner-filter")).toHaveCount(0);
  await expect(scenePane.locator(".outliner-search-row").getByTestId("outliner-filter")).toBeVisible();
  expect(
    await sceneTab.evaluate((tab) => getComputedStyle(tab, "::after").backgroundColor),
  ).toBe("rgb(47, 111, 237)");
});

test("scene outliner smoke: filter, visibility, lock, and summary", async ({ page }) => {
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  const rows = page.getByTestId("outliner-row");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".outliner-search-wrap")).toBeVisible();
  await expect(page.locator("[data-outliner-search]")).toHaveAttribute("placeholder", "Search actors...");
  await expect(page.locator(".outliner-search-wrap > svg")).toBeVisible();
  const initialCount = await rows.count();
  await expect(page.getByTestId("outliner-summary")).toContainText(`${initialCount} actors`);

  const firstRow = rows.first();
  await firstRow.getByRole("button", { name: "Hide object" }).click();
  await expect(firstRow).toHaveClass(/is-hidden/);
  await firstRow.getByRole("button", { name: "Show object" }).click();
  await expect(firstRow).not.toHaveClass(/is-hidden/);

  await firstRow.getByRole("button", { name: "Lock object" }).click();
  await expect(firstRow.getByRole("button", { name: "Unlock object" })).toBeVisible();
  await firstRow.getByRole("button", { name: "Unlock object" }).click();
  await expect(firstRow.getByRole("button", { name: "Lock object" })).toBeVisible();

  await page.getByTestId("outliner-filter").click();
  const meshFilter = page.locator('[data-outliner-type-filter="mesh"]');
  const meshCount = await page.locator('[data-outliner-type="mesh"]').count();
  await meshFilter.uncheck();
  await expect(page.getByTestId("outliner-filter")).toHaveClass(/is-filtered/);
  await expect(rows).toHaveCount(initialCount - meshCount);
});

test("scene outliner keeps filtered rows compact and reveals the selected actor", async ({ page }) => {
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  const list = page.locator("[data-outliner-list]");
  const rows = page.getByTestId("outliner-row");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const firstRow = rows.first();
  const firstLabel = (await firstRow.locator("strong").textContent())?.trim() ?? "";
  expect(firstLabel.length).toBeGreaterThan(0);

  await page.locator("[data-outliner-search]").fill(firstLabel.slice(0, 3));
  await expect(rows.first()).toHaveClass(/outliner-row/);
  expect(
    await rows.evaluateAll((entries) => entries.every((entry) => entry.getBoundingClientRect().height <= 42)),
  ).toBe(true);
  expect(
    await list.evaluate((element) => {
      const row = element.querySelector<HTMLElement>("[data-object-id]");
      return Boolean(row) && row.getBoundingClientRect().height < element.getBoundingClientRect().height;
    }),
  ).toBe(true);

  await page.locator("[data-outliner-search]").fill("");
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await firstRow.dispatchEvent("click");
  await expect(firstRow).toHaveClass(/active/);
  expect(
    await firstRow.evaluate((row) => {
      const list = row.closest<HTMLElement>("[data-outliner-list]");
      if (!list) return false;
      const rowRect = row.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      return rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom;
    }),
  ).toBe(true);
});
