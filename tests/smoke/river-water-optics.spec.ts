import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { OpticsOptions } from "./pages/river-water-optics";

type Snapshot = ReturnType<Window["__riverOptics"]["snapshot"]>;
const browserErrors = new WeakMap<Page, string[]>();
async function frame(page: Page, patch: Partial<OpticsOptions>) {
  return page.evaluate((options) => window.__riverOptics.frame(options), patch);
}
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const channel = (shot: Snapshot, c: number, edge = false) => mean((edge ? shot.edge : shot.centre).map((p) => p[c]!));
const contrast = (shot: Snapshot) => {
  const luminances = shot.centre.map((p) => mean(p));
  return Math.max(...luminances) - Math.min(...luminances);
};
async function evidence(info: TestInfo, name: string, data: unknown) {
  await writeFile(info.outputPath(`${name}.json`), JSON.stringify(data, null, 2));
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto("/tests/smoke/pages/river-water-optics.html");
  await page.waitForFunction(() => !!window.__riverOptics);
});
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

test("water interface: clear river and lake preserve reflection energy through alpha blending", async ({ page }, info) => {
  const measurements = [];
  for (const kind of ["river", "lake"] as const) {
    const signals = [];
    for (const opacity of [1, 0]) {
      const red = await frame(page, { kind, isolateReflection: true, angle: "grazing", depth: 0.1,
        opacity, bedVisibility: 1, absorptionDistance: 100, reflection: "red", pipeline: "composer" });
      const blue = await frame(page, { reflection: "blue" });
      const signal = channel(red, 0) - channel(blue, 0);
      signals.push(signal); measurements.push({ kind, opacity, red, blue, signal });
    }
    // Black bed/body isolate interface energy from tint and output nonlinearity.
    // Clear water must retain the same reflected radiance as opaque water.
    expect(signals[0]!).toBeGreaterThan(15);
    expect(Math.abs(signals[1]! - signals[0]!)).toBeLessThan(3);
  }
  await evidence(info, "reflection-energy", measurements);
});

test("river optics: grazing reflection exceeds top-down, underside stays bounded", async ({ page }, info) => {
  const measurements: Record<string, unknown> = {};
  const signals: number[] = [];
  for (const angle of ["top", "grazing", "below"] as const) {
    const red = await frame(page, { angle, pipeline: "composer", depth: 2.2, opacity: 1, bedVisibility: 0, reflection: "red" });
    const blue = await frame(page, { reflection: "blue" });
    const signal = channel(red, 0) - channel(blue, 0);
    measurements[angle] = { red, blue, signal };
    signals.push(signal);
    await page.screenshot({ path: info.outputPath(`reflection-${angle}.png`) });
  }
  await evidence(info, "angle", measurements);
  expect(signals[0]!).toBeGreaterThanOrEqual(0);
  expect(signals[1]! - signals[0]!).toBeGreaterThan(15);
  expect(signals[2]!).toBeLessThan(3);
});

test("river optics: a 64px sphere capture blends with a 256px sky without new reflection targets", async ({ page }, info) => {
  const sky = await frame(page, { angle: "grazing", reflection: "red", bedVisibility: 0, opacity: 1, pipeline: "composer" });
  const probe = await frame(page, { localProbe: true });
  expect(channel(probe, 2) - channel(sky, 2)).toBeGreaterThan(10);
  expect(channel(sky, 0) - channel(probe, 0)).toBeGreaterThan(10);
  // First use can initialise a borrowed map. Rebinding must then stay stable.
  for (let i = 0; i < 4; i++) await frame(page, { localProbe: i % 2 === 0 });
  const rebound = await frame(page, { localProbe: true });
  expect(rebound.textures).toBe(probe.textures);
  await page.screenshot({ path: info.outputPath("sphere-capture.png") });
  await evidence(info, "sphere-capture", { sky, probe });
});

test("river optics: neutral direct and composer output agree at fixed exposure", async ({ page }, info) => {
  const shots = [];
  // Opaque isolates output conversion from screen-space alpha blending, which
  // naturally happens in different spaces on the two pipelines.
  for (const exposure of [0.2, 1]) {
    const direct = await frame(page, { calibration: true, opacity: 1, reflection: "off", exposure, pipeline: "direct" });
    const composer = await frame(page, { pipeline: "composer" });
    shots.push({ direct, composer });
    await frame(page, { pipeline: "direct" });
    await page.screenshot({ path: info.outputPath(`neutral-direct-${exposure}.png`) });
    await frame(page, { pipeline: "composer" });
    await page.screenshot({ path: info.outputPath(`neutral-composer-${exposure}.png`) });
  }
  await evidence(info, "output", shots);
  for (const { direct, composer } of shots) {
    expect(Math.max(...[0, 1, 2].map((c) => Math.abs(channel(direct, c) - channel(composer, c))))).toBeLessThan(3);
  }
});

test("river optics: sloped transformed surfaces preserve world-space optics and orthographic view", async ({ page }, info) => {
  const shots = [];
  for (const orthographic of [false, true]) {
    const base = await frame(page, { orthographic, slope: 0.12, normalMap: true,
      angle: "grazing", reflection: "red", opacity: 1, pipeline: "composer", transformed: false });
    const transformed = await frame(page, { transformed: true });
    shots.push({ base, transformed });
    expect(Math.max(...transformed.centre.flatMap((p, i) => p.map((v, c) => Math.abs(v - base.centre[i]![c]!))))).toBeLessThan(3);
    await page.screenshot({ path: info.outputPath(`sloped-${orthographic ? "ortho" : "perspective"}.png`) });
  }
  await evidence(info, "world-space", shots);
});

test("river optics: bed contrast decreases with depth and dry bed draws no water", async ({ page }, info) => {
  const shots: { depth: number; off: Snapshot; on: Snapshot; contrast: number }[] = [];
  for (const depth of [0, 0.1, 1, 2.2, 5]) {
    const off = await frame(page, { depth, visible: false, pipeline: "composer", reflection: "off" });
    const on = await frame(page, { visible: true });
    shots.push({ depth, off, on, contrast: contrast(on) });
    await page.screenshot({ path: info.outputPath(`depth-${depth}.png`) });
  }
  // The default nearly opaque preset must still meet the bed at a soft edge.
  const defaultShallow = await frame(page, { depth: 0.1, bedVisibility: 0.05, absorptionDistance: 0.5, opacity: 0.82 });
  await page.screenshot({ path: info.outputPath("default-shallow.png") });
  await evidence(info, "depth", { shots, defaultShallow });
  expect(contrast(shots[0]!.off)).toBeGreaterThan(50);
  expect(Math.max(...shots[0]!.on.centre.flatMap((p, i) => p.map((v, c) => Math.abs(v - shots[0]!.off.centre[i]![c]!))))).toBeLessThan(2);
  for (let i = 1; i < shots.length; i++) expect(shots[i]!.contrast).toBeLessThan(shots[i - 1]!.contrast - 2);
  expect(contrast(defaultShallow)).toBeGreaterThan(15);
});

test("river optics: deep ribbon edge has no false shallow colour or white foam outline", async ({ page }, info) => {
  const clear = await frame(page, { depth: 5, opacity: 1, foamOpacity: 0, pipeline: "composer", time: 2 });
  const foamy = await frame(page, { foamOpacity: 0.92 });
  await evidence(info, "edge", { clear, foamy });
  await page.screenshot({ path: info.outputPath("deep-edge.png") });
  for (const c of [0, 1, 2]) {
    expect(Math.abs(channel(clear, c, true) - channel(clear, c))).toBeLessThan(5);
    expect(Math.abs(channel(foamy, c, true) - channel(clear, c, true))).toBeLessThan(5);
  }
});

test("river optics: controls round-trip, animation survives, Off / Low stays target-free", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const first = await page.evaluate(() => window.__riverOptics.snapshot());
  await page.selectOption("#angle", "grazing");
  await expect(page.locator("#status")).toContainText("grazing");
  await page.selectOption("#pipeline", "composer");
  await page.selectOption("#depth", "5");
  await page.selectOption("#reflection", "red");
  await page.uncheck("#visible");
  expect((await page.evaluate(() => window.__riverOptics.snapshot())).options.visible).toBe(false);
  await page.check("#visible");
  await page.selectOption("#angle", "top");
  await page.selectOption("#pipeline", "direct");
  await page.selectOption("#depth", "1");
  await page.selectOption("#reflection", "off");
  const restored = await page.evaluate(() => window.__riverOptics.snapshot());
  expect(restored.centre).toEqual(first.centre);
  const calm = await frame(page, { normalMap: true, time: 0, opacity: 1, bedVisibility: 0,
    reflection: "red", angle: "grazing", exposure: 1, pipeline: "composer" });
  const flowing = await frame(page, { time: 2 });
  expect(Math.max(...flowing.centre.flatMap((p, i) => p.map((v, c) => Math.abs(v - calm.centre[i]![c]!))))).toBeGreaterThan(1);
  const stableTextures = flowing.textures;
  for (let i = 0; i < 8; i++) await frame(page, { depth: i % 2 ? 0.1 : 5 });
  const last = await frame(page, { depth: 1 });
  expect(last.textures).toBe(stableTextures);
  await page.setViewportSize({ width: 600, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("controls-small.png") });
  await evidence(info, "controls", { first, restored, calm, flowing, last, errors });
  expect(errors).toEqual([]);
});
