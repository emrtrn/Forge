import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { resolve } from "node:path";
import { expect, test } from "./test";
import { REPO_ROOT } from "./smokeProject.mjs";

/**
 * OPEN_WORLD_PLAN Faz 7a/7b: a level whose `worldSettings.viewDistance` is past
 * the far view threshold renders Play through the composer's float32-depth,
 * MSAA target with reversed-Z (or, on a GPU without EXT_clip_control, a raised
 * near plane), and the gameplay camera's far plane is the view distance. A level
 * without a view distance keeps today's standard path. Faz 7c1/7c2: far view
 * mode casts the sun's shadow through camera-fitted cascades (or, without
 * reversed-Z, the sun's own follow frustum). The levels are served in flight, so
 * no project file is written.
 */

const LEVEL = "layouts/__playwright-far-view.level.json";
const FLOAT_TYPE = 1015; // three FloatType

interface FrameProbe {
  reversedState: boolean;
  clipControl: boolean;
  far: number;
  near: number;
  cameraReversed: boolean;
  projection10: number;
  targetDepthType: number | null;
  targetSamples: number | null;
  sunBias: number | null;
  sunShadowMap: boolean;
  shadowLeft: number | null;
  shadowFar: number | null;
  /** Horizontal distance from the camera to the sun's target (the follow shadow's centre). */
  sunTargetLead: number | null;
  /** The sun's layer mask: 0 while Faz 7c2 cascades stand in for it. */
  sunLayers: number | null;
  /** Faz 7c2 cascade lights, nearest first. */
  cascades: { intensity: number; halfExtent: number; far: number; bias: number; map: boolean; lead: number }[];
  /** Compiled programs carrying the cascade patch. */
  cascadePrograms: number;
}

interface BootOptions {
  /** Manual quality profile (headless hardware hints would pick one without shadows). */
  quality?: "high" | "ultra";
  /** Start from a high pose looking ~200 m down the row of cubes (the Play camera handoff). */
  pose?: boolean;
}

async function bootLevel(
  page: import("@playwright/test").Page,
  viewDistance: number | undefined,
  options: BootOptions = {},
): Promise<{ probe: FrameProbe; errors: string[]; messages: string[] }> {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });

  const level = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  level.name = "__playwright-far-view";
  level.worldSettings = { ...level.worldSettings, staticObjectsCastShadow: true };
  if (viewDistance !== undefined) level.worldSettings = { ...level.worldSettings, viewDistance };
  // A 400 m floor and a narrow row of cubes running 200 m away from the posed
  // camera, so lit materials compile and the sun's shadow falls near and far; the
  // floor beside the row has no caster over it.
  level.instances = [
    { assetId: "floor-400x400", placements: [{ name: "floor", position: [-200, 0, -300], rotationYDeg: 0, scale: 100, scaleLocked: true }] },
    { assetId: "shape-cube", placements: Array.from({ length: 20 }, (_, index) => ({
      name: `cube-${index}`,
      position: [(index % 3 - 1) * 6, 0, 40 - index * 10],
      rotationYDeg: index * 17,
      scale: 2 + (index % 3) * 2,
      scaleLocked: true,
    })) },
  ];
  level.lights = level.lights.map((light: { type: string }) => light.type === "directional" ? { ...light, castShadow: true } : light);
  await page.route(`**/${LEVEL}`, (route) => route.fulfill({ json: level }));
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.addInitScript(({ quality, pose }) => {
    localStorage.clear();
    localStorage.setItem("forge.userSettings", JSON.stringify({
      schema: 1,
      updatedAt: new Date().toISOString(),
      payload: { graphics: { selectedQualityLevel: quality, manuallySelected: true, adaptiveOptimizationEnabled: false } },
    }));
    // 25 m up, 7.5° down the row (three cameras look down −Z).
    if (pose) localStorage.setItem("forge.play.cameraPose", JSON.stringify({ position: [0, 25, 70], quaternion: [-0.0654031, 0, 0, 0.9978589] }));
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __farScenes: any[]; __farRenderer?: any };
    w.__farScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isScene) w.__farScenes.push(object);
      if (object?.isWebGLRenderer) w.__farRenderer = object;
    });
  }, { quality: options.quality ?? "high", pose: options.pose ?? false });

  await page.goto(`/?farView=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  // Run real frames and record the gameplay camera + the target the scene renders into.
  const probe = await page.evaluate(() => new Promise<FrameProbe>((done) => {
    const w = window as unknown as { __farScenes: any[]; __farRenderer: any };
    const renderer = w.__farRenderer;
    const render = renderer.render;
    let camera: any = null;
    let target: any = null;
    let frames = 0;
    renderer.render = function (scene: any, view: any) {
      if (view?.isPerspectiveCamera && scene?.isScene && !scene.overrideMaterial) {
        camera = view;
        target = renderer.getRenderTarget();
      }
      return render.call(this, scene, view);
    };
    const tick = () => {
      if (++frames < 20 || !camera) {
        requestAnimationFrame(tick);
        return;
      }
      renderer.render = render;
      let sun: any = null;
      const cascadeLights: any[] = [];
      for (const scene of w.__farScenes) scene.traverse((node: any) => {
        if (!node.isDirectionalLight) return;
        if (String(node.name).startsWith("forge-sun-cascade-")) cascadeLights.push(node);
        else if (!sun && node.castShadow) sun = node;
      });
      const horizontalLead = (light: any) => Math.hypot(
        light.target.matrixWorld.elements[12] - camera.matrixWorld.elements[12],
        light.target.matrixWorld.elements[14] - camera.matrixWorld.elements[14],
      );
      const targetWorld = sun ? sun.target.matrixWorld.elements : null;
      const lead = targetWorld
        ? Math.hypot(targetWorld[12] - camera.matrixWorld.elements[12], targetWorld[14] - camera.matrixWorld.elements[14])
        : null;
      done({
        reversedState: renderer.state.buffers.depth.getReversed(),
        clipControl: renderer.extensions.has("EXT_clip_control"),
        far: camera.far,
        near: camera.near,
        cameraReversed: camera.reversedDepth === true,
        projection10: camera.projectionMatrix.elements[10],
        targetDepthType: target?.depthTexture?.type ?? null,
        targetSamples: target ? target.samples : null,
        sunBias: sun ? sun.shadow.bias : null,
        sunShadowMap: Boolean(sun?.shadow.map),
        shadowLeft: sun ? sun.shadow.camera.left : null,
        shadowFar: sun ? sun.shadow.camera.far : null,
        sunTargetLead: lead,
        sunLayers: sun ? sun.layers.mask : null,
        cascades: cascadeLights.map((light) => ({
          intensity: light.intensity,
          halfExtent: light.shadow.camera.right,
          far: light.shadow.camera.far,
          bias: light.shadow.bias,
          map: Boolean(light.shadow.map),
          lead: horizontalLead(light),
        })),
        cascadePrograms: (renderer.info.programs ?? []).filter((program: any) => String(program.cacheKey).includes("forge-sun-cascades")).length,
      });
    };
    requestAnimationFrame(tick);
  }));
  return { probe, errors, messages };
}

test("far view: a long view distance renders Play with reversed-Z into a float-depth target", async ({ page }) => {
  const { probe, errors, messages } = await bootLevel(page, 6000);
  console.log(`[far-view] ${JSON.stringify(probe)}`);
  // For a manual look at the cascaded shadows; not a visual baseline.
  await page.screenshot({ path: "test-results/far-view-cascades.png" });
  expect(errors).toEqual([]);
  expect(probe.far).toBe(6000);
  expect(probe.targetDepthType).toBe(FLOAT_TYPE);
  expect(probe.targetSamples).toBe(4);
  if (probe.clipControl) {
    expect(probe.reversedState).toBe(true);
    expect(probe.cameraReversed).toBe(true);
    // Reversed [0, 1] projection: depth 1 at the near plane, so z' grows toward the camera.
    expect(probe.projection10).toBeGreaterThan(0);
    // Faz 7c2: the "high" profile's 3 cascades out to 200 m × 0.75 stand in for the
    // sun, which leaves the render (and frees its map) until far view mode ends.
    expect(probe.sunLayers).toBe(0);
    expect(probe.sunShadowMap).toBe(false);
    expect(probe.cascades).toHaveLength(3);
    expect(probe.cascades[0]!.intensity).toBeGreaterThan(0);
    expect(probe.cascades.slice(1).every((cascade) => cascade.intensity === 0)).toBe(true);
    expect(probe.cascades.every((cascade) => cascade.map)).toBe(true);
    const extents = probe.cascades.map((cascade) => cascade.halfExtent);
    expect(extents[0]!).toBeLessThan(extents[1]!);
    expect(extents[1]!).toBeLessThan(extents[2]!);
    // The last cascade's slice sphere reaches the 150 m split (60° fov, so ≥ 150 m wide).
    expect(extents[2]!).toBeGreaterThan(75);
    for (const cascade of probe.cascades) {
      // 2 cm of world depth per cascade, positive under reversed-Z; sphere + 100 m margin deep.
      expect(cascade.bias).toBeCloseTo(0.02 / cascade.far, 8);
      expect(cascade.far).toBeCloseTo(2 * cascade.halfExtent + 100, 5);
      // Centred ahead of the camera, never past its own reach.
      expect(cascade.lead).toBeLessThanOrEqual(cascade.halfExtent + 1);
    }
    expect(probe.cascadePrograms).toBeGreaterThan(0);
  } else {
    // Without reversed-Z the sun keeps the Faz 7c1 follow shadow: 60 m × the "high"
    // profile's 0.75 shadow distance scale, ±150 m along the light, centred half an
    // extent ahead of the camera.
    expect(probe.cascades).toHaveLength(0);
    expect(probe.sunShadowMap).toBe(true);
    expect(probe.shadowLeft).toBeCloseTo(-45, 5);
    expect(probe.shadowFar).toBe(300);
    expect(probe.sunTargetLead).toBeGreaterThan(21);
    expect(probe.sunTargetLead).toBeLessThan(24);
    expect(probe.sunBias).toBeCloseTo(-0.02 / 300, 8);
    expect(probe.reversedState).toBe(false);
    expect(probe.near).toBeGreaterThanOrEqual(0.5);
    expect(messages.some((message) => message.includes("EXT_clip_control is unavailable"))).toBe(true);
  }
});

test("far view: a level without a view distance keeps the standard depth path", async ({ page }) => {
  const { probe, errors } = await bootLevel(page, undefined);
  expect(errors).toEqual([]);
  expect(probe.reversedState).toBe(false);
  expect(probe.cameraReversed).toBe(false);
  expect(probe.projection10).toBeLessThan(0);
  expect(probe.far).toBeLessThan(6000);
  expect(probe.targetDepthType).not.toBe(FLOAT_TYPE);
  expect(probe.sunBias).toBeLessThan(0);
  expect(probe.sunLayers).toBe(1);
  expect(probe.cascades).toHaveLength(0);
  expect(probe.cascadePrograms).toBe(0);
});

/** Fraction of a screenshot rectangle's pixels darker than `threshold` luminance (0–255). */
async function darkFraction(png: Buffer, rect: { x: number; y: number; width: number; height: number }, threshold = 120): Promise<number> {
  const { data, info } = await sharp(png).extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    if (0.2126 * data[index]! + 0.7152 * data[index + 1]! + 0.0722 * data[index + 2]! < threshold) dark += 1;
  }
  return dark / (data.length / info.channels);
}

test("far view: Ultra's four staggered cascades shadow the row out to 200 m and leave open ground lit", async ({ page }) => {
  const { probe, errors } = await bootLevel(page, 6000, { quality: "ultra", pose: true });
  expect(errors).toEqual([]);
  test.skip(!probe.clipControl, "cascades need reversed-Z (EXT_clip_control)");
  expect(probe.cascades).toHaveLength(4);
  const extents = probe.cascades.map((cascade) => cascade.halfExtent);
  for (let index = 1; index < extents.length; index += 1) expect(extents[index]!).toBeGreaterThan(extents[index - 1]!);
  // The last slice sphere reaches the 200 m split.
  expect(extents[3]!).toBeGreaterThan(100);

  const png = await page.screenshot({ path: "test-results/far-view-ultra-cascades.png" });
  const { width, height } = page.viewportSize()!;
  // Floor beside the row of cubes, near (bottom corners) and farther out (sides):
  // no caster is above it, so it must be lit. A cascade box is square in light space
  // but only a slice sphere deep; a fragment past its far plane reads "shadowed"
  // under reversed-Z unless the pick falls through to the next cascade.
  const side = 120;
  for (const rect of [
    { x: 0, y: height - side, width: side, height: side },
    { x: width - side, y: height - side, width: side, height: side },
    { x: 0, y: Math.round(height * 0.55), width: side, height: 60 },
    { x: width - side, y: Math.round(height * 0.55), width: side, height: 60 },
  ]) {
    expect(await darkFraction(png, rect), `open floor at ${JSON.stringify(rect)}`).toBeLessThan(0.01);
  }
});
