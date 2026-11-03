import { expect, test } from "@playwright/test";

test("puddle wind visual: shared normal animates reflected courtyard without changing water geometry", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/tests/smoke/pages/terrain-puddle.html");
  await page.waitForFunction(() => !!window.__terrainPuddle);
  await page.evaluate(() => window.__terrainPuddle.pause());
  const before = await page.evaluate(() => window.__terrainPuddle.snapshot());
  await page.evaluate(() => window.__terrainPuddle.wind(0, 0));
  await page.screenshot({ path: info.outputPath("wind-calm.png") });
  const windy = await page.evaluate(() => window.__terrainPuddle.wind(1, 1));
  await page.screenshot({ path: info.outputPath("wind-breeze.png") });
  await page.evaluate(() => window.__terrainPuddle.wind(1, 2, true));
  await page.screenshot({ path: info.outputPath("wind-overhead.png") });
  const after = await page.evaluate(() => window.__terrainPuddle.snapshot());
  expect(windy.glError).toBe(0); expect(after.area).toBe(before.area); expect(after.level).toBe(before.level);
  expect(after.geometries).toBe(before.geometries); expect(errors).toEqual([]);
  const fit = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight, panel: document.querySelector("aside")!.getBoundingClientRect().toJSON() }));
  expect(fit.scrollWidth).toBe(fit.width); expect(fit.scrollHeight).toBe(fit.height); expect(fit.panel.bottom).toBeLessThan(fit.height);
});

test("puddle prototype: real wheel ruts change horizontal water coverage and reset releases geometry", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/tests/smoke/pages/terrain-puddle.html");
  await page.waitForFunction(() => !!window.__terrainPuddle);
  // Software WebGL must not spend every idle frame rendering during assertions.
  await page.evaluate(() => window.__terrainPuddle.pause());
  const before = await page.evaluate(() => window.__terrainPuddle.snapshot());
  expect(before.area).toBeGreaterThan(1); expect(before.depth).toBe(0);
  await page.screenshot({ path: info.outputPath("puddle-before.png") });
  await page.getByRole("button", { name: "Aracı geçir" }).click();
  await page.evaluate(() => window.__terrainPuddle.advance(210));
  const after = await page.evaluate(() => window.__terrainPuddle.snapshot());
  expect(after.depth).toBeGreaterThan(.1);
  expect(after.base - after.bed).toBeGreaterThan(.05);
  expect(after.level).toBe(before.level);
  expect(after.area).toBeGreaterThan(before.area + .05);
  expect(after.triangles).toBeGreaterThan(before.triangles);
  expect(after.glError).toBe(0);
  await page.screenshot({ path: info.outputPath("puddle-ruts.png") });
  await page.getByLabel("Su yüzeyini göster").uncheck();
  await page.evaluate(() => window.__terrainPuddle.render());
  await page.screenshot({ path: info.outputPath("puddle-ruts-water-off.png") });
  await page.getByLabel("Su yüzeyini göster").check();
  await page.evaluate(() => window.__terrainPuddle.render());
  await page.locator("#level").evaluate(element => {
    (element as HTMLInputElement).value = "-6"; element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const lowered = await page.evaluate(() => window.__terrainPuddle.snapshot());
  expect(lowered.area).toBeLessThan(after.area); expect(lowered.depth).toBe(after.depth);
  await page.locator("#level").evaluate(element => {
    (element as HTMLInputElement).value = "-2"; element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Sıfırla" }).click();
  await page.evaluate(() => { for (let i = 0; i < 11; i++) window.__terrainPuddle.reset(); });
  await page.evaluate(() => window.__terrainPuddle.render());
  const reset = await page.evaluate(() => window.__terrainPuddle.snapshot());
  expect(reset.depth).toBe(0); expect(reset.area).toBeCloseTo(before.area, 5);
  expect(reset.geometries).toBeLessThanOrEqual(before.geometries);
  expect(reset.glError).toBe(0); expect(errors).toEqual([]);
  await info.attach("puddle-measurements", { body: JSON.stringify({ before, after, lowered, reset }, null, 2), contentType: "application/json" });
});
