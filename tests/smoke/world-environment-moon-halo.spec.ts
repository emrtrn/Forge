import { expect, test } from "./test";

test.setTimeout(180_000);

test("World Environment: independent moon halo preserves lunar detail and daytime solar bloom", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("**/__wes-halo", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><body style='margin:0;background:black'>" }));
  await page.goto("/__wes-halo");
  const report = await page.evaluate(async () => {
    const T = await import("/tests/smoke/pages/engineThree.ts" as string);
    const { AuthoredEnvironment } = await import("/engine/render-three/authoredEnvironment.ts" as string);
    const { resolveWorldEnvironment } = await import("/engine/environment/worldEnvironment.ts" as string);
    const { stateFromDefaults } = await import("/engine/environment/environmentResolve.ts" as string);
    const { evaluateSunLight } = await import("/engine/environment/sunPath.ts" as string);
    const { resolvePostProcess } = await import("/engine/scene/postProcess.ts" as string);
    const { PostProcessPipeline, applyPostProcessToneMapping, createPostProcessEffectPasses } = await import("/engine/render-three/postProcess.ts" as string);
    const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(512, 512); document.body.append(renderer.domElement);
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(12, 1, 0.1, 500);
    const layout = {
      schema: 1, name: "Moon halo", loadGroups: [], instances: [], characters: [], skyAtmosphere: { exposure: 1 },
      worldEnvironment: { hidden: false, night: { moonBrightness: 1, moonAngularDiameterDeg: 2, moonHaloIntensity: 0.5, moonHaloSize: 4, starBrightness: 0 } },
    };
    const settings = resolveWorldEnvironment(layout.worldEnvironment);
    const direction = new T.Vector3(...evaluateSunLight(23, settings).lightDirection);
    camera.lookAt(direction);
    const env = new AuthoredEnvironment({ scene, renderer, camera: () => camera, resolveSunActor: () => null });
    env.applySky(layout);
    const pipeline = new PostProcessPipeline({ scene, renderer, camera, width: 512, height: 512 });
    const post = resolvePostProcess({ toneMapping: "aces", exposure: 1, bloom: { enabled: true, threshold: 1, intensity: 1, radius: 1 } });
    applyPostProcessToneMapping(renderer, post); env.applySkyPostProcessExposure(post, layout);
    pipeline.setEffectPasses(createPostProcessEffectPasses(post, { scene, camera, width: 512, height: 512 }));
    const apply = (intensity = 0.5, size = 4, hour = 23) => {
      Object.assign(layout.worldEnvironment.night, { moonHaloIntensity: intensity, moonHaloSize: size });
      env.applyWorldEnvironment(layout, { state: { ...stateFromDefaults(settings), hour }, sun: null, ambient: null, dynamicClock: true }); env.update(0);
    };
    const gl = renderer.getContext();
    const render = () => {
      pipeline.render(0); const pixels = new Uint8Array(512 * 512 * 4);
      gl.readPixels(0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return pixels;
    };
    const lum = (pixels: Uint8Array, x: number, y = 256) => { const i = (y * 512 + x) * 4; return 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!; };
    const delta = (a: Uint8Array, b: Uint8Array) => { let max = 0; for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!)); return max; };
    const images: { name: string; png: string }[] = [];
    const capture = (name: string) => images.push({ name, png: renderer.domElement.toDataURL("image/png") });
    try {
      apply(0); const off = render(); capture("halo-off"); const calls = renderer.info.render.calls;
      apply(); const on = render(); capture("halo-default");
      const callsWithHalo = renderer.info.render.calls;
      let coreDifference = 0;
      for (let y = 240; y < 272; y++) for (let x = 240; x < 272; x++) coreDifference = Math.max(coreDifference, Math.abs(lum(on, x, y) - lum(off, x, y)));
      const near = lum(on, 320) - lum(off, 320), far = lum(on, 400) - lum(off, 400);
      apply(1); const brighter = lum(render(), 320) - lum(off, 320);
      apply(0.5, 8); const wider = lum(render(), 440) - lum(off, 440);
      camera.position.set(80, 20, -60); camera.lookAt(camera.position.clone().add(direction)); env.update(0);
      apply(); const translated = render(); const translation = Math.abs(lum(translated, 320) - lum(on, 320));
      env.applyClouds({ ...layout, cloudLayer: { coverage: 1, density: 1, softness: 0.01, speed: 0 } });
      const cloudOn = render(); apply(0); const cloudDifference = delta(cloudOn, render()); env.applyClouds(layout);
      const geometry = new T.PlaneGeometry(100, 100), material = new T.MeshBasicMaterial({ color: 0 });
      const blocker = new T.Mesh(geometry, material); blocker.position.copy(camera.position).addScaledVector(direction, 5); blocker.quaternion.copy(camera.quaternion);
      scene.add(blocker); apply(); const blocked = render(); apply(0); const foregroundDifference = delta(blocked, render()); scene.remove(blocker); geometry.dispose(); material.dispose();
      camera.lookAt(camera.position.clone().add(new T.Vector3(...evaluateSunLight(12, settings).sunDirection)));
      apply(0, 4, 12); const dayOff = render(); apply(5, 12, 12); const dayDifference = delta(dayOff, render());
      camera.lookAt(camera.position.clone().add(direction)); apply(); layout.worldEnvironment.night.moonBrightness = 0; apply(); const hidden = render(); apply(0); const hiddenDifference = delta(hidden, render());
      layout.worldEnvironment.night.moonBrightness = 1;
      camera.fov = 60; camera.aspect = 16 / 9; camera.updateProjectionMatrix(); renderer.setSize(960, 540); pipeline.setSize(960, 540);
      apply(); pipeline.render(0); capture("halo-normal-60deg");
      return { near, far, brighter, wider, coreDifference, translation, cloudDifference, foregroundDifference, dayDifference, hiddenDifference, calls, callsWithHalo, images };
    } finally { pipeline.dispose(); env.teardown(); renderer.dispose(); }
  });
  await testInfo.attach("halo-measurements", { body: JSON.stringify({ ...report, images: undefined }, null, 2), contentType: "application/json" });
  for (const { name, png } of report.images) await testInfo.attach(name, { body: Buffer.from(png.split(",")[1]!, "base64"), contentType: "image/png" });
  expect(report.near).toBeGreaterThan(15);
  expect(report.far).toBeGreaterThan(1);
  expect(report.far).toBeLessThan(report.near);
  expect(report.brighter).toBeGreaterThan(report.near);
  expect(report.wider).toBeGreaterThan(2);
  expect(report.coreDifference).toBeLessThan(2);
  expect(report.translation).toBeLessThan(2);
  expect(report.cloudDifference).toBeLessThanOrEqual(4);
  expect(report.foregroundDifference).toBe(0);
  expect(report.dayDifference).toBe(0);
  expect(report.hiddenDifference).toBe(0);
  expect(report.callsWithHalo).toBe(report.calls);
  expect(errors).toEqual([]);
});
