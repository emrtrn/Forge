import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./test";
import { REPO_ROOT } from "./smokeProject.mjs";

/**
 * OPEN_WORLD_PLAN Faz 7a/7b: a level whose `worldSettings.viewDistance` is past
 * the far view threshold renders Play through the composer's float32-depth,
 * MSAA target with reversed-Z (or, on a GPU without EXT_clip_control, a raised
 * near plane), and the gameplay camera's far plane is the view distance. A level
 * without a view distance keeps today's standard path. The levels are served in
 * flight, so no project file is written.
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
}

async function bootLevel(page: import("@playwright/test").Page, viewDistance: number | undefined): Promise<{ probe: FrameProbe; errors: string[]; messages: string[] }> {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });

  const level = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  level.name = "__playwright-far-view";
  if (viewDistance !== undefined) level.worldSettings = { ...level.worldSettings, viewDistance };
  level.lights = level.lights.map((light: { type: string }) => light.type === "directional" ? { ...light, castShadow: true } : light);
  await page.route(`**/${LEVEL}`, (route) => route.fulfill({ json: level }));
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.addInitScript(() => {
    localStorage.clear();
    // A manual "high" profile: headless hardware hints would pick one without shadows.
    localStorage.setItem("forge.userSettings", JSON.stringify({
      schema: 1,
      updatedAt: new Date().toISOString(),
      payload: { graphics: { selectedQualityLevel: "high", manuallySelected: true, adaptiveOptimizationEnabled: false } },
    }));
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __farScenes: any[]; __farRenderer?: any };
    w.__farScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isScene) w.__farScenes.push(object);
      if (object?.isWebGLRenderer) w.__farRenderer = object;
    });
  });

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
      for (const scene of w.__farScenes) scene.traverse((node: any) => {
        if (!sun && node.isDirectionalLight && node.castShadow) sun = node;
      });
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
      });
    };
    requestAnimationFrame(tick);
  }));
  return { probe, errors, messages };
}

test("far view: a long view distance renders Play with reversed-Z into a float-depth target", async ({ page }) => {
  const { probe, errors, messages } = await bootLevel(page, 6000);
  console.log(`[far-view] ${JSON.stringify(probe)}`);
  expect(errors).toEqual([]);
  expect(probe.far).toBe(6000);
  expect(probe.targetDepthType).toBe(FLOAT_TYPE);
  expect(probe.targetSamples).toBe(4);
  expect(probe.sunShadowMap).toBe(true);
  if (probe.clipControl) {
    expect(probe.reversedState).toBe(true);
    expect(probe.cameraReversed).toBe(true);
    // Reversed [0, 1] projection: depth 1 at the near plane, so z' grows toward the camera.
    expect(probe.projection10).toBeGreaterThan(0);
    expect(probe.sunBias).toBeGreaterThan(0);
  } else {
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
});
