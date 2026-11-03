import { expect, type Page } from "./test";

export type WorldBuilderTab = "setup" | "plan" | "stages" | "preview" | "layers";

/**
 * Add Actor → Terrain → World Builder…: opens the World Builder window (or
 * keeps it open), then shows `tab` when given. A tab other than Setup waits
 * for the recipe to load (only Setup is enabled before).
 */
export async function openWorldBuilder(page: Page, tab?: WorldBuilderTab): Promise<void> {
  await page.getByTestId("add-actor-button").hover();
  await page.locator("[data-add-actor-popover]").getByRole("button", { name: /^Terrain/ }).hover();
  await page.locator('[data-add-categories] [data-add-key="worldBuilder"]').click();
  await expect(page.getByTestId("world-builder-window")).toBeVisible();
  if (tab) await showWorldBuilderTab(page, tab);
}

/** Switches the open World Builder window to `tab`. */
export async function showWorldBuilderTab(page: Page, tab: WorldBuilderTab): Promise<void> {
  const button = page.getByTestId(`world-builder-window-tab-${tab}`);
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();
  await expect(page.getByTestId("world-builder-panel")).toHaveAttribute("data-tab", tab);
}

/**
 * The active tab fits the window's width: nothing in the body (which clips
 * sideways) is wider than it, so no row is cut off or needs a sideways scroll.
 */
export async function expectNoSidewaysOverflow(page: Page): Promise<void> {
  const widths = await page.getByTestId("world-builder-window").locator("[data-forge-window-body]")
    .evaluate((body) => ({ scroll: body.scrollWidth, client: body.clientWidth }));
  expect(widths.scroll, "World Builder tab content wider than the window").toBeLessThanOrEqual(widths.client);
}

/**
 * Drags the window by its title bar to the right edge (over the Details
 * panel) so viewport picking in the middle of the canvas is not under it.
 */
export async function parkWorldBuilder(page: Page): Promise<void> {
  const frame = page.getByTestId("world-builder-window");
  const titlebar = frame.locator("[data-forge-window-titlebar]");
  const box = await titlebar.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("World Builder window is not open");
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewport.width - 1, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const parked = await frame.boundingBox();
  expect(Math.round((parked?.x ?? 0) + (parked?.width ?? 0))).toBe(viewport.width);
}
