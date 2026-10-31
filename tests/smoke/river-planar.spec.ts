import { expect, test } from "@playwright/test";

test("river planar: all tiers, downhill seams, transformed cameras and bounded captures", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.goto("/tests/smoke/pages/river-planar.html");
  await page.waitForFunction(() => !!window.__riverPlanar);
  const results = [];
  for (const quality of ["low", "medium", "high"] as const) {
    const result = await page.evaluate(q => window.__riverPlanar.frame({ quality: q }), quality);
    results.push({ quality, ...result });
    expect(result.glError).toBe(0);
    expect(Math.max(...result.counts)).toBeLessThanOrEqual(quality === "high" ? 2 : quality === "medium" ? 1 : 0);
    if (quality !== "low") {
      expect(result.patches).toBeGreaterThan(1); expect(result.active).toBeGreaterThan(0);
      expect(result.active).toBeLessThanOrEqual(quality === "high" ? 4 : 2);
      expect(result.sizes.length).toBeGreaterThan(0);
      expect(result.sizes.every((s: number) => s === (quality === "high" ? 512 : 256))).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`river-${quality}.png`) });
  }
  expect(results[2]!.red - results[0]!.red).toBeGreaterThan(1000);
  for (const orthographic of [false, true]) for (const transformed of [false, true]) {
    const result = await page.evaluate(patch => window.__riverPlanar.frame(patch), { quality: "high" as const, orthographic, transformed });
    expect(result.glError).toBe(0); expect(result.sizes.length).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath(`river-camera-${orthographic}-${transformed}.png`) });
  }
  const flat = await page.evaluate(() => window.__riverPlanar.frame({ sloped: false, transformed: false }));
  expect(flat.patches).toBe(1); expect(flat.active).toBe(1);
  const hidden = await page.evaluate(() => window.__riverPlanar.frame({ visible: false }));
  expect(hidden.counts.every(n => n === 0)).toBe(true); expect(hidden.active).toBe(0);
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__riverPlanar.frame({ quality: "high", sloped: true, visible: true }));
  const released = await page.evaluate(() => window.__riverPlanar.frame({ quality: "low" }));
  expect(released.textures).toBe(results[0]!.textures);
  await info.attach("quality-and-cost", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  expect(errors).toEqual([]);
});
