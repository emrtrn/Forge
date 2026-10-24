import { expect, test } from "./test";

for (const tilesX of [1, 2]) {
  test(`Landscape ${tilesX}-tile mode, tool and layer changes preserve accordion sections`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.clear());
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?editor");
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("add-actor-button").hover();
    await page.getByRole("button", { name: /^Terrain/ }).hover();
    await page.locator("[data-add-categories]").getByRole("button", { name: "Landscape", exact: true }).click();
    const dialog = page.locator("[data-world-terrain-dialog]");
    await dialog.locator('[data-field="tilesX"]').fill(String(tilesX));
    await dialog.locator('[data-field="tileQuads"]').selectOption("64");
    await dialog.locator("[data-world-terrain-create]").click();
    await expect(dialog).toHaveCount(0);

    const details = page.locator('[data-inspector-pane="details"]');
    const mode = details.getByRole("combobox", { name: "Landscape edit mode" });
    const heading = (name: string) => details.getByRole("button", { name, exact: true });
    const heightmap = heading("Heightmap");
    await expect(mode).toHaveValue("sculpt");
    await expect(mode.locator("option")).toHaveText(tilesX === 1 ? ["Sculpt", "Paint", "Splines"] : ["Sculpt", "Paint"]);
    await expect(details.locator(".detail-section-toggle").nth(0)).toHaveText("Landscape Mode");
    await expect(details.locator(".detail-section-toggle").nth(1)).toHaveText("Heightmap");
    await expect(details.locator(".detail-section-toggle").nth(2)).toHaveText("Tiles");
    await expect(details.locator(".detail-section-toggle").nth(3)).toHaveText("Others");
    await heightmap.click();
    await heading("Tiles").click();

    const expectAccordion = async () => {
      await expect(heading("Landscape Mode")).toHaveAttribute("aria-expanded", "true");
      await expect(heightmap).toHaveAttribute("aria-expanded", "false");
      await expect(heading("Tiles")).toHaveAttribute("aria-expanded", "false");
      await expect(heading("Others")).toHaveAttribute("aria-expanded", "true");
      await expect(details.locator(".detail-section-title")).toHaveCount(0);
      await expect(details.locator(".detail-heading")).toHaveCount(0);
      await expect(details.locator("[data-details-sections-toggle]")).toHaveCount(1);
    };

    await mode.selectOption("paint");
    await expect(details.locator('[data-landscape-paint-tool="paint"]')).toBeVisible();
    await expectAccordion();
    await details.locator('[data-landscape-paint-tool="erase"]').click();
    await expect(details.locator('[data-landscape-paint-tool="erase"]')).toHaveClass("active");
    await expectAccordion();
    const layerId = await details.locator("[data-landscape-layer]").nth(1).getAttribute("data-landscape-layer");
    await details.locator("[data-landscape-layer]").nth(1).click();
    await expect(details.locator(`[data-landscape-layer="${layerId}"]`)).toHaveClass("active");
    await expectAccordion();
    await mode.selectOption("sculpt");
    await details.locator('[data-landscape-tool="smooth"]').click();
    await expect(details.locator('[data-landscape-tool="smooth"]')).toHaveClass("active");
    await expectAccordion();
    if (tilesX === 1) {
      await mode.selectOption("splines");
      await details.locator('[data-landscape-spline-tool="edit"]').click();
      await expectAccordion();
    }
    await mode.selectOption("paint");
    await expectAccordion();

    // Lock can be reversed after a full refresh; the replacement selector follows it.
    const lock = details.getByRole("checkbox", { name: "Lock Movement", exact: true });
    await lock.check();
    await expect(mode).toBeDisabled();
    await expectAccordion();
    await lock.uncheck();
    await expect(mode).toBeEnabled();
    await expectAccordion();

    const allSections = details.locator("[data-details-sections-toggle]");
    await allSections.click();
    await expect(mode).toBeHidden();
    await expect(allSections).toHaveAttribute("aria-label", "Expand all sections");
    await allSections.click();
    await expect(mode).toBeVisible();
    await heightmap.click();
    await heading("Tiles").click();
    await mode.selectOption("sculpt");
    await expectAccordion();
    await page.screenshot({ path: testInfo.outputPath("landscape-mode.png") });
    expect(errors).toEqual([]);
  });
}

test("Details panel exposes redesigned transform and material controls", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Shapes/ }).hover();
  await expect(page.getByTestId("add-shape-cube")).toBeVisible();
  await page.locator("#game-canvas").dispatchEvent("drop", {
    dataTransfer: await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.setData("application/x-3dgamedev-asset", "shape:cube");
      return data;
    }),
    clientX: 420,
    clientY: 320,
  });

  const details = page.locator('[data-inspector-pane="details"]');
  await expect(details.locator(".detail-heading")).toHaveCount(0);
  const sectionsToggle = details.locator("[data-details-sections-toggle]");
  await expect(sectionsToggle).toBeVisible();
  await expect(sectionsToggle).toHaveAttribute("aria-label", "Collapse all sections");
  await expect(details.locator(".detail-section-menu")).toHaveCount(0);
  await expect(details.locator("[data-add-component]")).toHaveCount(0);
  await expect(details.locator("[data-material-thumbnail]")).toBeVisible();

  const transform = details.locator('.detail-section[data-detail-section="transform"]');
  const toggle = transform.locator(".detail-section-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(transform.getByTestId("detail-px")).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(transform.getByTestId("detail-px")).toBeHidden();
  await toggle.click();
  await expect(transform.getByTestId("detail-px")).toBeVisible();

  await sectionsToggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(sectionsToggle).toHaveAttribute("aria-label", "Expand all sections");
  await sectionsToggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const pivot = details.locator('.detail-section[data-detail-section="pivot"]');
  await expect(pivot.getByRole("button", { name: "Reset Pivot" })).toBeVisible();
  await expect(pivot.getByRole("button", { name: "Center Pivot" })).toBeVisible();
  await expect(pivot.getByRole("button", { name: "Use Base" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("Mesh Paint and Foliage reuse the collapsible Details section chrome", async ({ page }) => {
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  await page.locator('[data-inspector-tab="meshPaint"]').dispatchEvent("click");
  const meshPaint = page.locator('[data-inspector-pane="meshPaint"]');
  const vertexSection = meshPaint.locator('[data-inspector-section="vertex-color"]');
  const vertexToggle = vertexSection.locator(":scope > .detail-section-heading .detail-section-toggle");
  await expect(vertexToggle).toHaveAttribute("aria-expanded", "true");
  await expect(vertexSection.locator(":scope > .detail-section-body > .detail-hint")).toHaveCount(0);
  await expect(vertexSection.getByRole("button", { name: "Fill", exact: true })).toBeVisible();
  await vertexToggle.click();
  await expect(vertexToggle).toHaveAttribute("aria-expanded", "false");
  await expect(vertexSection.locator(":scope > .detail-section-body")).toBeHidden();

  await page.locator('[data-inspector-tab="foliage"]').dispatchEvent("click");
  const foliage = page.locator('[data-inspector-pane="foliage"]');
  const toolsToggle = foliage.getByRole("button", { name: "Tools", exact: true });
  await expect(toolsToggle).toHaveAttribute("aria-expanded", "true");
  await toolsToggle.click();
  await expect(toolsToggle).toHaveAttribute("aria-expanded", "false");

  await page.locator('[data-inspector-tab="meshPaint"]').dispatchEvent("click");
  await page.locator('[data-inspector-tab="foliage"]').dispatchEvent("click");
  await expect(
    page.locator('[data-inspector-pane="foliage"]').getByRole("button", {
      name: "Tools",
      exact: true,
    }),
  ).toHaveAttribute("aria-expanded", "false");
});
