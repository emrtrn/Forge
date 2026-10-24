import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { foliageDataPath, normalizeFoliageType } from "../../engine/scene/foliage";
import { expect, test } from "./test";
import { REPO_ROOT } from "./smokeProject.mjs";

/**
 * OPEN_WORLD_PLAN Faz 6 F1: foliage with a `cullStart..cullEnd` window renders
 * through the dither-fade materials in Play. The level, its foliage sidecar, the
 * Foliage Type and its manifest entry are all served in flight, so no project
 * file is written. Checks that the lit and shadow fade programs compile on the
 * GPU (no shader error), and — rendering the runtime's own fade material in a
 * bare scene — that an instance before the window is solid, one halfway through
 * keeps about half its pixels and one past `cullEnd` is gone.
 */

const LEVEL = "layouts/__playwright-foliage-fade.level.json";
const TYPE_ID = "__playwright-fade-foliage";
const TYPE_PATH = `assets/${TYPE_ID}.foliagetype.json`;

test("foliage fade: cull window dithers instances out in Play", async ({ page }) => {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });

  const base = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  base.name = "__playwright-foliage-fade";
  // A shadow-casting sun, so the fade's depth material is compiled and used too.
  base.lights = base.lights.map((light: { type: string }) => light.type === "directional" ? { ...light, castShadow: true } : light);
  await page.route(`**/${LEVEL}`, (route) => route.fulfill({ json: base }));
  await page.route(`**/${foliageDataPath(LEVEL)}`, (route) => route.fulfill({
    json: {
      schema: 1,
      type: "foliage",
      groups: [{
        id: "fade-group",
        foliageTypeId: TYPE_ID,
        target: { kind: "staticMesh", id: "ground" },
        instances: [[0, 0, 3], [2, 0, 4], [-2, 0, 5]].map((position) => ({ position, rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] })),
      }],
      landscapeRules: [],
    },
  }));
  await page.route(`**/${TYPE_PATH}`, (route) => route.fulfill({
    json: normalizeFoliageType({ name: "Fade Foliage", meshAssetId: "shape-cube", cullStart: 40, cullEnd: 60, castShadow: true }),
  }));
  await page.route("**/assets/manifest.json", async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    const cube = manifest.assets.find((asset: { id: string }) => asset.id === "shape-cube");
    manifest.assets.push({ ...cube, id: TYPE_ID, name: "Fade Foliage", assetType: "foliageType", path: TYPE_PATH, placeable: false });
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
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __fadeScenes: any[]; __fadeRenderer?: any };
    w.__fadeScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isScene) w.__fadeScenes.push(object);
      if (object?.isWebGLRenderer) w.__fadeRenderer = object;
    });
  });

  await page.goto(`/?debug&foliageFade=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  const fadeMeshCount = () => page.evaluate(() => {
    const w = window as unknown as { __fadeScenes: any[] };
    let found = 0;
    for (const scene of w.__fadeScenes) scene.traverse((node: any) => {
      if (node.isInstancedMesh && String(node.material?.customProgramCacheKey?.()).includes("forge-foliage-fade")) found += 1;
    });
    return found;
  });
  await expect.poll(fadeMeshCount, { timeout: 30_000 }).toBeGreaterThan(0);

  // Run real frames (colour + shadow passes) and keep a copy of the view camera.
  await page.evaluate(() => new Promise<void>((done) => {
    const w = window as unknown as { __fadeRenderer: any; __fadeCamera?: any };
    const renderer = w.__fadeRenderer;
    const render = renderer.render;
    let frames = 0;
    renderer.render = function (scene: any, camera: any) {
      if (!w.__fadeCamera && camera?.isPerspectiveCamera) w.__fadeCamera = camera.clone();
      return render.call(this, scene, camera);
    };
    const tick = () => {
      if (++frames >= 10 && w.__fadeCamera) {
        renderer.render = render;
        done();
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }));

  const result = await page.evaluate(() => {
    const w = window as unknown as { __fadeScenes: any[]; __fadeRenderer: any; __fadeCamera: any };
    const renderer = w.__fadeRenderer;
    let foliage: any = null;
    for (const scene of w.__fadeScenes) scene.traverse((node: any) => {
      if (!foliage && node.isInstancedMesh && String(node.material?.customProgramCacheKey?.()).includes("forge-foliage-fade")) foliage = node;
    });
    const material = foliage.material;
    const depth = foliage.customDepthMaterial;
    const programs = {
      lit: Boolean(renderer.properties.get(material).currentProgram),
      shadow: Boolean(depth && renderer.properties.get(depth).currentProgram),
    };

    // A bare scene built from the runtime's own classes (the bundle exposes no THREE).
    const testScene = new w.__fadeScenes[0].constructor();
    testScene.background = material.color.clone().setRGB(0, 0, 0);
    const mesh = new foliage.constructor(foliage.geometry, material, 1);
    mesh.frustumCulled = false;
    testScene.add(mesh);
    const camera = w.__fadeCamera;
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0); // looks down -Z
    camera.near = 0.1;
    camera.far = 1000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    // The binding rewrites these every frame; this synchronous render sees ours.
    const uniforms = renderer.properties.get(material).uniforms;
    const origin = uniforms.uFoliageFadeOrigin.value;
    const range = uniforms.uFoliageFadeRange.value;
    const saved = { origin: origin.clone(), range: range.clone(), emissive: material.emissive.clone(), autoClear: renderer.autoClear };
    origin.set(0, 0, 0);
    range.set(40, 60);
    material.emissive.setRGB(1, 1, 1); // independent of the level's lighting

    const gl = renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    const coverage = (distance: number): number => {
      // Scale with distance so every instance covers the same screen area.
      const matrix = foliage.matrix.clone().makeScale(distance * 0.3, distance * 0.3, distance * 0.3);
      matrix.setPosition(0, 0, -distance);
      mesh.setMatrixAt(0, matrix);
      mesh.instanceMatrix.needsUpdate = true;
      renderer.setRenderTarget(null);
      renderer.autoClear = true;
      renderer.render(testScene, camera);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let lit = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index]! + pixels[index + 1]! + pixels[index + 2]! > 60) lit += 1;
      }
      return lit;
    };
    const near = coverage(10);
    const mid = coverage(50);
    const far = coverage(90);

    origin.copy(saved.origin);
    range.copy(saved.range);
    material.emissive.copy(saved.emissive);
    renderer.autoClear = saved.autoClear;
    mesh.dispose();
    return { programs, near, mid, far };
  });
  expect(result.programs).toEqual({ lit: true, shadow: true });
  expect(result.near).toBeGreaterThan(1000);
  expect(result.far).toBe(0);
  // Halfway through the window the 4×4 dither keeps 8 of 16 pixels.
  expect(result.mid / result.near).toBeGreaterThan(0.35);
  expect(result.mid / result.near).toBeLessThan(0.65);
  expect(errors).toEqual([]);
});
