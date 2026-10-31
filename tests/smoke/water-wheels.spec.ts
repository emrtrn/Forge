import { expect, test } from "@playwright/test";

test("water wheels: downhill river ripples and live foam on both water bodies use the shared material", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/tests/smoke/pages/water-wheels.html");
  await page.waitForFunction(() => !!window.__waterWheels);
  const results = [];
  for (const kind of ["river", "lake"] as const) {
    const still = await page.evaluate(kind => window.__waterWheels.frame({ kind, moving: false, foam: true, submerged: false }), kind);
    expect(still.ripples).toBe(0); expect(still.foam).toBe(0);
    const moving = await page.evaluate(kind => window.__waterWheels.frame({ kind, moving: true, foam: true, submerged: false }), kind);
    expect(moving.ripples).toBeGreaterThan(0); expect(moving.foam).toBeGreaterThan(0); expect(moving.foamReady).toBe(1);
    expect(moving.white - still.white).toBeGreaterThan(30);
    expect(moving.glError).toBe(0); expect(moving.draws).toBeLessThanOrEqual(6);
    await page.screenshot({ path: info.outputPath(`${kind}-wheel-foam.png`) });
    const low = await page.evaluate(kind => window.__waterWheels.frame({ kind, moving: true, foam: false, submerged: false, highlight: true }), kind);
    expect(low.ripples).toBeGreaterThan(0); expect(low.foam).toBe(0); expect(low.glError).toBe(0);
    await page.screenshot({ path: info.outputPath(`${kind}-wheel-ripples.png`) });
    const flat = await page.evaluate(kind => window.__waterWheels.frame({ kind, moving: true, foam: false, submerged: false, ripples: false, highlight: true }), kind);
    expect(low.samples.filter((v, i) => Math.abs(v - flat.samples[i]!) > 2).length, `${kind} rings must change the rendered surface`).toBeGreaterThan(10);
    const submerged = await page.evaluate(kind => window.__waterWheels.frame({ kind, moving: true, foam: true, submerged: true }), kind);
    expect(submerged.ripples).toBe(0); expect(submerged.foam).toBe(0);
    results.push({ kind, still, moving, low, submerged });
  }
  await info.attach("wheel-water-effects", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  expect(errors).toEqual([]);
});
