import { expect, type Page } from "./test";

/**
 * Add Actor → Terrain → World Builder…: opens the World Builder window (or
 * keeps it open) with its random world choices.
 */
export async function openWorldBuilder(page: Page): Promise<void> {
  await page.getByTestId("add-actor-button").hover();
  await page.locator("[data-add-actor-popover]").getByRole("button", { name: /^Terrain/ }).hover();
  await page.locator('[data-add-categories] [data-add-key="worldBuilder"]').click();
  await expect(page.getByTestId("world-builder-window")).toBeVisible();
  await expect(page.getByTestId("random-world-panel")).toBeVisible();
}

/**
 * The window's body fits its width: nothing in it (the body clips sideways)
 * is wider than it, so no row is cut off or needs a sideways scroll.
 */
export async function expectNoSidewaysOverflow(page: Page): Promise<void> {
  const widths = await page.getByTestId("world-builder-window").locator("[data-forge-window-body]")
    .evaluate((body) => ({ scroll: body.scrollWidth, client: body.clientWidth }));
  expect(widths.scroll, "World Builder window content wider than the window").toBeLessThanOrEqual(widths.client);
}
