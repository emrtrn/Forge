# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: terrain-migration.spec.ts >> legacy terrain Save migrates files, preserves road/water IDs, reloads and plays
- Location: tests\smoke\terrain-migration.spec.ts:41:1

# Error details

```
Test timeout of 150000ms exceeded.
```

```
Error: page.goto: Test timeout of 150000ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:5498/?editor&debug", waiting until "load"

```

# Test source

```ts
  1  | import { createFlatLandscapeData } from "../../engine/scene/landscape";
  2  | import { captureTerrainSnapshot } from "../../engine/terrain/terrainLandscapeBridge";
  3  | import { expect, test } from "./test";
  4  | import { SMOKE_ROAD_SIDECAR, SMOKE_SPLINE_SCENE } from "./smokeProject.mjs";
  5  | import { readSavedTerrain } from "./terrain";
  6  | import { levelTerrainPath } from "../../engine/terrain/terrainTypes";
  7  | 
  8  | test("terrain endpoints validate raw binaries, definitions and dropped fields", async ({ request }) => {
  9  |   const snapshot = captureTerrainSnapshot({ id: "validation", position: [0, 0, 0], dataRef: "landscapes/validation.landscape.json" }, createFlatLandscapeData("small"));
  10 |   const url = `/__save-terrain-tile?path=${snapshot.path}&key=0_0`;
  11 |   const globalUrl = `/__save-terrain-global?path=${snapshot.path}`;
  12 |   expect((await request.get("/__save-terrain")).status()).toBe(405);
  13 |   expect((await request.get(globalUrl)).status()).toBe(405);
  14 |   expect((await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: snapshot.def } })).status()).toBe(400);
  15 |   expect((await request.post(url, { data: Buffer.from(snapshot.bytes.subarray(0, 40)) })).status()).toBe(400);
  16 |   expect((await request.post(url.replace("key=0_0", "key=1_0"), { data: Buffer.from(snapshot.bytes) })).status()).toBe(400);
  17 |   expect((await request.post(url, { data: Buffer.from(snapshot.bytes) })).ok()).toBeTruthy();
  18 |   expect((await request.post(globalUrl, { data: Buffer.from(snapshot.global.subarray(0, 40)) })).status()).toBe(400);
  19 |   expect((await request.post("/__save-terrain-global?path=../escape.terrain.json", { data: Buffer.from(snapshot.global) })).status()).toBe(400);
  20 |   const mismatched = snapshot.global.slice();
  21 |   new DataView(mismatched.buffer).setUint16(26, snapshot.def.layers.length === 8 ? 7 : 8, true);
  22 |   expect((await request.post(globalUrl, { data: Buffer.from(mismatched) })).ok()).toBeTruthy();
  23 |   expect((await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: snapshot.def } })).status()).toBe(400);
  24 |   expect((await request.post(globalUrl, { data: Buffer.from(snapshot.global) })).ok()).toBeTruthy();
  25 |   const saved = await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: { ...snapshot.def, unsupported: 1 } } });
  26 |   expect(saved.ok()).toBeTruthy();
  27 |   expect((await saved.json()).dropped).toEqual(["terrain.unsupported"]);
  28 |   const world = { ...snapshot.def, splines: [{ id: "world-road", coordinateSpace: "world",
  29 |     points: [{ id: "p", position: [23, 7, -17], width: 2, falloff: 1 }], segments: [] }] };
  30 |   const worldSave = await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: world } });
  31 |   expect(worldSave.ok()).toBeTruthy();
  32 |   expect((await worldSave.json()).dropped).toEqual([]);
  33 |   expect((await (await request.get(`/${snapshot.path}`)).json()).splines).toEqual(world.splines);
  34 |   const invalid = { ...world, splines: [{ ...world.splines[0], coordinateSpace: "invalid" }] };
  35 |   expect((await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: invalid } })).status()).toBe(400);
  36 |   expect((await (await request.get(`/${snapshot.path}`)).json()).splines).toEqual(world.splines);
  37 |   expect((await request.post("/__save-terrain", { data: { path: "../escape.terrain.json", terrain: snapshot.def } })).status()).toBe(400);
  38 |   expect((await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: { ...snapshot.def, tileQuads: 128 } } })).status()).toBe(400);
  39 | });
  40 | 
  41 | test("legacy terrain Save migrates files, preserves road/water IDs, reloads and plays", async ({ page, request }, testInfo) => {
  42 |   const oldBytes = await (await request.get(`/${SMOKE_ROAD_SIDECAR}`)).body();
  43 |   expect((await request.post("/__open-level", { data: { path: SMOKE_SPLINE_SCENE } })).ok()).toBeTruthy();
  44 |   const before = await (await request.get(`/${SMOKE_SPLINE_SCENE}`)).json();
  45 |   before.riverWaters = [{ id: "migration-river", name: "Migration River", landscapeRef: "smoke-road", splineRef: "smoke-road", surfaceLevel: -0.05 }];
  46 |   expect((await request.post("/__save-layout", { data: { layout: before, editor: {
  47 |     gridSize: 1, gridEnabled: true, snapRotationDeg: 15, snapRotationEnabled: true, snapScale: 0.1, snapScaleEnabled: true,
  48 |   } } })).ok()).toBeTruthy();
  49 |   const errors: string[] = [];
  50 |   const messages: string[] = [];
  51 |   page.on("pageerror", (error) => errors.push(error.message));
  52 |   page.on("console", (message) => {
  53 |     messages.push(message.text());
  54 |     if (message.type() === "error") errors.push(message.text());
  55 |   });
> 56 |   await page.goto("/?editor&debug");
     |              ^ Error: page.goto: Test timeout of 150000ms exceeded.
  57 |   await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  58 |   await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });
  59 |   await expect(page.locator("[data-project-name]")).toHaveText("__playwright-smoke-spline", { timeout: 60_000 });
  60 |   const savedResponse = page.waitForResponse((response) => response.url().endsWith("/__save-layout") && response.request().method() === "POST");
  61 |   await page.getByTestId("editor-save").click();
  62 |   expect((await savedResponse).ok()).toBeTruthy();
  63 |   await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 20_000 });
  64 |   const level = await (await request.get(`/${SMOKE_SPLINE_SCENE}`)).json();
  65 |   expect(level.landscapes[0].dataRef).toBe(levelTerrainPath(SMOKE_SPLINE_SCENE, before.landscapes[0].id));
  66 |   expect(level.landscapes[0].id).toBe(before.landscapes[0].id);
  67 |   expect(level.riverWaters).toEqual(before.riverWaters);
  68 |   expect(await (await request.get(`/${SMOKE_ROAD_SIDECAR}`)).body()).toEqual(oldBytes);
  69 |   const data = await readSavedTerrain(page, level.landscapes[0].dataRef);
  70 |   const legacy = JSON.parse(oldBytes.toString());
  71 |   expect(data.splines).toEqual(legacy.splines);
  72 |   const definition = await (await request.get(`/${level.landscapes[0].dataRef}`)).json();
  73 |   expect(definition.splines).toEqual(legacy.splines.map((spline: { points: Array<{ position: number[] }> }) => ({
  74 |     ...spline, coordinateSpace: "world", points: spline.points.map((point) => ({
  75 |       ...point, position: point.position.map((value, axis) => Number((value + before.landscapes[0].position[axis]).toFixed(3))),
  76 |     })),
  77 |   })));
  78 |   expect(data.heights).toEqual(legacy.heights.map((h: number) => Math.fround(h * legacy.size.heightScale)));
  79 |   await page.reload();
  80 |   await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  81 |   await expect(page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first()).toBeVisible();
  82 |   await expect(page.locator("[data-project-name]")).toHaveText("__playwright-smoke-spline", { timeout: 60_000 });
  83 |   await page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first().click();
  84 |   await page.keyboard.press("f");
  85 |   expect((await readSavedTerrain(page, level.landscapes[0].dataRef)).splines).toEqual(legacy.splines);
  86 |   const repeatSave = page.waitForResponse((response) => response.url().endsWith("/__save-layout") && response.request().method() === "POST");
  87 |   await page.getByTestId("editor-save").click();
  88 |   expect((await repeatSave).ok()).toBeTruthy();
  89 |   await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 20_000 });
  90 |   expect((await (await request.get(`/${level.landscapes[0].dataRef}`)).json()).splines).toEqual(definition.splines);
  91 |   await page.screenshot({ path: testInfo.outputPath("terrain-migrated-editor.png") });
  92 |   await page.goto("/?debug");
  93 |   await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  94 |   await expect(page.locator("#debug-stats")).toContainText(/\d+ draw calls/, { timeout: 30_000 });
  95 |   await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  96 |   await page.screenshot({ path: testInfo.outputPath("terrain-migrated-runtime.png") });
  97 |   expect(errors).toEqual([]);
  98 | });
  99 | 
```