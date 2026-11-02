import { expect, test } from "./test";

/**
 * A real WebGL photometry regression for the shared editor/Play binding.
 * Uses RuntimeParity's authored sky, Sun and post-process exposure, with a
 * non-emissive grey card rather than a whole-frame average (sky/UI/emissives
 * can hide a black road). No gameplay, fixture or user's level is modified.
 */
test.setTimeout(180_000);

test("World Environment: night fill lights unlit surfaces without altering noon or popping at the horizon", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__wes-night-photometry", (route) => route.fulfill({
    contentType: "text/html", body: "<!doctype html><html><body></body></html>",
  }));
  await page.goto("/__wes-night-photometry");
  const report = await page.evaluate(async () => {
    const THREE = await import("/node_modules/.vite/deps/three.js" as string);
    const { AuthoredEnvironment } = await import("/engine/render-three/authoredEnvironment.ts" as string);
    const { stateFromDefaults } = await import("/engine/environment/environmentResolve.ts" as string);
    const { resolveWorldEnvironment } = await import("/engine/environment/worldEnvironment.ts" as string);
    const { postProcessToneMappingExposure } = await import("/engine/render-three/postProcess.ts" as string);
    const layout = await (await fetch("/layouts/RuntimeParity.level.json")).json();
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(128, 128);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = postProcessToneMappingExposure(layout.postProcess.exposure);
    document.body.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 4);
    camera.lookAt(0, 0, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 1, metalness: 0 });
    const geometry = new THREE.PlaneGeometry(3, 3);
    scene.add(new THREE.Mesh(geometry, material));
    const sunActor = layout.lights.find((light: { type: string }) => light.type === "directional");
    const sun = new THREE.DirectionalLight(sunActor.color, sunActor.intensity);
    sun.position.set(...sunActor.position);
    scene.add(sun, sun.target);
    const env = new AuthoredEnvironment({ scene, renderer, camera: () => camera, resolveSunActor: () => sunActor });
    const snapshot = JSON.stringify(layout);
    const gl = renderer.getContext();
    const pixels = new Uint8Array(128 * 128 * 4);
    const measure = (): number => {
      renderer.render(scene, camera);
      gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0;
      for (let y = 32; y < 96; y++) for (let x = 32; x < 96; x++) {
        const i = (y * 128 + x) * 4;
        sum += 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
      }
      return sum / 4096;
    };
    const samples = [];
    try {
      for (const hour of [12, 0, 5.9999, 6, 6.0001, 17.9999, 18, 18.0001, 23]) {
        env.applyWorldEnvironment(layout, {
          state: { ...stateFromDefaults(resolveWorldEnvironment(layout.worldEnvironment)), hour },
          sun, ambient: null, dynamicClock: true,
        });
        const fill = scene.getObjectByName("world-environment-night-fill");
        if (!fill) throw new Error("Missing WES night fill with zero authored ambient");
        const full = measure();
        fill.visible = false;
        const withoutFill = measure();
        fill.visible = true;
        const environment = scene.environment;
        scene.environment = null;
        sun.visible = false;
        const fillOnly = measure();
        scene.environment = environment;
        sun.visible = true;
        samples.push({ hour, full, withoutFill, fillOnly, programs: renderer.info.programs.length });
      }
      const extension = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        samples, layoutUnchanged: JSON.stringify(layout) === snapshot,
      };
    } finally {
      env.teardown(); geometry.dispose(); material.dispose(); sun.dispose(); renderer.dispose();
    }
  });
  await testInfo.attach("night-photometry", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  const noon = report.samples.find((sample) => sample.hour === 12)!;
  expect(noon.full).toBeGreaterThan(50); // rejects a broken/black WebGL readback
  expect(noon.full).toBe(noon.withoutFill);
  for (const hour of [0, 23]) {
    const night = report.samples.find((sample) => sample.hour === hour)!;
    // A regression guard for this fixed grey card, not a product-wide GPU or
    // whole-scene visual-acceptance threshold.
    expect(night.full).toBeGreaterThan(night.withoutFill + 5);
    expect(night.fillOnly).toBeGreaterThan(5);
    expect(night.full).toBeLessThan(noon.full * 0.3);
  }
  for (const hour of [6, 18]) {
    const before = report.samples.find((sample) => sample.hour === hour - 0.0001)!;
    const after = report.samples.find((sample) => sample.hour === hour + 0.0001)!;
    expect(Math.abs(before.full - after.full)).toBeLessThan(2);
  }
  expect(new Set(report.samples.map((sample) => sample.programs)).size).toBe(1);
  expect(report.layoutUnchanged).toBe(true);
  expect(errors).toEqual([]);
});
