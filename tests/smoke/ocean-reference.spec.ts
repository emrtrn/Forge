import { expect, test } from "./test";

test.use({ viewport: { width: 960, height: 600 }, launchOptions: {
  ...(process.env.FORGE_CHROMIUM_EXECUTABLE ? { executablePath: process.env.FORGE_CHROMIUM_EXECUTABLE } : {}),
  args: ["--enable-unsafe-swiftshader"],
} });

test("ocean: FFT, shared optics, darkness, depth/normal overrides and safe rebuilds", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/tests/smoke/pages/ocean-reference.html");
  await expect.poll(() => page.evaluate(() => window.__oceanLab?.stats().ready ?? false), { timeout: 60_000 }).toBe(true);
  const initial = await page.evaluate(() => window.__oceanLab.stats());
  expect(initial.errors).toEqual([]); expect(initial.island).toBe("dry"); expect(initial.basin).toBe("dry"); expect(initial.offshore).toBe("wet");
  expect(initial.fftBytes).toBeGreaterThan(22 * 1024 ** 2); expect(initial.draws).toBeGreaterThanOrEqual(21);
  expect(initial.transmission).toBe(1); expect(initial.snapshots).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const frozen = await page.evaluate(() => window.__oceanLab.stats().time);
  const probe = await page.evaluate(() => window.__oceanLab.probe());
  expect(probe).toHaveLength(64); expect(probe.every(Number.isFinite)).toBe(true);
  expect(Math.max(...probe.filter((_, i) => i % 4 === 1)) - Math.min(...probe.filter((_, i) => i % 4 === 1))).toBeGreaterThan(.01);
  // Wait for rendered frames while simulation remains paused; rendering must not advance the FFT.
  const frame = await page.evaluate(() => window.__oceanLab.stats().frame);
  await expect.poll(() => page.evaluate(() => window.__oceanLab.stats().frame)).toBeGreaterThan(frame + 2);
  expect(await page.evaluate(() => window.__oceanLab.stats().time)).toBe(frozen);
  await page.screenshot({ path: testInfo.outputPath("ocean-coast.png") });
  await page.getByRole("button", { name: "Open sea", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("ocean-open-sea.png") });
  const day = await page.evaluate(() => window.__oceanLab.measure());
  expect(day.finite).toBe(true); expect(day.radiance).toBeGreaterThan(.0001);
  await page.evaluate(() => window.__oceanLab.setDark(true));
  const dark = await page.evaluate(() => window.__oceanLab.measure());
  expect(dark.finite).toBe(true); expect(dark.radiance).toBeLessThan(day.radiance * .01);
  await testInfo.attach("surface-radiance", { body: JSON.stringify({ day, dark }), contentType: "application/json" });
  await page.evaluate(() => window.__oceanLab.setDark(false));
  for (const kind of ["normal", "depth"] as const) {
    const auxiliary = await page.evaluate(kind => window.__oceanLab.override(kind), kind);
    expect(auxiliary.frozen).toBe(true); expect(auxiliary.variation).toBeGreaterThan(4);
  }
  await page.evaluate(() => window.__oceanLab.setTransmission(false));
  await expect.poll(() => page.evaluate(() => window.__oceanLab.stats().transmission)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("ocean-direct-fallback.png") });
  await page.evaluate(() => window.__oceanLab.setTransmission(true));
  await expect.poll(() => page.evaluate(() => window.__oceanLab.stats().transmission)).toBe(1);
  await page.locator("#backend").selectOption("analytic");
  expect(await page.evaluate(() => window.__oceanLab.stats().backend)).toBe("analytic");
  await page.screenshot({ path: testInfo.outputPath("ocean-analytic.png") });
  await page.locator("#backend").selectOption("fft");
  await page.getByRole("button", { name: "Aerial", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("ocean-aerial.png") });
  const before = await page.evaluate(() => window.__oceanLab.stats());
  expect(await page.evaluate(() => window.__oceanLab.rebuild(true))).toBe(false);
  expect(await page.evaluate(() => window.__oceanLab.stats().ready)).toBe(true);
  for (let i = 0; i < 3; i++) expect(await page.evaluate(() => window.__oceanLab.rebuild())).toBe(true);
  const after = await page.evaluate(() => window.__oceanLab.stats());
  expect(after.textures).toBeLessThanOrEqual(before.textures + 1);
  expect(after.geometries).toBeLessThanOrEqual(before.geometries + 1);
  expect(after.errors).toEqual([]);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  // Three fresh FFTs leave a cold mip/render queue on software GPUs.
  await expect.poll(() => page.evaluate(() => window.__oceanLab.stats().time), { timeout: 60_000 }).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
