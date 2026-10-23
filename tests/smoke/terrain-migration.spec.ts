import { createFlatLandscapeData } from "../../engine/scene/landscape";
import { captureTerrainSnapshot } from "../../engine/terrain/terrainLandscapeBridge";
import { expect, test } from "./test";
import { SMOKE_ROAD_SIDECAR, SMOKE_SPLINE_SCENE } from "./smokeProject.mjs";
import { readSavedTerrain } from "./terrain";
import { levelTerrainPath } from "../../engine/terrain/terrainTypes";

test("terrain endpoints validate raw binaries, definitions and dropped fields", async ({ request }) => {
  const snapshot = captureTerrainSnapshot({ id: "validation", position: [0, 0, 0], dataRef: "landscapes/validation.landscape.json" }, createFlatLandscapeData("small"));
  const url = `/__save-terrain-tile?path=${snapshot.path}&key=0_0`;
  const globalUrl = `/__save-terrain-global?path=${snapshot.path}`;
  expect((await request.get("/__save-terrain")).status()).toBe(405);
  expect((await request.get(globalUrl)).status()).toBe(405);
  expect((await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: snapshot.def } })).status()).toBe(400);
  expect((await request.post(url, { data: Buffer.from(snapshot.bytes.subarray(0, 40)) })).status()).toBe(400);
  expect((await request.post(url.replace("key=0_0", "key=1_0"), { data: Buffer.from(snapshot.bytes) })).status()).toBe(400);
  expect((await request.post(url, { data: Buffer.from(snapshot.bytes) })).ok()).toBeTruthy();
  expect((await request.post(globalUrl, { data: Buffer.from(snapshot.global.subarray(0, 40)) })).status()).toBe(400);
  expect((await request.post("/__save-terrain-global?path=../escape.terrain.json", { data: Buffer.from(snapshot.global) })).status()).toBe(400);
  const mismatched = snapshot.global.slice();
  new DataView(mismatched.buffer).setUint16(26, snapshot.def.layers.length === 8 ? 7 : 8, true);
  expect((await request.post(globalUrl, { data: Buffer.from(mismatched) })).ok()).toBeTruthy();
  expect((await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: snapshot.def } })).status()).toBe(400);
  expect((await request.post(globalUrl, { data: Buffer.from(snapshot.global) })).ok()).toBeTruthy();
  const saved = await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: { ...snapshot.def, unsupported: 1 } } });
  expect(saved.ok()).toBeTruthy();
  expect((await saved.json()).dropped).toEqual(["terrain.unsupported"]);
  expect((await request.post("/__save-terrain", { data: { path: "../escape.terrain.json", terrain: snapshot.def } })).status()).toBe(400);
  expect((await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: { ...snapshot.def, tileQuads: 128 } } })).status()).toBe(400);
});

test("legacy terrain Save migrates files, preserves road/water IDs, reloads and plays", async ({ page, request }, testInfo) => {
  const oldBytes = await (await request.get(`/${SMOKE_ROAD_SIDECAR}`)).body();
  expect((await request.post("/__open-level", { data: { path: SMOKE_SPLINE_SCENE } })).ok()).toBeTruthy();
  const before = await (await request.get(`/${SMOKE_SPLINE_SCENE}`)).json();
  before.riverWaters = [{ id: "migration-river", name: "Migration River", landscapeRef: "smoke-road", splineRef: "smoke-road", surfaceLevel: -0.05 }];
  expect((await request.post("/__save-layout", { data: { layout: before, editor: {
    gridSize: 1, gridEnabled: true, snapRotationDeg: 15, snapRotationEnabled: true, snapScale: 0.1, snapScaleEnabled: true,
  } } })).ok()).toBeTruthy();
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/?editor&debug");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-project-name]")).toHaveText("__playwright-smoke-spline", { timeout: 60_000 });
  const savedResponse = page.waitForResponse((response) => response.url().endsWith("/__save-layout") && response.request().method() === "POST");
  await page.getByTestId("editor-save").click();
  expect((await savedResponse).ok()).toBeTruthy();
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 20_000 });
  const level = await (await request.get(`/${SMOKE_SPLINE_SCENE}`)).json();
  expect(level.landscapes[0].dataRef).toBe(levelTerrainPath(SMOKE_SPLINE_SCENE, before.landscapes[0].id));
  expect(level.landscapes[0].id).toBe(before.landscapes[0].id);
  expect(level.riverWaters).toEqual(before.riverWaters);
  expect(await (await request.get(`/${SMOKE_ROAD_SIDECAR}`)).body()).toEqual(oldBytes);
  const data = await readSavedTerrain(page, level.landscapes[0].dataRef);
  const legacy = JSON.parse(oldBytes.toString());
  expect(data.splines).toEqual(legacy.splines);
  expect(data.heights).toEqual(legacy.heights.map((h: number) => Math.fround(h * legacy.size.heightScale)));
  await page.reload();
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first()).toBeVisible();
  await expect(page.locator("[data-project-name]")).toHaveText("__playwright-smoke-spline", { timeout: 60_000 });
  await page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first().click();
  await page.keyboard.press("f");
  await page.screenshot({ path: testInfo.outputPath("terrain-migrated-editor.png") });
  await page.goto("/?debug");
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator("#debug-stats")).toContainText(/\d+ draw calls/, { timeout: 30_000 });
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("terrain-migrated-runtime.png") });
  expect(errors).toEqual([]);
});
