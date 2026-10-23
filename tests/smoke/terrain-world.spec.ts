import { writeFile } from "node:fs/promises";
import { expect, test } from "./test";

/**
 * OPEN_WORLD_PLAN Faz 2: a multi-tile World Terrain (3×2 tiles, one missing)
 * drawn by the CDLOD renderer on the GPU, with only two tile slots so tile-slot
 * and global-map nodes meet. Seen from straight above, no magenta background
 * may show through the terrain's interior: that would be a crack at a tile
 * seam or an LOD/source boundary.
 */

interface TerrainWorldState {
  ready: boolean;
  resident: number;
  instances: number;
  slotNodes: number;
  cracks?: number;
  checked?: number;
}

test("multi-tile terrain draws without seam cracks where tile slots meet the global map", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 800 });

  for (const view of ["top", "grazing"] as const) {
    await page.goto(`/tests/smoke/pages/terrain-world.html?view=${view}`);
    await page.waitForFunction(() => (window as unknown as { terrainWorld?: { ready: boolean } }).terrainWorld?.ready === true, undefined, { timeout: 60_000 });
    const state = await page.evaluate(() => (window as unknown as { terrainWorld: TerrainWorldState }).terrainWorld);
    const screenshot = await page.screenshot();
    await writeFile(testInfo.outputPath(`terrain-world-${view}.png`), screenshot);
    await testInfo.attach(`terrain-world-${view}.png`, { body: screenshot, contentType: "image/png" });
    console.log(`[terrain-world] ${view} ${JSON.stringify(state)}`);
    expect(state.resident).toBe(2);
    expect(state.slotNodes).toBeGreaterThan(0);
    expect(state.slotNodes).toBeLessThan(state.instances);
    if (view === "top") {
      expect(state.checked).toBeGreaterThan(10_000);
      expect(state.cracks).toBe(0);
    }
  }
  expect(errors).toEqual([]);
});
