import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { foliageDataPath, normalizeFoliageType } from "../../engine/scene/foliage";
import { expect, test } from "./test";
import { REPO_ROOT } from "./smokeProject.mjs";

/**
 * DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 6: a Foliage Type with `sway` (and a cull
 * window, so the fade and the sway share one program) renders in Play. Checks
 * that the lit and shadow programs compile on the GPU with no shader error,
 * and — rendering the runtime's own material in a bare scene — that wind
 * strength 1 pushes the top of an instance downwind (+X, screen right) while
 * strength 0 leaves it exactly where it was. Everything is served in flight.
 */

const LEVEL = "layouts/__playwright-wind-sway.level.json";
const TYPE_ID = "__playwright-sway-foliage";
const TYPE_PATH = `assets/${TYPE_ID}.foliagetype.json`;

test("wind sway: swaying foliage compiles and leans downwind in Play", async ({ page }) => {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });

  const base = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  base.name = "__playwright-wind-sway";
  // A shadow-casting sun, so the swaying depth material is compiled and used too.
  base.lights = base.lights.map((light: { type: string }) => light.type === "directional" ? { ...light, castShadow: true } : light);
  base.worldSettings = { ...(base.worldSettings ?? {}), wind: { directionDeg: 90, strength: 1, gust: 0 } };
  await page.route(`**/${LEVEL}`, (route) => route.fulfill({ json: base }));
  await page.route(`**/${foliageDataPath(LEVEL)}`, (route) => route.fulfill({
    json: {
      schema: 1,
      type: "foliage",
      groups: [{
        id: "sway-group",
        foliageTypeId: TYPE_ID,
        target: { kind: "staticMesh", id: "ground" },
        instances: [[0, 0, 3], [2, 0, 4], [-2, 0, 5]].map((position) => ({ position, rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] })),
      }],
      landscapeRules: [],
    },
  }));
  await page.route(`**/${TYPE_PATH}`, (route) => route.fulfill({
    json: normalizeFoliageType({
      name: "Sway Foliage", meshAssetId: "shape-cube", cullStart: 40, cullEnd: 60, castShadow: true,
      sway: { amplitude: 0.3, height: 0.5, frequency: 0.8 },
    }),
  }));
  await page.route("**/assets/manifest.json", async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    const cube = manifest.assets.find((asset: { id: string }) => asset.id === "shape-cube");
    manifest.assets.push({ ...cube, id: TYPE_ID, name: "Sway Foliage", assetType: "foliageType", path: TYPE_PATH, placeable: false });
    await route.fulfill({ response, json: manifest });
  });
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  // three's devtools hook hands over the live scenes and renderer without test globals in the app.
  await page.addInitScript(() => {
    localStorage.clear();
    // A manual "high" profile: headless hardware hints would pick one without shadows.
    localStorage.setItem("forge.userSettings", JSON.stringify({
      schema: 1,
      updatedAt: new Date().toISOString(),
      payload: { graphics: { selectedQualityLevel: "high", manuallySelected: true, adaptiveOptimizationEnabled: false } },
    }));
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __swayScenes: any[]; __swayRenderer?: any };
    w.__swayScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isScene) w.__swayScenes.push(object);
      if (object?.isWebGLRenderer) w.__swayRenderer = object;
    });
  });

  await page.goto(`/?debug&windSway=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  const swayMeshCount = () => page.evaluate(() => {
    const w = window as unknown as { __swayScenes: any[] };
    let found = 0;
    for (const scene of w.__swayScenes) scene.traverse((node: any) => {
      if (node.isInstancedMesh && String(node.material?.customProgramCacheKey?.()).includes("forge-wind-sway")) found += 1;
    });
    return found;
  });
  await expect.poll(swayMeshCount, { timeout: 30_000 }).toBeGreaterThan(0);

  // Run real frames (colour + shadow passes) and keep a copy of the view camera.
  await page.evaluate(() => new Promise<void>((done) => {
    const w = window as unknown as { __swayRenderer: any; __swayCamera?: any };
    const renderer = w.__swayRenderer;
    const render = renderer.render;
    let frames = 0;
    renderer.render = function (scene: any, camera: any) {
      if (!w.__swayCamera && camera?.isPerspectiveCamera) w.__swayCamera = camera.clone();
      return render.call(this, scene, camera);
    };
    const tick = () => {
      if (++frames >= 10 && w.__swayCamera) {
        renderer.render = render;
        done();
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }));

  const result = await page.evaluate(() => {
    const w = window as unknown as { __swayScenes: any[]; __swayRenderer: any; __swayCamera: any };
    const renderer = w.__swayRenderer;
    let foliage: any = null;
    for (const scene of w.__swayScenes) scene.traverse((node: any) => {
      if (!foliage && node.isInstancedMesh && String(node.material?.customProgramCacheKey?.()).includes("forge-wind-sway")) foliage = node;
    });
    const material = foliage.material;
    const depth = foliage.customDepthMaterial;
    const programs = {
      lit: Boolean(renderer.properties.get(material).currentProgram),
      shadow: Boolean(depth && renderer.properties.get(depth).currentProgram),
    };
    const uniforms = renderer.properties.get(material).uniforms;
    const live = { strength: uniforms.uWindStrength.value, direction: uniforms.uWindDirection.value.toArray() };

    // A bare scene built from the runtime's own classes (the bundle exposes no THREE).
    const testScene = new w.__swayScenes[0].constructor();
    testScene.background = material.color.clone().setRGB(0, 0, 0);
    const mesh = new foliage.constructor(foliage.geometry, material, 1);
    mesh.frustumCulled = false;
    testScene.add(mesh);
    const camera = w.__swayCamera;
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0); // looks down -Z, +X is screen right
    camera.near = 0.1;
    camera.far = 1000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    // Size the instance from the geometry itself (the asset's units are not metres):
    // a 3 m tall box 10 m in front of the camera.
    foliage.geometry.computeBoundingBox();
    const box = foliage.geometry.boundingBox;
    const geometryHeight = box.max.y - box.min.y;
    const scale = 3 / geometryHeight;
    const matrix = foliage.matrix.clone().makeScale(scale, scale, scale);
    matrix.setPosition(0, 0, -10);
    mesh.setMatrixAt(0, matrix);
    mesh.instanceMatrix.needsUpdate = true;

    // The shell rewrites these every frame; this synchronous render sees ours.
    const keys = ["uWindStrength", "uWindGust", "uWindTime", "uSwayAmplitude", "uSwayHeight", "uWindViewOrigin", "uFoliageFadeOrigin"];
    const saved = Object.fromEntries(keys.map((key) => [key, uniforms[key].value?.clone ? uniforms[key].value.clone() : uniforms[key].value]));
    const savedEmissive = material.emissive.clone();
    const savedAutoClear = renderer.autoClear;
    uniforms.uWindDirection.value.set(1, 0);
    uniforms.uWindGust.value = 0;
    uniforms.uWindTime.value = 0;
    uniforms.uSwayAmplitude.value = 1;
    // This bare mesh has an identity model matrix, so metres "at instance scale 1"
    // are geometry units here: the top face gets the full mask, the base none.
    uniforms.uSwayHeight.value = Math.max(box.max.y, 1e-3);
    uniforms.uWindViewOrigin.value.set(0, 0, 0);
    uniforms.uFoliageFadeOrigin.value.set(0, 0, 0); // 10 m: well before the fade window
    material.emissive.setRGB(1, 1, 1); // independent of the level's lighting

    const gl = renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    const frame = (strength: number) => {
      uniforms.uWindStrength.value = strength;
      renderer.setRenderTarget(null);
      renderer.autoClear = true;
      renderer.render(testScene, camera);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      // Columns covered in the top and bottom rows of the silhouette.
      let lit = 0;
      let sumX = 0;
      let minY = height;
      let maxY = -1;
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        if (pixels[index]! + pixels[index + 1]! + pixels[index + 2]! <= 60) continue;
        lit += 1;
        sumX += x;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const rowCentre = (row: number): number => {
        let count = 0;
        let sum = 0;
        for (let x = 0; x < width; x += 1) {
          const index = (row * width + x) * 4;
          if (pixels[index]! + pixels[index + 1]! + pixels[index + 2]! > 60) { count += 1; sum += x; }
        }
        return count > 0 ? sum / count : Number.NaN;
      };
      // readPixels rows go bottom-up: maxY is the top of the silhouette.
      return { lit, centreX: lit > 0 ? sumX / lit : Number.NaN, top: rowCentre(maxY - 2), bottom: rowCentre(minY + 2), width };
    };
    const calm = frame(0);
    const calmAgain = frame(0);
    const windy = frame(1);

    for (const key of keys) {
      const value = saved[key];
      if (value?.copy) uniforms[key].value.copy(value); else uniforms[key].value = value;
    }
    material.emissive.copy(savedEmissive);
    renderer.autoClear = savedAutoClear;
    mesh.dispose();
    return { programs, live, calm, calmAgain, windy };
  });
  expect(result.programs).toEqual({ lit: true, shadow: true });
  // worldSettings.wind reached the shader: 90° blows towards +X.
  expect(result.live.strength).toBeCloseTo(1, 5);
  expect(result.live.direction[0]).toBeCloseTo(1, 5);
  expect(result.calm.lit).toBeGreaterThan(1000);
  expect(result.calmAgain).toEqual(result.calm);
  // The top leans right (downwind); the planted base barely moves.
  expect(result.windy.top - result.calm.top).toBeGreaterThan(result.calm.width * 0.01);
  expect(Math.abs(result.windy.bottom - result.calm.bottom)).toBeLessThan(result.windy.top - result.calm.top);
  expect(result.windy.centreX).toBeGreaterThan(result.calm.centreX);
  expect(errors).toEqual([]);
});
