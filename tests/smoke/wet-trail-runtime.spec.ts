import { writeFile } from "node:fs/promises";
import { expect, test } from "./test";

type Qa = {
  read(): { speed: number; wheels: { contact: boolean; point: number[] | null; water: number | null; shore: number }[]; wetTrailCells: number | null; hasWaterQuery: boolean };
};

test("a vehicle driven out of a Lake leaves a wet trail on the dry ground past its shore", async ({ page }, info) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
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
    // Contacts past the wet shore band too: a print hidden inside it would not show.
    for (const wheel of sample.wheels) if (wheel.contact && wheel.point && wheel.water === null && wheel.shore < 0.05) dryPoints.push(wheel.point);
    log.push({ t: i * 0.3, sample });
    if (dryPoints.length >= 40) break;
  }
  await page.keyboard.up("KeyW");
  // The track texture under the wheels' first contacts on dry-looking ground.
  const printed = await page.evaluate((points) => points.map(([x, , z]) => ({ x, z, wet: (window as any).wetTrailQA.textureWet(x, z) })), dryPoints.slice(0, 24));
  log.push({ printed });
  await writeFile(info.outputPath("wet-trail-runtime.json"), JSON.stringify(log, null, 2));
  await page.screenshot({ path: info.outputPath("wet-trail-runtime.png") });
  expect(maxCells, "wet prints after leaving the Lake").toBeGreaterThan(0);
  expect(Math.max(...printed.map((point: { wet: number | null }) => point.wet ?? 0)), "the print reaches dry-looking ground past the shore band").toBeGreaterThan(60);
  expect(errors).toEqual([]);
});
