import { expect, test } from "./test";

test.use({ viewport: { width: 960, height: 600 }, launchOptions: {
  ...(process.env.FORGE_CHROMIUM_EXECUTABLE ? { executablePath: process.env.FORGE_CHROMIUM_EXECUTABLE } : {}),
  args: ["--enable-unsafe-swiftshader"],
} });

test("ocean: real planar capture at a distant anchor, live quality and off/environment fallback keep FFT state", async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/tests/smoke/pages/ocean-reference.html");
  await expect.poll(() => page.evaluate(() => window.__oceanLab?.stats().ready ?? false), { timeout: 60_000 }).toBe(true);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Reflect", exact: true }).click();
  await page.evaluate(() => {
    window.__oceanLab.setDark(true);
    window.__oceanLab.appearance({ shallowColor: "#000000", deepColor: "#000000", foamStrength: 0, roughness: .04 });
  });
  const initial = await page.evaluate(() => window.__oceanLab.stats());
  const empty = await page.evaluate(() => window.__oceanLab.measure());
  expect(empty.finite).toBe(true); expect(empty.waterRed).toBeLessThan(.00001);
  expect(initial.reflectionSources).toBe(0); expect(initial.anchor[0]).toBeGreaterThan(9000);
  await page.locator("#reflections").selectOption("sharedPlanar");
  const reflected = await page.evaluate(() => window.__oceanLab.measure());
  const active = await page.evaluate(() => window.__oceanLab.stats());
  expect(reflected.finite).toBe(true); expect(reflected.waterRed).toBeGreaterThan(empty.waterRed + .0001);
  expect(reflected.waterRed).toBeGreaterThan(reflected.waterGreen * 2 + .0001);
  expect(active.planarEnabled).toBe(1); expect(active.planarCaptures).toBeGreaterThan(initial.planarCaptures);
  expect(active.reflectionSources).toBe(1); expect(active.reflectionSize).toBe(256);
  expect(active.time).toBe(initial.time); expect(active.updates).toBe(initial.updates); expect(active.anchor).toEqual(initial.anchor);
  await page.evaluate(() => window.__oceanLab.appearance({ reflectionQuality: "high" }));
  await page.evaluate(() => window.__oceanLab.measure());
  expect((await page.evaluate(() => window.__oceanLab.stats())).reflectionSize).toBe(512);
  await page.evaluate(() => window.__oceanLab.setReflectionCeiling("medium"));
  await page.evaluate(() => window.__oceanLab.measure());
  expect((await page.evaluate(() => window.__oceanLab.stats())).reflectionSize).toBe(256);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__oceanLab.setReflectionCeiling("off"));
    const fallback = await page.evaluate(() => window.__oceanLab.measure());
    expect(fallback.waterRed).toBeLessThan(.00001);
    const disabled = await page.evaluate(() => window.__oceanLab.stats());
    expect(disabled.reflectionSources).toBe(0); expect(disabled.planarEnabled).toBe(0);
    expect(disabled.time).toBe(initial.time); expect(disabled.textures).toBeLessThanOrEqual(initial.textures);
    await page.evaluate(() => window.__oceanLab.setReflectionCeiling("medium"));
    expect((await page.evaluate(() => window.__oceanLab.measure())).waterRed).toBeGreaterThan(.0001);
  }
  await page.evaluate(() => {
    window.__oceanLab.setDark(false);
    window.__oceanLab.appearance({ shallowColor: "#28b5ac", deepColor: "#073448", foamStrength: .75, roughness: .16 });
  });
  await page.screenshot({ path: info.outputPath("ocean-planar.png") });
  await page.locator("#reflections").selectOption("environment");
  await page.screenshot({ path: info.outputPath("ocean-environment.png") });
  expect((await page.evaluate(() => window.__oceanLab.stats())).reflectionSources).toBe(0);
  await page.locator("#reflections").selectOption("off");
  await page.evaluate(() => window.__oceanLab.measure());
  expect((await page.evaluate(() => window.__oceanLab.stats())).planarEnabled).toBe(0);
  await info.attach("reflection-radiance", { body: JSON.stringify({ empty, reflected }), contentType: "application/json" });
  expect(errors).toEqual([]);
});
