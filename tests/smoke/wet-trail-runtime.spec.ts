import { writeFile } from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./test";

type Source = { depth: number; length: number; strength: number; drySeconds: number } | null;
type Qa = {
  read(): { speed: number; wheels: { contact: boolean; point: number[] | null; source: Source }[]; wetTrailCells: number | null; hasWaterQuery: boolean };
};
const LEVEL = "**/assets/starter-content/Levels/Terrain.level.json";

/**
 * The real Terrain level's GAZ-52, its rear wheels in Lake 1 just inside the
 * shore, driven out under throttle. Returns the most wet-trail cells seen and
 * the track texture's wet print under the first dry contacts.
 */
async function driveOutOfLake(page: Page, info: TestInfo, name: string) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  // A small canvas: SwiftShader renders the full level on the CPU.
  await page.setViewportSize({ width: 320, height: 200 });
  await page.goto("/tests/smoke/pages/wet-trail-runtime.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).wetTrailQA)), { timeout: 120_000 }).toBe(true);
  // Lake geometry builds after the level loads.
  await expect.poll(() => page.evaluate(() => (window as any).wetTrailQA.wetAt(130.1, 102.2) as boolean), { timeout: 60_000 }).toBe(true);
  const log: unknown[] = [];
  const shore = await page.evaluate(() => (window as any).wetTrailQA.findShore([130.1, 102.2], [169.14, 125.86]));
  log.push({ shore });
  expect(shore.shore, "a shore between the Lake seed and the vehicle").not.toBeNull();
  const [sx, sz] = shore.shore as [number, number];
  const [dx, dz] = shore.dir as [number, number];
  await page.evaluate(([x, z, dir]) => (window as any).wetTrailQA.place(x, 1, z, dir), [sx - dx * 0.5, sz - dz * 0.5, shore.dir]);
  await page.waitForTimeout(2000);
  log.push({ settled: await page.evaluate(() => ((window as any).wetTrailQA as Qa).read()) });
  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await page.evaluate((dir) => (window as any).wetTrailQA.push(8, dir), shore.dir);
  let maxCells = 0;
  const dryPoints: number[][] = [];
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(300);
    const sample = await page.evaluate(() => ((window as any).wetTrailQA as Qa).read());
    maxCells = Math.max(maxCells, sample.wetTrailCells ?? 0);
    // Contacts past the water and its visibly wet shore.
    for (const wheel of sample.wheels) if (wheel.contact && wheel.point && wheel.source === null) dryPoints.push(wheel.point);
    log.push({ t: i * 0.3, sample });
    if (dryPoints.length >= 40) break;
  }
  await page.keyboard.up("KeyW");
  const printed = await page.evaluate((points) => points.map(([x, , z]) => ({ x, z, wet: (window as any).wetTrailQA.textureWet(x, z) as number | null })), dryPoints.slice(0, 24));
  log.push({ printed });
  await writeFile(info.outputPath(`${name}.json`), JSON.stringify(log, null, 2));
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
  return { maxCells, printed: Math.max(0, ...printed.map((point) => point.wet ?? 0)), dryContacts: dryPoints.length, errors };
}

test("a vehicle driven out of a Lake leaves a wet trail on the dry ground past its shore", async ({ page }, info) => {
  test.setTimeout(420_000);
  const result = await driveOutOfLake(page, info, "wet-trail-runtime");
  expect(result.dryContacts).toBeGreaterThan(0);
  expect(result.maxCells, "wet prints after leaving the Lake").toBeGreaterThan(0);
  expect(result.printed, "the print reaches dry-looking ground past the shore band").toBeGreaterThan(60);
  expect(result.errors).toEqual([]);
});

test("a Lake with its Wheel Wet Trail off soaks no tyre", async ({ page }, info) => {
  test.setTimeout(420_000);
  await page.route(LEVEL, async (route) => {
    const response = await route.fetch(); const level = await response.json();
    for (const lake of level.waterBodies ?? []) lake.appearance = { ...lake.appearance, wheelWetTrailEnabled: false };
    await route.fulfill({ response, json: level });
  });
  const result = await driveOutOfLake(page, info, "wet-trail-off");
  expect(result.dryContacts, "the vehicle still left the water").toBeGreaterThan(0);
  expect(result.maxCells).toBe(0);
  expect(result.printed).toBe(0);
  expect(result.errors).toEqual([]);
});
