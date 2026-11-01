import { expect, test } from "@playwright/test";
test("Lake underwater: depth fog, split waterline, quality, excluded terrain and MSAA", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/tests/smoke/pages/lake-underwater.html"); await page.waitForFunction(() => !!window.__lakeUnderwater);
  const clear = await page.evaluate(() => window.__lakeUnderwater.frame({ enabled: false, view: "below" }));
  const submerged = await page.evaluate(() => window.__lakeUnderwater.frame({ enabled: true }));
  expect(submerged.activeBody).toBe("lake-1"); expect(submerged.maskDraws).toBe(2); expect(submerged.depthAvailable).toBe(true); expect(submerged.glError).toBe(0);
  expect(submerged.centre).not.toEqual(clear.centre); await page.screenshot({ path: info.outputPath("underwater.png") });
  const halfOff = await page.evaluate(() => window.__lakeUnderwater.frame({ enabled: false, view: "half" }));
  const half = await page.evaluate(() => window.__lakeUnderwater.frame({ enabled: true }));
  expect(half.glError).toBe(0); expect(half.top).toEqual(halfOff.top); expect(half.bottom).not.toEqual(halfOff.bottom);
  await page.screenshot({ path: info.outputPath("waterline.png") });
  for (const view of ["above", "island", "outside", "bed"] as const) {
    const result = await page.evaluate(view => window.__lakeUnderwater.frame({ view }), view);
    expect(result.activeBody, view).toBe(null); expect(result.maskDraws).toBe(0); expect(result.glError).toBe(0);
  }
  const low = await page.evaluate(() => window.__lakeUnderwater.frame({ view: "below", quality: "low" }));
  expect(low.maskResolution).toEqual([320, 240]); expect(low.particles).toBe(0);
  const msaa = await page.evaluate(() => window.__lakeUnderwater.frame({ quality: "high", msaa: true }));
  expect(msaa.depthAvailable).toBe(true); expect(msaa.maskDraws).toBe(2); expect(msaa.glError).toBe(0);
  const up = await page.evaluate(() => window.__lakeUnderwater.frame({ view: "up" }));
  expect(up.centre.reduce((a, b) => a + b, 0)).toBeGreaterThan(30); expect(up.glError).toBe(0);
  await page.screenshot({ path: info.outputPath("surface-from-below.png") });
  const ortho = await page.evaluate(() => window.__lakeUnderwater.frame({ view: "below", orthographic: true, reversed: true }));
  expect(ortho.maskDraws).toBe(2); expect(ortho.glError).toBe(0);
  const warm = await page.evaluate(() => window.__lakeUnderwater.frame({ orthographic: false, reversed: false, msaa: false }));
  for (let cycle = 0; cycle < 4; cycle++) {
    const air = await page.evaluate(() => window.__lakeUnderwater.frame({ view: "above" }));
    expect(air.maskDraws).toBe(0); expect(air.requiresPipeline).toBe(false);
    const restored = await page.evaluate(() => window.__lakeUnderwater.frame({ view: "below" }));
    expect(restored.textures).toBe(warm.textures); expect(restored.glError).toBe(0);
  }
  const waveA = await page.evaluate(() => window.__lakeUnderwater.frame({ view: "half", waves: true, time: 0 }));
  const waveB = await page.evaluate(() => window.__lakeUnderwater.frame({ time: 2 }));
  expect(waveA.centre).not.toEqual(waveB.centre); expect(waveB.glError).toBe(0);
  const recolored = await page.evaluate(() => window.__lakeUnderwater.frame({ view: "below", deepColor: "#164f80" }));
  expect(recolored.centre).not.toEqual(submerged.centre);
  const resized = await page.evaluate(() => window.__lakeUnderwater.frame({ width: 800, height: 600 }));
  expect(resized.maskResolution).toEqual([800, 600]); expect(resized.glError).toBe(0);
  await info.attach("underwater-measurements", { body: JSON.stringify({ clear, submerged, halfOff, half, low, msaa, up }), contentType: "application/json" });
  expect(errors).toEqual([]);
});
