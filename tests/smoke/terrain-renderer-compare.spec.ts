import { readFile, writeFile } from "node:fs/promises";
import { PerspectiveCamera } from "three";
import type { APIRequestContext } from "@playwright/test";
import { expect, test, type Page } from "./test";
import { SMOKE_SPLINE_SCENE, smokePublicPath } from "./smokeProject.mjs";

/**
 * OPEN_WORLD_PLAN Faz 2 acceptance: a legacy 1×1 Landscape looks the same drawn
 * by the GPU CDLOD renderer as by the chunk mesh (`?terrainRenderer=legacy`).
 *
 * Each view is captured three times — legacy, legacy again, CDLOD — so the
 * legacy/legacy difference measures what the scene itself changes between
 * loads (clouds, wind, async textures) and the renderer is judged against that
 * noise floor rather than against an absolute number. Screenshots and diff
 * images are attached for a human look.
 */

const LEVEL = "layouts/__playwright-terrain-compare.level.json";
const POST_LEVEL = "layouts/__playwright-terrain-compare-post.level.json";
const SIDECAR = "landscapes/terrain-compare.landscape.json";

/**
 * A hilly 257² Landscape with slope/height-painted layers and a textured base
 * layer, in the smoke level's lighting and no sky (the sky dome renders black in
 * headless Chromium, which would hide the terrain behind a constant). A second
 * level adds AO + DOF.
 */
async function writeFixture(): Promise<void> {
  const size = 257;
  const heights: number[] = [];
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      heights.push(14 * Math.sin(x * 0.045) * Math.cos(z * 0.031) + 5 * Math.sin((x + z) * 0.11) + 0.002 * (x - 128) ** 2);
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
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const at = (cx: number, cz: number) => heights[Math.min(size - 1, Math.max(0, cz)) * size + Math.min(size - 1, Math.max(0, cx))]!;
      const slope = Math.hypot(at(x + 1, z) - at(x - 1, z), at(x, z + 1) - at(x, z - 1)) / 2;
      const raw = layers.map((entry) => Math.max(0, entry.weight(heights[z * size + x]!, slope)));
      const total = raw.reduce((sum, value) => sum + value, 0) || 1;
      raw.forEach((value, index) => layers[index]!.weights.push(value / total));
    }
  }
  const data = {
    schema: 1, type: "landscape",
    size: { verticesX: size, verticesZ: size, spacing: 1, heightScale: 1 },
    chunks: { quadsPerChunk: 32 },
    heights,
    layers: layers.map(({ weight: _weight, ...entry }) => entry),
    splines: [],
  };
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  level.name = "__playwright-terrain-compare";
  level.instances = [];
  level.landscapes = [{ id: "compare", name: "Landscape", position: [0, 0, 0], dataRef: SIDECAR }];
  await writeFile(smokePublicPath(SIDECAR), JSON.stringify(data));
  await writeFile(smokePublicPath(LEVEL), JSON.stringify(level));
  // AO and DOF render the scene with an override material; the terrain must
  // take part in both (postProcess.ts) or it loses AO / blurs like background.
  level.postProcess = {
    ...level.postProcess,
    ao: { enabled: true, radius: 1, intensity: 1 },
    dof: { enabled: true, focusDistance: 120, aperture: 0.3, maxBlur: 0.5 },
  };
  await writeFile(smokePublicPath(POST_LEVEL), JSON.stringify(level));
}

/** Channel standard deviation; a blank or single-colour capture proves nothing. */
async function contrast(page: Page, image: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let sum = 0;
    let squares = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const value = (pixels[index]! + pixels[index + 1]! + pixels[index + 2]!) / 3;
      sum += value;
      squares += value * value;
    }
    const count = pixels.length / 4;
    return Math.sqrt(Math.max(0, squares / count - (sum / count) ** 2));
  }, image.toString("base64"));
}

interface Diff {
  /** Mean absolute channel difference, 0..255. */
  mean: number;
  /** Share of pixels with a channel off by more than 24. */
  changed: number;
  png: string;
}

/** Editor camera poses (world space; the fixture is centred on the origin). */
const VIEWS = {
  overview: { level: LEVEL, position: [-170, 110, 170], target: [0, 0, 0] },
  grazing: { level: LEVEL, position: [-110, 14, -70], target: [60, 0, 40] },
  closeup: { level: LEVEL, position: [8, 28, 8], target: [34, 4, 30] },
  "ao-dof": { level: POST_LEVEL, position: [-170, 110, 170], target: [0, 0, 0] },
} as const;

type View = keyof typeof VIEWS;

function cameraPose(view: View) {
  const camera = new PerspectiveCamera();
  const { position, target } = VIEWS[view];
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(target[0], target[1], target[2]);
  return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] };
}

async function capture(page: Page, request: APIRequestContext, renderer: "legacy" | "cdlod", view: View): Promise<Buffer> {
  const { level } = VIEWS[view];
  expect((await request.post("/__open-level", { data: { path: level } })).ok()).toBeTruthy();
  // The editor restores this per-level pose on boot (editor/input/editorCameraPose.ts).
  await page.addInitScript(({ key, pose }) => {
    localStorage.clear();
    localStorage.setItem(key, pose);
  }, { key: `forge.editor.cameraPose.${encodeURIComponent(level)}`, pose: JSON.stringify(cameraPose(view)) });
  const query = renderer === "legacy" ? "&terrainRenderer=legacy" : "";
  await page.goto(`/?editor${query}&terrainCompare=${renderer}-${Date.now()}`);
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

async function diff(page: Page, a: Buffer, b: Buffer): Promise<Diff> {
  return page.evaluate(async ([left, right]) => {
    const load = async (base64: string) => createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const [imageA, imageB] = await Promise.all([load(left), load(right)]);
    const width = Math.min(imageA.width, imageB.width);
    const height = Math.min(imageA.height, imageB.height);
    const read = (image: ImageBitmap) => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, width, height);
    };
    const pixelsA = read(imageA).data;
    const pixelsB = read(imageB).data;
    const out = new ImageData(width, height);
    let total = 0;
    let changed = 0;
    for (let index = 0; index < pixelsA.length; index += 4) {
      let worst = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = Math.abs(pixelsA[index + channel]! - pixelsB[index + channel]!);
        total += delta;
        worst = Math.max(worst, delta);
      }
      if (worst > 24) changed += 1;
      const shade = Math.min(255, worst * 4);
      out.data.set([shade, shade, shade, 255], index);
    }
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.putImageData(out, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { mean: total / (width * height * 3), changed: changed / (width * height), png: btoa(binary) };
  }, [a.toString("base64"), b.toString("base64")] as const);
}

test("CDLOD terrain matches the legacy chunk mesh within the scene's own load-to-load noise", async ({ page, request }, testInfo) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await writeFixture();
  await page.setViewportSize({ width: 1440, height: 860 });

  const captures = new Map<View, { legacy: Buffer; legacyAgain: Buffer; cdlod: Buffer }>();
  for (const view of Object.keys(VIEWS) as View[]) {
    captures.set(view, {
      legacy: await capture(page, request, "legacy", view),
      legacyAgain: await capture(page, request, "legacy", view),
      cdlod: await capture(page, request, "cdlod", view),
    });
  }
  expect(errors).toEqual([]);
  // Compare away from the editor, whose render loop would compete with the diff.
  await page.goto("about:blank");
  const report: Record<string, { noise: Omit<Diff, "png">; cdlod: Omit<Diff, "png"> }> = {};
  for (const [view, { legacy, legacyAgain, cdlod }] of captures) {
    const noise = await diff(page, legacy, legacyAgain);
    const change = await diff(page, legacy, cdlod);
    for (const [name, body] of [
      [`${view}-legacy.png`, legacy],
      [`${view}-cdlod.png`, cdlod],
      [`${view}-diff.png`, Buffer.from(change.png, "base64")],
      [`${view}-noise.png`, Buffer.from(noise.png, "base64")],
    ] as const) {
      await writeFile(testInfo.outputPath(name), body);
      await testInfo.attach(name, { body, contentType: "image/png" });
    }
    // A blank capture (single colour) would make every diff zero.
    expect(await contrast(page, legacy)).toBeGreaterThan(1);
    expect(await contrast(page, cdlod)).toBeGreaterThan(1);
    report[view] = {
      noise: { mean: noise.mean, changed: noise.changed },
      cdlod: { mean: change.mean, changed: change.changed },
    };
  }
  await writeFile(testInfo.outputPath("report.json"), JSON.stringify(report, null, 2));
  console.log(`[terrain-compare] ${JSON.stringify(report)}`);
  // Documented tolerance: the renderer may add at most 2 levels of mean channel
  // difference and 2 % changed pixels over the scene's own noise floor.
  for (const { noise, cdlod } of Object.values(report)) {
    expect(cdlod.mean).toBeLessThan(noise.mean + 2);
    expect(cdlod.changed).toBeLessThan(noise.changed + 0.02);
  }
});
