import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test } from "./test";
import { smokePublicPath } from "./smokeProject.mjs";

/**
 * DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 6b: the whole authoring chain of a static
 * mesh material's Wind Sway, through the real `/__save-material` of the isolated
 * smoke project. A still material is opened in the Material Editor, Wind Sway is
 * turned on and saved; the viewport picks it up, and Play, which reads the file,
 * draws both static paths with it: the slot-resolved InstancedMesh and a
 * placement clone (a placement-level material override). The lit and shadow programs compile, wind
 * strength 0 changes nothing, strength 1 pushes the top downwind.
 */

const LEVEL = "layouts/__playwright-material-sway.level.json";
const MATERIAL_ID = "__playwright-sway-material";
const FOLDER = "assets/__playwright-sway";
const MATERIAL_PATH = `${FOLDER}/Sway.material.json`;
const CUBE_SLOTS = "assets/starter-content/StaticMeshes/Shapes/Shape_Cube.materials.json";

const writeJson = async (path: string, value: unknown) => {
  await mkdir(dirname(smokePublicPath(path)), { recursive: true });
  await writeFile(smokePublicPath(path), `${JSON.stringify(value, null, 2)}\n`);
};

/** Swaying meshes of the live scenes, split by draw path. */
function swayMeshCounts(): { instanced: number; clones: number; shadowed: number } {
  const w = window as unknown as { __swayScenes: any[] };
  const counts = { instanced: 0, clones: 0, shadowed: 0 };
  for (const scene of w.__swayScenes) scene.traverse((node: any) => {
    if (!node.isMesh || !String(node.material?.customProgramCacheKey?.()).includes("forge-wind-sway")) return;
    if (node.isInstancedMesh) counts.instanced += 1;
    else counts.clones += 1;
    if (node.customDepthMaterial) counts.shadowed += 1;
  });
  return counts;
}

test("material wind sway: edit, save and Play a swaying static mesh", async ({ page }) => {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });

  await writeJson(MATERIAL_PATH, { schema: 1, type: "material", materialType: "standard", name: "Sway", baseColor: "#40a040" });
  const manifestPath = smokePublicPath("assets/manifest.json");
  const originalManifest = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(originalManifest.replace(/^﻿/, ""));
  const cube = manifest.assets.find((asset: { id: string }) => asset.id === "shape-cube");
  manifest.assets.push({ ...cube, id: MATERIAL_ID, name: "Sway", assetType: "material", path: MATERIAL_PATH, placeable: false });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeJson(LEVEL, {
    schema: 1,
    name: "__playwright-material-sway",
    loadGroups: [],
    characters: [],
    actors: [],
    instances: [{
      assetId: "shape-cube",
      placements: [{ position: [0, 0, 3] }, { position: [3, 0, 3], materialSlot: MATERIAL_ID }],
    }],
    // A shadow-casting sun, so the swaying depth material is compiled and used too.
    lights: [{ id: "sun", type: "directional", position: [4, 8, 4], rotation: [-45, 30, 0], color: "#ffffff", intensity: 3, castShadow: true }],
    worldSettings: { backgroundColor: "#c9d8e8", killZ: -10, staticObjectsCastShadow: true, wind: { directionDeg: 90, strength: 1, gust: 0 } },
  });
  const originalSlots = await readFile(smokePublicPath(CUBE_SLOTS), "utf8");
  await writeJson(CUBE_SLOTS, { schema: 1, slots: [MATERIAL_ID] });

  try {
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
      const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __swayScenes: any[]; __swayRenderer?: any };
      w.__swayScenes = [];
      w.__THREE_DEVTOOLS__ = new EventTarget();
      w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
        const object = (event as CustomEvent).detail;
        if (object?.isScene) w.__swayScenes.push(object);
        if (object?.isWebGLRenderer) w.__swayRenderer = object;
      });
    });

    // --- Author: turn Wind Sway on in the Material Editor and save.
    await page.setViewportSize({ width: 1600, height: 950 });
    await page.goto("/?editor");
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
    await page.locator("[data-content-toggle]").click();
    const drawer = page.locator("[data-content-drawer]");
    await drawer.locator(`button.folder-row[title="${FOLDER}"]`).click();
    await drawer.getByRole("button", { name: /^Sway/ }).first().dblclick();
    const enabled = page.locator('[data-me-field="swayEnabled"]');
    await expect(enabled).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-me-field="swayAmplitude"]')).toHaveCount(0);
    await enabled.check();
    const amplitude = page.locator('[data-me-field="swayAmplitude"]');
    await expect(amplitude).toHaveValue("0.15");
    await amplitude.fill("0.3");
    await amplitude.press("Tab");
    await page.locator("[data-me-save]").click();
    await expect.poll(async () => JSON.parse(await readFile(smokePublicPath(MATERIAL_PATH), "utf8")).sway, { timeout: 15_000 })
      .toEqual({ amplitude: 0.3, height: 1, frequency: 0.6 });

    // The viewport rebuilds on save: the editor draws both placements as clones.
    await expect.poll(() => page.evaluate(swayMeshCounts), { timeout: 15_000 })
      .toEqual({ instanced: 0, clones: 2, shadowed: 2 });

    // --- Play reads the saved file.
    await page.goto(`/?debug&materialSway=${Date.now()}`);
    await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
    await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(swayMeshCounts), { timeout: 30_000 })
      .toEqual({ instanced: 1, clones: 1, shadowed: 2 });

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
      const swaying: any[] = [];
      for (const scene of w.__swayScenes) scene.traverse((node: any) => {
        if (node.isMesh && String(node.material?.customProgramCacheKey?.()).includes("forge-wind-sway")) swaying.push(node);
      });
      const instanced = swaying.find((mesh) => mesh.isInstancedMesh);
      const programs = swaying.map((mesh) => ({
        lit: Boolean(renderer.properties.get(mesh.material).currentProgram),
        shadow: Boolean(renderer.properties.get(mesh.customDepthMaterial).currentProgram),
      }));
      const material = instanced.material;
      const uniforms = renderer.properties.get(material).uniforms;
      const live = {
        strength: uniforms.uWindStrength.value,
        direction: uniforms.uWindDirection.value.toArray(),
        amplitude: uniforms.uSwayAmplitude.value,
        baseScale: uniforms.uSwayBaseScale.value,
      };

      // A bare scene built from the runtime's own classes (the bundle exposes no THREE).
      const testScene = new w.__swayScenes[0].constructor();
      testScene.background = material.color.clone().setRGB(0, 0, 0);
      const mesh = new instanced.constructor(instanced.geometry, material, 1);
      mesh.frustumCulled = false;
      testScene.add(mesh);
      const camera = w.__swayCamera;
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0); // looks down -Z, +X is screen right
      camera.near = 0.1;
      camera.far = 1000;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      // A 3 m tall box 10 m in front of the camera, sized from the geometry itself.
      instanced.geometry.computeBoundingBox();
      const box = instanced.geometry.boundingBox;
      const scale = 3 / (box.max.y - box.min.y);
      const matrix = instanced.matrix.clone().makeScale(scale, scale, scale);
      matrix.setPosition(0, 0, -10);
      mesh.setMatrixAt(0, matrix);
      mesh.instanceMatrix.needsUpdate = true;

      // The shell rewrites these every frame; this synchronous render sees ours.
      const keys = ["uWindStrength", "uWindGust", "uWindTime", "uSwayAmplitude", "uSwayHeight", "uWindViewOrigin"];
      const saved = Object.fromEntries(keys.map((key) => [key, uniforms[key].value?.clone ? uniforms[key].value.clone() : uniforms[key].value]));
      const savedEmissive = material.emissive.clone();
      const savedAutoClear = renderer.autoClear;
      uniforms.uWindDirection.value.set(1, 0);
      uniforms.uWindGust.value = 0;
      uniforms.uWindTime.value = 0;
      uniforms.uSwayAmplitude.value = 1;
      // Metres at instance scale 1: the node scale gives the top face the full mask.
      uniforms.uSwayHeight.value = Math.max(box.max.y * uniforms.uSwayBaseScale.value, 1e-3);
      uniforms.uWindViewOrigin.value.set(0, 0, 0);
      // Independent of the level's lighting.
      const savedEmissiveIntensity = material.emissiveIntensity;
      material.emissive.setRGB(1, 1, 1);
      material.emissiveIntensity = 1;

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
        const covered = (x: number, y: number): boolean => {
          const index = (y * width + x) * 4;
          return pixels[index]! + pixels[index + 1]! + pixels[index + 2]! > 60;
        };
        let lit = 0;
        let minY = height;
        let maxY = -1;
        for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
          if (!covered(x, y)) continue;
          lit += 1;
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
        const rowCentre = (row: number): number => {
          let count = 0;
          let sum = 0;
          for (let x = 0; x < width; x += 1) if (covered(x, row)) { count += 1; sum += x; }
          return count > 0 ? sum / count : Number.NaN;
        };
        // readPixels rows go bottom-up: maxY is the top of the silhouette.
        return { lit, top: rowCentre(maxY - 2), bottom: rowCentre(minY + 2), width };
      };
      const calm = frame(0);
      const calmAgain = frame(0);
      const windy = frame(1);

      for (const key of keys) {
        const value = saved[key];
        if (value?.copy) uniforms[key].value.copy(value); else uniforms[key].value = value;
      }
      material.emissive.copy(savedEmissive);
      material.emissiveIntensity = savedEmissiveIntensity;
      renderer.autoClear = savedAutoClear;
      mesh.dispose();
      return { programs, live, calm, calmAgain, windy };
    });
    expect(result.programs).toEqual([{ lit: true, shadow: true }, { lit: true, shadow: true }]);
    // The saved settings and worldSettings.wind reached the shader: 90° blows towards +X.
    expect(result.live.strength).toBeCloseTo(1, 5);
    expect(result.live.direction[0]).toBeCloseTo(1, 5);
    expect(result.live.amplitude).toBeCloseTo(0.3, 5);
    expect(result.live.baseScale).toBeCloseTo(0.01, 5); // Shape_Cube's centimetre node
    expect(result.calm.lit).toBeGreaterThan(1000);
    expect(result.calmAgain).toEqual(result.calm);
    expect(result.windy.top - result.calm.top).toBeGreaterThan(result.calm.width * 0.01);
    expect(Math.abs(result.windy.bottom - result.calm.bottom)).toBeLessThan(result.windy.top - result.calm.top);
    expect(errors).toEqual([]);
  } finally {
    await writeFile(manifestPath, originalManifest);
    await rm(smokePublicPath(FOLDER), { recursive: true, force: true });
    await rm(smokePublicPath(LEVEL), { force: true });
    await writeFile(smokePublicPath(CUBE_SLOTS), originalSlots);
  }
});
