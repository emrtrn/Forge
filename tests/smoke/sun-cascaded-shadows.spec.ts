import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./test";
import { REPO_ROOT } from "./smokeProject.mjs";

/**
 * OPEN_WORLD_PLAN Faz 7c2: Cascaded Shadows is a switch on the sun (Unreal's
 * directional light CSM), not a side effect of the view distance. Ticking it in
 * the Details panel previews the cascades in the perspective viewport, and Save
 * keeps the flag. The level is served in flight; the save request is
 * checked, so no project file is relied on.
 */

const LEVEL = "layouts/__playwright-sun-cascades.level.json";

test("Cascaded Shadows: the sun's Details toggle previews cascades in the viewport and survives Save", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Shader compile/link failures (the cascade patch) are console errors from three;
  // resource errors are not collected: the level is served in flight, so Save's
  // world-cell step answers 400 for a level the server did not open.
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("THREE.")) errors.push(message.text());
  });
  const level = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  level.name = "__playwright-sun-cascades";
  level.lights = level.lights.map((light: { type: string }) => light.type === "directional"
    ? { ...light, name: "Sun", castShadow: true }
    : light);
  await page.route(`**/${LEVEL}`, (route) => route.fulfill({ json: level }));
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.addInitScript(() => {
    localStorage.clear();
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __cascadeScenes: any[] };
    w.__cascadeScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isScene) w.__cascadeScenes.push(object);
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  const cascadeLights = () => page.evaluate(() => {
    const w = window as unknown as { __cascadeScenes: any[] };
    let count = 0;
    let sunLayers: number | null = null;
    for (const scene of w.__cascadeScenes) scene.traverse((node: any) => {
      if (!node.isDirectionalLight) return;
      if (String(node.name).startsWith("forge-sun-cascade-")) count += 1;
      else if (sunLayers === null) sunLayers = node.layers.mask;
    });
    return { count, sunLayers };
  });
  await expect.poll(cascadeLights, { timeout: 30_000 }).toEqual({ count: 0, sunLayers: 1 });

  await page.getByTestId("outliner-row").filter({ hasText: "Sun" }).first().click();
  const details = page.locator('[data-inspector-pane="details"]');
  const toggle = details.locator("[data-light-cascades]");
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();

  const save = page.waitForRequest((request) => request.url().includes("/__save-layout")
    && JSON.parse(request.postData() ?? "{}").layout?.lights?.some(
      (light: { type: string; cascadedShadows?: boolean }) => light.type === "directional" && light.cascadedShadows === true,
    ), { timeout: 30_000 });
  await toggle.check();
  // Light edits are not autosaved; Save writes the level.
  await page.getByTestId("editor-save").click();
  const request = await save;
  const body = await (await request.response())?.json();
  expect(body?.dropped ?? []).toEqual([]);

  // The editor previews the graphics quality's cascades (Ultra's four until a
  // Quality is picked); the sun leaves the render.
  await expect.poll(cascadeLights, { timeout: 10_000 }).toEqual({ count: 4, sunLayers: 0 });

  // Turning Cast Shadow off disables the toggle and hands the sun back.
  await details.locator('[data-light-toggle="castShadow"]').uncheck();
  await expect(details.locator("[data-light-cascades]")).toBeDisabled();
  await expect.poll(cascadeLights, { timeout: 10_000 }).toEqual({ count: 0, sunLayers: 1 });
  expect(errors).toEqual([]);
});

test("Cascaded Shadows: on a 16-texture-unit GPU a textured 5-layer terrain level keeps all four Ultra cascades and its terrain program fits", async ({ page }) => {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error" && message.text().includes("THREE.")) errors.push(message.text());
  });
  const level = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  level.name = "__playwright-sun-cascades";
  level.lights = level.lights.map((light: { type: string }) => light.type === "directional"
    ? { ...light, name: "Sun", castShadow: true, cascadedShadows: true }
    : light);
  // The starter LandscapeTest terrain (5 paint layers) plus a Sky Light capture: the
  // environment map and its BRDF table are two more units on the lit terrain.
  level.landscapes = [{ id: "landscape-1", name: "Landscape", position: [0, 0, 0], dataRef: "assets/starter-content/Levels/LandscapeTest.landscapes/landscape-1.terrain.json" }];
  level.skyAtmosphere = { skyLightCapture: { intensity: 1 } };
  await page.route(`**/${LEVEL}`, (route) => route.fulfill({ json: level }));
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("forge.userSettings", JSON.stringify({
      schema: 1,
      updatedAt: new Date().toISOString(),
      payload: { graphics: { selectedQualityLevel: "ultra", manuallySelected: true, adaptiveOptimizationEnabled: false } },
    }));
    // ANGLE on D3D11 offers 16 fragment texture units; the headless GPU offers 32.
    const getParameter = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (name: number) {
      if (name === 0x8872 /* MAX_TEXTURE_IMAGE_UNITS */) return 16;
      return getParameter.call(this, name);
    };
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __cascadeScenes: any[]; __cascadeRenderer?: any };
    w.__cascadeScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isScene) w.__cascadeScenes.push(object);
      if (object?.isWebGLRenderer) w.__cascadeRenderer = object;
    });
  });
  await page.goto(`/?cascadeBudget=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 90_000 }).toBeTruthy();

  const probe = () => page.evaluate(() => {
    const w = window as unknown as { __cascadeScenes: any[]; __cascadeRenderer: any };
    let cascades = 0;
    for (const scene of w.__cascadeScenes) scene.traverse((node: any) => {
      if (node.isDirectionalLight && String(node.name).startsWith("forge-sun-cascade-")) cascades += 1;
    });
    // Texture units the lit terrain program actually binds: its active sampler uniforms.
    const renderer = w.__cascadeRenderer;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const samplerTypes = new Set<number>([gl.SAMPLER_2D, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_CUBE, gl.SAMPLER_3D]);
    let terrainSamplers = -1;
    let samplerNames: string[] = [];
    for (const program of renderer.info.programs ?? []) {
      const key = String(program.cacheKey);
      // three's program key ends with the material's own key.
      if (!/forge-terrain-cdlod-l\d/.test(key)) continue;
      const handle = program.program;
      let count = 0;
      const names: string[] = [];
      const active = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS) as number;
      for (let index = 0; index < active; index += 1) {
        const info = gl.getActiveUniform(handle, index);
        if (info && samplerTypes.has(info.type)) {
          count += info.size;
          names.push(info.name);
        }
      }
      if (count > terrainSamplers) samplerNames = names.sort();
      terrainSamplers = Math.max(terrainSamplers, count);
    }
    return { cascades, terrainSamplers, samplerNames, maxTextures: renderer.capabilities.maxTextures };
  });
  await expect.poll(async () => (await probe()).cascades, { timeout: 60_000 }).toBe(4);
  await expect.poll(async () => (await probe()).terrainSamplers, { timeout: 60_000 }).toBeGreaterThan(0);
  const result = await probe();
  console.log(`[cascade-budget] ${JSON.stringify(result)}`);
  expect(result.maxTextures).toBe(16);
  // 6 fixed (normals and weights ×2, track field, water array) + the paint layer
  // array + environment map + BRDF table + 4 cascades = 13 in the fragment
  // stage: the five layer textures take one unit, not five. The program's
  // active samplers are counted over both stages, and the tile and global
  // height lookups are vertex-only.
  expect(result.terrainSamplers - 2).toBe(13);
  expect(result.samplerNames).toContain("uLayerTexArray");
  expect(result.samplerNames.filter((name) => /^uLayerTex\d/.test(name))).toEqual([]);
  expect(messages.some((message) => message.includes("[shadows] Cascaded Shadows"))).toBe(false);

  expect(errors).toEqual([]);
});
