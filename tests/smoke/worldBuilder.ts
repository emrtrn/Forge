import { expect, type Page } from "./test";

/** Add Actor → Terrain → World Builder…: opens the World Builder window (or keeps it open). */
export async function openWorldBuilder(page: Page): Promise<void> {
  await page.getByTestId("add-actor-button").hover();
  await page.locator("[data-add-actor-popover]").getByRole("button", { name: /^Terrain/ }).hover();
  await page.locator('[data-add-categories] [data-add-key="worldBuilder"]').click();
  await expect(page.getByTestId("world-builder-window")).toBeVisible();
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
