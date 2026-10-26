# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: river-water-optics.spec.ts >> river optics: grazing reflection exceeds top-down, underside stays bounded
- Location: tests\smoke\river-water-optics.spec.ts:25:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 15
Received:   -0.03703703703702388
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - heading "River water optics" [level=1] [ref=e2]
  - paragraph [ref=e3]: Fixed unlit bed, deterministic time, constant linear reflection input. No authored scene is loaded.
  - generic [ref=e4]:
    - generic [ref=e5]:
      - text: Camera
      - combobox "Camera" [ref=e6]:
        - option "Top" [selected]
        - option "Grazing"
        - option "Below"
    - generic [ref=e7]:
      - text: Output
      - combobox "Output" [ref=e8]:
        - option "Direct" [selected]
        - option "Composer"
    - generic [ref=e9]:
      - text: Depth
      - combobox "Depth m" [ref=e10]:
        - option "0"
        - option "0.1"
        - option "1" [selected]
        - option "2.2"
        - option "5"
      - text: m
    - generic [ref=e11]:
      - text: Reflection
      - combobox "Reflection" [ref=e12]:
        - option "Off / Low" [selected]
        - option "Red input"
        - option "Blue input"
    - generic [ref=e13]:
      - checkbox "Water" [checked] [ref=e14]
      - text: Water
  - status [ref=e16]: below · composer · depth 2.2 m · exposure 0.2
```

# Test source

```ts
  1   | import { expect, test, type Page, type TestInfo } from "@playwright/test";
  2   | import { writeFile } from "node:fs/promises";
  3   | import type { OpticsOptions } from "./pages/river-water-optics";
  4   | 
  5   | type Snapshot = ReturnType<Window["__riverOptics"]["snapshot"]>;
  6   | const browserErrors = new WeakMap<Page, string[]>();
  7   | async function frame(page: Page, patch: Partial<OpticsOptions>) {
  8   |   return page.evaluate((options) => window.__riverOptics.frame(options), patch);
  9   | }
  10  | const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  11  | const channel = (shot: Snapshot, c: number, edge = false) => mean((edge ? shot.edge : shot.centre).map((p) => p[c]!));
  12  | const contrast = (shot: Snapshot) => {
  13  |   const luminances = shot.centre.map((p) => mean(p));
  14  |   return Math.max(...luminances) - Math.min(...luminances);
  15  | };
  16  | async function evidence(info: TestInfo, name: string, data: unknown) {
  17  |   await writeFile(info.outputPath(`${name}.json`), JSON.stringify(data, null, 2));
  18  | }
  19  | 
  20  | test.beforeEach(async ({ page }) => {
  21  |   const errors: string[] = [];
  22  |   browserErrors.set(page, errors);
  23  |   page.on("pageerror", (error) => errors.push(error.message));
  24  |   page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  25  |   await page.setViewportSize({ width: 900, height: 720 });
  26  |   await page.goto("/tests/smoke/pages/river-water-optics.html");
  27  |   await page.waitForFunction(() => !!window.__riverOptics);
  28  | });
  29  | test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });
  30  | 
  31  | test("river optics: grazing reflection exceeds top-down, underside stays bounded", async ({ page }, info) => {
  32  |   const measurements: Record<string, unknown> = {};
  33  |   const signals: number[] = [];
  34  |   for (const angle of ["top", "grazing", "below"] as const) {
  35  |     const red = await frame(page, { angle, pipeline: "composer", depth: 2.2, opacity: 1, reflection: "red" });
  36  |     const blue = await frame(page, { reflection: "blue" });
  37  |     const signal = channel(red, 0) - channel(blue, 0);
> 38  |     measurements[angle] = { red, blue, signal };
      |                                     ^ Error: expect(received).toBeGreaterThan(expected)
  39  |     signals.push(signal);
  40  |     await page.screenshot({ path: info.outputPath(`reflection-${angle}.png`) });
  41  |   }
  42  |   await evidence(info, "angle", measurements);
  43  |   expect(signals[0]!).toBeGreaterThanOrEqual(0);
  44  |   expect(signals[1]! - signals[0]!).toBeGreaterThan(15);
  45  |   expect(signals[2]!).toBeLessThan(3);
  46  | });
  47  | 
  48  | test("river optics: neutral direct and composer output agree at fixed exposure", async ({ page }, info) => {
  49  |   const shots = [];
  50  |   // Opaque isolates output conversion from screen-space alpha blending, which
  51  |   // naturally happens in different spaces on the two pipelines.
  52  |   for (const exposure of [0.2, 1]) {
  53  |     const direct = await frame(page, { calibration: true, opacity: 1, reflection: "off", exposure, pipeline: "direct" });
  54  |     const composer = await frame(page, { pipeline: "composer" });
  55  |     shots.push({ direct, composer });
  56  |     await page.screenshot({ path: info.outputPath(`neutral-composer-${exposure}.png`) });
  57  |   }
  58  |   await evidence(info, "output", shots);
  59  |   for (const { direct, composer } of shots) {
  60  |     expect(Math.max(...[0, 1, 2].map((c) => Math.abs(channel(direct, c) - channel(composer, c))))).toBeLessThan(3);
  61  |   }
  62  | });
  63  | 
  64  | test("river optics: bed contrast decreases with depth and dry bed draws no water", async ({ page }, info) => {
  65  |   const shots: { depth: number; off: Snapshot; on: Snapshot; contrast: number }[] = [];
  66  |   for (const depth of [0, 0.1, 1, 2.2, 5]) {
  67  |     const off = await frame(page, { depth, visible: false, pipeline: "composer", reflection: "off" });
  68  |     const on = await frame(page, { visible: true });
  69  |     shots.push({ depth, off, on, contrast: contrast(on) });
  70  |     await page.screenshot({ path: info.outputPath(`depth-${depth}.png`) });
  71  |   }
  72  |   // The default nearly opaque preset must still meet the bed at a soft edge.
  73  |   const defaultShallow = await frame(page, { depth: 0.1, bedVisibility: 0.05, absorptionDistance: 0.5, opacity: 0.82 });
  74  |   await evidence(info, "depth", { shots, defaultShallow });
  75  |   expect(contrast(shots[0]!.off)).toBeGreaterThan(50);
  76  |   expect(Math.max(...shots[0]!.on.centre.flatMap((p, i) => p.map((v, c) => Math.abs(v - shots[0]!.off.centre[i]![c]!))))).toBeLessThan(2);
  77  |   for (let i = 1; i < shots.length; i++) expect(shots[i]!.contrast).toBeLessThan(shots[i - 1]!.contrast - 2);
  78  |   expect(contrast(defaultShallow)).toBeGreaterThan(15);
  79  | });
  80  | 
  81  | test("river optics: deep ribbon edge has no false shallow colour or white foam outline", async ({ page }, info) => {
  82  |   const clear = await frame(page, { depth: 5, opacity: 1, foamOpacity: 0, pipeline: "composer" });
  83  |   const foamy = await frame(page, { foamOpacity: 0.92 });
  84  |   await evidence(info, "edge", { clear, foamy });
  85  |   await page.screenshot({ path: info.outputPath("deep-edge.png") });
  86  |   for (const c of [0, 1, 2]) {
  87  |     expect(Math.abs(channel(clear, c, true) - channel(clear, c))).toBeLessThan(5);
  88  |     expect(Math.abs(channel(foamy, c, true) - channel(clear, c, true))).toBeLessThan(5);
  89  |   }
  90  | });
  91  | 
  92  | test("river optics: controls round-trip, animation survives, Off / Low stays target-free", async ({ page }, info) => {
  93  |   const errors: string[] = [];
  94  |   page.on("pageerror", (error) => errors.push(error.message));
  95  |   page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  96  |   const first = await page.evaluate(() => window.__riverOptics.snapshot());
  97  |   await page.selectOption("#angle", "grazing");
  98  |   await expect(page.locator("#status")).toContainText("grazing");
  99  |   await page.selectOption("#pipeline", "composer");
  100 |   await page.selectOption("#depth", "5");
  101 |   await page.selectOption("#reflection", "red");
  102 |   await page.uncheck("#visible");
  103 |   expect((await page.evaluate(() => window.__riverOptics.snapshot())).options.visible).toBe(false);
  104 |   await page.check("#visible");
  105 |   await page.selectOption("#angle", "top");
  106 |   await page.selectOption("#pipeline", "direct");
  107 |   await page.selectOption("#depth", "1");
  108 |   await page.selectOption("#reflection", "off");
  109 |   const restored = await page.evaluate(() => window.__riverOptics.snapshot());
  110 |   expect(restored.centre).toEqual(first.centre);
  111 |   const calm = await frame(page, { normalMap: true, time: 0, opacity: 1, pipeline: "composer" });
  112 |   const flowing = await frame(page, { time: 2 });
  113 |   expect(Math.max(...flowing.centre.flatMap((p, i) => p.map((v, c) => Math.abs(v - calm.centre[i]![c]!))))).toBeGreaterThan(1);
  114 |   const stableTextures = flowing.textures;
  115 |   for (let i = 0; i < 8; i++) await frame(page, { depth: i % 2 ? 0.1 : 5 });
  116 |   const last = await frame(page, { depth: 1 });
  117 |   expect(last.textures).toBe(stableTextures);
  118 |   await page.setViewportSize({ width: 600, height: 720 });
  119 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  120 |   await page.screenshot({ path: info.outputPath("controls-small.png") });
  121 |   await evidence(info, "controls", { first, restored, calm, flowing, last, errors });
  122 |   expect(errors).toEqual([]);
  123 | });
  124 | 
```