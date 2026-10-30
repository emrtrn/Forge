import { expect, test } from "./test";

test("Lake and River crest foam follows raised waves, controls, lighting and quality", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/tests/smoke/pages/water-crest-foam.html");
  await page.waitForFunction(() => !!(window as any).__crestQA);
  const frame = (t = 3, debug = false, far = false) => page.evaluate(([t, debug, far]) => (window as any).__crestQA.frame(t, debug, far), [t, debug, far] as const);
  const evidence: Record<string, unknown> = {};
  for (const kind of ["lake", "river"] as const) {
    await page.locator("#kind").selectOption(kind);
    await page.waitForFunction(() => (window as any).__crestQA.frame().ready === 1);
    const on = await frame(), mask = await frame(3, true);
    expect(on.error).toBe(0); expect(mask.error).toBe(0);
    expect(mask.crests).toBeGreaterThan(300); expect(mask.foam).toBeGreaterThan(100);
    expect(mask.valleys).toBeGreaterThan(300); expect(mask.valleyFoam).toBe(0);
    await frame(); await page.screenshot({ path: info.outputPath(`${kind}-crest-day.png`) });
    const moved = await frame(4);
    expect(moved.calls).toBe(on.calls);
    await page.locator("#enabled").uncheck(); const off = await frame();
    expect(off.strength).toBe(0);
    expect(on.samples.reduce((n: number, v: number, i: number) => n + Math.abs(v - off.samples[i]), 0)).toBeGreaterThan(100);
    await page.locator("#enabled").check();
    await page.locator("#strength").fill("0"); await page.locator("#strength").press("Tab");
    expect((await frame(3, true)).foam).toBe(0);
    await page.locator("#strength").fill("0.75"); await page.locator("#strength").press("Tab");
    await page.locator("#threshold").fill("0.9"); await page.locator("#threshold").press("Tab");
    const highThreshold = await frame(3, true); expect(highThreshold.foam).toBeLessThan(mask.foam);
    await page.locator("#threshold").fill("0.35"); await page.locator("#threshold").press("Tab");
    await page.locator("#waves").uncheck(); const calm = await frame(3, true); expect(calm.foam).toBe(0);
    await page.locator("#waves").check();
    await page.locator("#quality").selectOption("low"); expect((await frame()).strength).toBe(0);
    await page.locator("#quality").selectOption("medium"); expect((await frame()).strength).toBe(.75);
    await page.locator("#quality").selectOption("high");
    await page.locator("#light").selectOption("shadow"); await frame();
    await page.screenshot({ path: info.outputPath(`${kind}-crest-shadow.png`) });
    await page.locator("#light").selectOption("night"); const night = await frame();
    await page.screenshot({ path: info.outputPath(`${kind}-crest-night.png`) });
    await page.locator("#enabled").uncheck(); const darkOff = await frame();
    expect(night.ambient).toEqual([0,0,0]); expect(night.sun).toEqual([0,0,0]);
    const rise = (a: number[], b: number[]) => a.reduce((n, v, i) => n + Math.max(0, v - b[i]!), 0) / a.length;
    // The direct transparent path blends after output transfer. Check the
    // whole composite like the existing Lake shore test, rather than treating
    // a tiny change in alpha/output transfer as emitted foam light.
    expect(rise(night.samples, darkOff.samples)).toBeLessThan(rise(on.samples, off.samples) * .1);
    await page.locator("#enabled").check();
    await page.locator("#light").selectOption("day"); await frame(3, false, true);
    await page.screenshot({ path: info.outputPath(`${kind}-crest-far.png`) });
    evidence[kind] = { mask: { ...mask, samples: undefined }, highThreshold: { ...highThreshold, samples: undefined }, calm: { ...calm, samples: undefined } };
  }
  expect(errors).toEqual([]);
  await info.attach("crest-metrics", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
});
