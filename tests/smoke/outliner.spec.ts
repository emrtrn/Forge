import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "./test";
import { SMOKE_SCENE, smokePublicPath } from "./smokeProject.mjs";

async function openRangeSelectionScene(page: Page, hierarchical = false): Promise<void> {
  const path = smokePublicPath(SMOKE_SCENE);
  const scene = JSON.parse(await readFile(path, "utf8"));
  scene.instances = [{
    assetId: "shape:cube",
    placements: Array.from({ length: 150 }, (_, index) => ({
      name: `Range ${String(index + 1).padStart(3, "0")}`,
      nodeId: `range-${index + 1}`,
      ...(hierarchical && index === 139 ? { parentId: "range-6" } : {}),
      position: [index * 2, 0, 0],
      scale: 1,
    })),
  }];
  await writeFile(path, JSON.stringify(scene));
  await page.goto("/?editor");
  await expect(page.getByTestId("outliner-row").filter({ hasText: "Range 150" })).toBeAttached({ timeout: 30_000 });
}

test("scene outliner Shift selects, shrinks, and reverses a 6-to-140 range", async ({ page }) => {
  await openRangeSelectionScene(page);
  await page.locator("[data-outliner-search]").fill("Range ");
  const rows = page.getByTestId("outliner-row");
  await expect(rows).toHaveCount(150);
  const ids = await rows.evaluateAll((entries) => entries.map((entry) => (entry as HTMLElement).dataset.objectId));
  const selectedIds = () => page.locator('[data-testid="outliner-row"].active').evaluateAll((entries) => entries.map((entry) => (entry as HTMLElement).dataset.objectId));

  await rows.nth(5).click();
  await rows.nth(139).click({ modifiers: ["Shift"] });
  await expect.poll(selectedIds).toEqual(ids.slice(5, 140));
  await expect(page.getByTestId("outliner-summary")).toContainText("135 selected");

  // Repeated Shift clicks retain the original anchor while replacing the range.
  await rows.nth(19).click({ modifiers: ["Shift"] });
  await expect.poll(selectedIds).toEqual(ids.slice(5, 20));
  await rows.nth(139).click();
  await rows.nth(5).click({ modifiers: ["Shift"] });
  await expect.poll(selectedIds).toEqual(ids.slice(5, 140));
  await rows.nth(19).click({ modifiers: ["Shift"] });
  await expect.poll(selectedIds).toEqual(ids.slice(19, 140));

  await rows.nth(0).click();
  await expect.poll(selectedIds).toEqual(ids.slice(0, 1));
});

test("scene outliner keeps Ctrl toggles and adds ranges with Ctrl+Shift", async ({ page }) => {
  await openRangeSelectionScene(page);
  const rows = page.getByTestId("outliner-row");
  const actor = (number: number) => rows.filter({ hasText: `Range ${String(number).padStart(3, "0")}` });
  const selected = page.locator('[data-testid="outliner-row"].active');
  await actor(1).click();
  await actor(6).click({ modifiers: ["Control"] });
  await expect(selected).toHaveCount(2);
  await actor(10).click({ modifiers: ["Control", "Shift"] });
  await expect(selected.locator("strong")).toHaveText(["Range 001", "Range 006", "Range 007", "Range 008", "Range 009", "Range 010"]);
  await actor(8).click({ modifiers: ["Control"] });
  await expect(selected).toHaveCount(5);
  await expect(actor(8)).not.toHaveClass(/active/);
});

test("scene outliner ranges follow visible hierarchy and reset a filtered-out anchor", async ({ page }) => {
  await openRangeSelectionScene(page, true);
  const rows = page.getByTestId("outliner-row");
  const actor = (number: number) => rows.filter({ hasText: `Range ${String(number).padStart(3, "0")}` });
  const selected = page.locator('[data-testid="outliner-row"].active');

  // Range 140 is a child of Range 006, so it appears before Range 007.
  await actor(6).click();
  await actor(7).click({ modifiers: ["Shift"] });
  await expect(selected.locator("strong")).toHaveText(["Range 006", "Range 140", "Range 007"]);

  await page.locator("[data-outliner-search]").fill("Range 14");
  await expect(rows).toHaveCount(10);
  await actor(142).click();
  await actor(146).click({ modifiers: ["Shift"] });
  await expect(selected.locator("strong")).toHaveText(["Range 142", "Range 143", "Range 144", "Range 145", "Range 146"]);
  await expect(page.getByTestId("outliner-summary")).toContainText("5 selected");

  await page.locator("[data-outliner-search]").fill("Range 00");
  await actor(3).click({ modifiers: ["Shift"] });
  await expect(selected.locator("strong")).toHaveText(["Range 003"]);
  await expect(page.getByTestId("outliner-summary")).toContainText("1 selected");
});

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
      return row !== null && row.getBoundingClientRect().height < element.getBoundingClientRect().height;
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
