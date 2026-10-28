import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { PerspectiveCamera } from "three";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { createFlatTerrainTile, terrainTilePath, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { expect, test, type Page } from "./test";
import { SMOKE_SPLINE_SCENE, smokePublicPath } from "./smokeProject.mjs";

/**
 * The GPU CDLOD terrain renderer draws a Landscape in the real browser: shaders
 * compile (lit, and the GTAO normal / DOF depth materials used when those
 * passes override the scene), and the terrain covers the frame from several
 * viewpoints. The fixture is a one-tile World Terrain written straight to disk.
 *
 * Its acceptance run against the old chunk mesh (Faz 2 slice 1) measured at
 * most 0.11/255 mean difference; that renderer is gone, so this guards the
 * draw itself. Screenshots are attached for a human look.
 */

const LEVEL = "layouts/__playwright-terrain-render.level.json";
const POST_LEVEL = "layouts/__playwright-terrain-render-post.level.json";
const TERRAIN = "landscapes/terrain-render.terrain.json";
const VERTICES_X = 129;
const VERTICES_Z = 129;

/**
 * A hilly Landscape with slope/height-painted layers and a textured base layer,
 * in the smoke level's lighting and no sky (the sky dome renders black in
 * headless Chromium, which would hide the terrain behind a constant). A second
 * level adds AO + DOF.
 */
async function writeFixture(): Promise<void> {
  const heights: number[] = [];
  for (let z = 0; z < VERTICES_Z; z += 1) {
    for (let x = 0; x < VERTICES_X; x += 1) {
      heights.push(14 * Math.sin(x * 0.045) * Math.cos(z * 0.031) + 5 * Math.sin((x + z) * 0.11) + 0.002 * (x - 100) ** 2);
    }
  }
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const layer = (id: string, weight: (height: number, slope: number) => number, material?: string) => ({
    id, name: id, ...(material ? { material } : {}), weights: [] as number[], weight,
  });
  const layers = [
    layer("grass", (_h, s) => 1 - Math.min(1, s * 2.5), "starter-mat-grass"),
    layer("dirt", (_h, s) => Math.min(1, s * 2.5) * 0.6),
    layer("rock", (_h, s) => Math.min(1, s * 2.5) * 0.4),
    layer("snow", (h) => Math.max(0, (h - min) / (max - min) - 0.75) * 4),
  ];
  const at = (x: number, z: number) =>
    heights[Math.min(VERTICES_Z - 1, Math.max(0, z)) * VERTICES_X + Math.min(VERTICES_X - 1, Math.max(0, x))]!;
  for (let z = 0; z < VERTICES_Z; z += 1) {
    for (let x = 0; x < VERTICES_X; x += 1) {
      const slope = Math.hypot(at(x + 1, z) - at(x - 1, z), at(x, z + 1) - at(x, z - 1)) / 2;
      const raw = layers.map((entry) => Math.max(0, entry.weight(at(x, z), slope)));
      const total = raw.reduce((sum, value) => sum + value, 0) || 1;
      raw.forEach((value, index) => layers[index]!.weights.push(value / total));
    }
  }
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Landscape", tileQuads: VERTICES_X - 1, spacing: 1, tilesX: 1, tilesZ: 1,
    origin: [-(VERTICES_X - 1) / 2, 0, -(VERTICES_Z - 1) / 2], heightMin: -64, heightMax: 64,
    layers: layers.map(({ id, name, material }) => ({ id, name, color: "#808080", ...(material ? { material } : {}) })),
    tiles: [{ key: "0_0", minHeight: min, maxHeight: max }], collision: true,
  };
  const tile = createFlatTerrainTile(def, 0, 0);
  tile.heights.set(heights);
  layers.forEach((entry, layer) => entry.weights.forEach((weight, index) => {
    tile.weights[index * 4 + layer] = Math.round(weight * 255);
  }));
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  level.name = "__playwright-terrain-render";
  level.instances = [];
  level.landscapes = [{ id: "render", name: "Landscape", position: [0, 0, 0], dataRef: TERRAIN }];
  await mkdir(dirname(smokePublicPath(terrainTilePath(TERRAIN, "0_0"))), { recursive: true });
  await writeFile(smokePublicPath(TERRAIN), JSON.stringify(def));
  await writeFile(smokePublicPath(terrainTilePath(TERRAIN, "0_0")), encodeTerrainTile(tile, { heightMin: -64, heightMax: 64, heightFormat: "f32" }));
  await writeFile(smokePublicPath(LEVEL), JSON.stringify(level));
  // AO and DOF render the scene with an override material; the terrain must
  // take part in both (postProcess.ts) or its shaders never compile here.
  level.postProcess = {
    ...level.postProcess,
    ao: { enabled: true, radius: 1, intensity: 1 },
    dof: { enabled: true, focusDistance: 120, aperture: 0.3, maxBlur: 0.5 },
  };
  await writeFile(smokePublicPath(POST_LEVEL), JSON.stringify(level));
}

/** Editor camera poses (world space; the fixture is centred on the origin). */
const VIEWS = {
  overview: { level: LEVEL, position: [-150, 100, 120], target: [0, 0, 0] },
  grazing: { level: LEVEL, position: [-90, 40, -60], target: [50, 0, 30] },
  "ao-dof": { level: POST_LEVEL, position: [-150, 100, 120], target: [0, 0, 0] },
} as const;

type View = keyof typeof VIEWS;

function cameraPose(view: View) {
  const camera = new PerspectiveCamera();
  const { position, target } = VIEWS[view];
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(target[0], target[1], target[2]);
  return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] };
}

async function capture(page: Page, request: APIRequestContext, view: View): Promise<Buffer> {
  const { level } = VIEWS[view];
  expect((await request.post("/__open-level", { data: { path: level } })).ok()).toBeTruthy();
  // The editor restores this per-level pose on boot (editor/input/editorCameraPose.ts).
  await page.addInitScript(({ key, pose }) => {
    localStorage.clear();
    localStorage.setItem(key, pose);
  }, { key: `forge.editor.cameraPose.${encodeURIComponent(level)}`, pose: JSON.stringify(cameraPose(view)) });
  await page.goto(`/?editor&terrainRender=${view}-${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first()).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2_500);
  // An element screenshot of a WebGL canvas reads an empty drawing buffer;
  // clip a page screenshot to the viewport instead.
  const clip = await page.locator("[data-viewport-host]").boundingBox();
  if (!clip) throw new Error("Missing viewport bounds");
  return page.screenshot({ clip });
}

/** Share of pixels that differ from the viewport's background (its corner pixel). */
async function coverage(page: Page, image: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    // A few pixels in: the viewport frame's border line is not background.
    const corner = (4 * bitmap.width + 4) * 4;
    let covered = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const delta = Math.max(
        Math.abs(pixels[index]! - pixels[corner]!),
        Math.abs(pixels[index + 1]! - pixels[corner + 1]!),
        Math.abs(pixels[index + 2]! - pixels[corner + 2]!),
      );
      if (delta > 24) covered += 1;
    }
    return covered / (pixels.length / 4);
  }, image.toString("base64"));
}

test("GPU terrain draws a non-power-of-two Landscape lit and through AO/DOF without shader errors", async ({ page, request }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await writeFixture();
  await page.setViewportSize({ width: 1440, height: 860 });

  const captures = new Map<View, Buffer>();
  for (const view of Object.keys(VIEWS) as View[]) captures.set(view, await capture(page, request, view));
  expect(errors).toEqual([]);
  // Measure away from the editor, whose render loop would compete with it.
  await page.goto("about:blank");
  const report: Record<string, number> = {};
  for (const [view, image] of captures) {
    await writeFile(testInfo.outputPath(`${view}.png`), image);
    await testInfo.attach(`${view}.png`, { body: image, contentType: "image/png" });
    report[view] = await coverage(page, image);
  }
  console.log(`[terrain-render] coverage ${JSON.stringify(report)}`);
  for (const share of Object.values(report)) expect(share).toBeGreaterThan(0.25);
});
