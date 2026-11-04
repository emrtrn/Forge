import { expect, test } from "./test";

test.setTimeout(180_000);

test("World Environment: cratered moon follows the light, fades by day and stays behind clouds and terrain", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/__wes-moon", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body style='margin:0;background:#000'></body></html>" }));
  await page.goto("/__wes-moon");
  const result = await page.evaluate(async () => {
    const THREE = await import("/tests/smoke/pages/engineThree.ts" as string);
    const { AuthoredEnvironment } = await import("/engine/render-three/authoredEnvironment.ts" as string);
    const { resolveWorldEnvironment } = await import("/engine/environment/worldEnvironment.ts" as string);
    const { stateFromDefaults } = await import("/engine/environment/environmentResolve.ts" as string);
    const { evaluateSunLight } = await import("/engine/environment/sunPath.ts" as string);
    const { resolvePostProcess } = await import("/engine/scene/postProcess.ts" as string);
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(256, 256);
    document.body.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(8, 1, 0.1, 500);
    const layout = {
      schema: 1, name: "Moon", loadGroups: [], instances: [], characters: [],
      worldEnvironment: { night: { moonBrightness: 1, moonAngularDiameterDeg: 1.2 } },
      skyAtmosphere: { exposure: 1 },
    };
    const settings = resolveWorldEnvironment(layout.worldEnvironment);
    const direction = new THREE.Vector3(...evaluateSunLight(23, settings).lightDirection);
    camera.lookAt(direction);
    const env = new AuthoredEnvironment({ scene, renderer, camera: () => camera, resolveSunActor: () => null });
    env.applySky(layout);
    env.applySkyPostProcessExposure(resolvePostProcess({ toneMapping: "aces", exposure: 1 }), layout);
    const apply = (hour: number, brightness = 1) => {
      layout.worldEnvironment.night.moonBrightness = brightness;
      env.applyWorldEnvironment(layout, { state: { ...stateFromDefaults(settings), hour }, sun: null, ambient: null, dynamicClock: true });
      env.update(0);
    };
    const gl = renderer.getContext();
    const pixels = new Uint8Array(256 * 256 * 4);
    const render = () => {
      renderer.render(scene, camera);
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels.slice();
    };
    const luminance = (image: Uint8Array, x: number, y: number) => {
      const i = (y * 256 + x) * 4;
      return 0.2126 * image[i]! + 0.7152 * image[i + 1]! + 0.0722 * image[i + 2]!;
    };
    const center = (image: Uint8Array) => luminance(image, 128, 128);
    apply(23);
    const night = render();
    const skyCalls = renderer.info.render.calls;
    const textureCount = renderer.info.memory.textures;
    apply(23, 0);
    const hidden = render();
    // The night camera centers the disc exactly where the moonlight points.
    const contrast = center(night) - center(hidden);
    const detail: number[] = [];
    for (let y = 119; y < 137; y++) for (let x = 119; x < 137; x++) detail.push(luminance(night, x, y));
    const craterContrast = Math.max(...detail) - Math.min(...detail);
    apply(12);
    const day = render();
    apply(12, 0);
    const dayHidden = render();
    const dayUnchanged = day.every((value, index) => value === dayHidden[index]);
    apply(23);
    camera.position.set(120, 42, -80);
    camera.lookAt(camera.position.clone().add(direction));
    env.update(0);
    const translated = render();
    const translationDifference = Math.abs(center(translated) - center(night));
    // A real opaque scene object must cover the background moon.
    const geometry = new THREE.PlaneGeometry(4, 4);
    const material = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const blocker = new THREE.Mesh(geometry, material);
    blocker.position.copy(camera.position).addScaledVector(direction, 5);
    blocker.quaternion.copy(camera.quaternion);
    scene.add(blocker);
    const foreground = center(render());
    scene.remove(blocker);
    // Fully opaque authored clouds cover the disc through the existing cloud pass.
    const cloudyLayout = { ...layout, cloudLayer: { coverage: 1, density: 1, softness: 0.01, speed: 0 } };
    env.applyClouds(cloudyLayout);
    env.update(0);
    const cloudy = center(render());
    apply(23, 0);
    const cloudyHidden = center(render());
    const calls = renderer.info.render.calls;
    // A separate close-up for visual review, after all fixed-size measurements.
    env.applyClouds(layout);
    apply(23);
    camera.fov = 4;
    camera.updateProjectionMatrix();
    renderer.setSize(512, 512);
    renderer.render(scene, camera);
    const screenshot = renderer.domElement.toDataURL("image/png");
    env.teardown(); geometry.dispose(); material.dispose(); renderer.dispose();
    return { contrast, craterContrast, dayUnchanged, translationDifference, foreground, cloudy, cloudyHidden, night: center(night), skyCalls, calls, textureCount, screenshot };
  });
  await testInfo.attach("visible-moon", { body: Buffer.from(result.screenshot.split(",")[1]!, "base64"), contentType: "image/png" });
  await testInfo.attach("moon-measurements", { body: JSON.stringify({ ...result, screenshot: undefined }, null, 2), contentType: "application/json" });
  expect(result.contrast).toBeGreaterThan(25);
  expect(result.craterContrast).toBeGreaterThan(5);
  expect(result.dayUnchanged).toBe(true);
  expect(result.translationDifference).toBeLessThan(2);
  expect(result.foreground).toBeLessThan(1);
  expect(Math.abs(result.cloudy - result.cloudyHidden)).toBeLessThan(1);
  expect(result.skyCalls).toBe(1);
  expect(errors).toEqual([]);
});

test("World Environment: moon retains surface detail through the night with standard exposure and bloom", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/__wes-moon-post", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><body style='margin:0;background:black'>" }));
  await page.goto("/__wes-moon-post");
  const report = await page.evaluate(async () => {
    const THREE = await import("/tests/smoke/pages/engineThree.ts" as string);
    const { AuthoredEnvironment } = await import("/engine/render-three/authoredEnvironment.ts" as string);
    const { resolveWorldEnvironment } = await import("/engine/environment/worldEnvironment.ts" as string);
    const { stateFromDefaults } = await import("/engine/environment/environmentResolve.ts" as string);
    const { evaluateSunLight } = await import("/engine/environment/sunPath.ts" as string);
    const { resolvePostProcess } = await import("/engine/scene/postProcess.ts" as string);
    const { PostProcessPipeline, applyPostProcessToneMapping, createPostProcessEffectPasses } = await import("/engine/render-three/postProcess.ts" as string);
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(256, 256);
    document.body.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(4, 1, 0.1, 500);
    const layout = {
      schema: 1, name: "Moon post", loadGroups: [], instances: [], characters: [],
      skyAtmosphere: { exposure: 1 },
      worldEnvironment: { night: { moonBrightness: 1 } },
    };
    const settings = resolveWorldEnvironment(layout.worldEnvironment);
    const post = resolvePostProcess({ toneMapping: "aces", exposure: 1, bloom: { enabled: true, threshold: 1, intensity: 1, radius: 1 } });
    applyPostProcessToneMapping(renderer, post);
    const env = new AuthoredEnvironment({ scene, renderer, camera: () => camera, resolveSunActor: () => null });
    env.applySky(layout);
    env.applySkyPostProcessExposure(post, layout);
    const pipeline = new PostProcessPipeline({ scene, renderer, camera, width: 256, height: 256 });
    pipeline.setEffectPasses(createPostProcessEffectPasses(post, { scene, camera, width: 256, height: 256 }));
    const pixels = new Uint8Array(256 * 256 * 4);
    const samples = [];
    const images: { hour: number; png: string }[] = [];
    try {
      // Both twilight ramps, full night, midnight wrap, and the off switch.
      for (const hour of [18, 18.1, 18.25, 18.5, 19, 23, 0, 5, 5.5, 5.75, 5.9, 6]) {
        camera.lookAt(new THREE.Vector3(...evaluateSunLight(hour, settings).lightDirection));
        env.applyWorldEnvironment(layout, { state: { ...stateFromDefaults(settings), hour }, sun: null, ambient: null, dynamicClock: true });
        env.update(0);
        pipeline.render(0);
        renderer.getContext().readPixels(0, 0, 256, 256, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixels);
        const detail: number[] = [];
        let white = 0;
        // Interior only: excludes the silhouette, so a flat white disc fails.
        for (let y = 108; y < 148; y++) for (let x = 108; x < 148; x++) {
          const i = (y * 256 + x) * 4;
          detail.push(0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!);
          if (Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) >= 240) white++;
        }
        detail.sort((a, b) => a - b);
        samples.push({ hour, median: detail[800]!, contrast: detail[1440]! - detail[160]!, whiteFraction: white / detail.length });
        if ([18.25, 23, 5.75].includes(hour)) images.push({ hour, png: renderer.domElement.toDataURL("image/png") });
      }
      layout.worldEnvironment.night.moonBrightness = 0;
      env.applyWorldEnvironment(layout, { state: { ...stateFromDefaults(settings), hour: 23 }, sun: null, ambient: null, dynamicClock: true });
      camera.lookAt(new THREE.Vector3(...evaluateSunLight(23, settings).lightDirection));
      env.update(0);
      pipeline.render(0);
      renderer.getContext().readPixels(128, 128, 1, 1, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixels);
      return { samples, images, hidden: Math.max(pixels[0]!, pixels[1]!, pixels[2]!) };
    } finally {
      pipeline.dispose(); env.teardown(); renderer.dispose();
    }
  });
  await testInfo.attach("moon-night-sweep", { body: JSON.stringify({ ...report, images: undefined }, null, 2), contentType: "application/json" });
  for (const { hour, png } of report.images) await testInfo.attach(`moon-hour-${hour}`, { body: Buffer.from(png.split(",")[1]!, "base64"), contentType: "image/png" });
  for (const sample of report.samples.filter(({ hour }) => [18.5, 19, 23, 0, 5, 5.5].includes(hour))) {
    expect(sample.whiteFraction, `white disc at ${sample.hour}`).toBeLessThan(0.01);
    expect(sample.contrast, `surface contrast at ${sample.hour}`).toBeGreaterThan(15);
    expect(sample.median, `visible moon at ${sample.hour}`).toBeGreaterThan(40);
    expect(sample.median, `overexposed moon at ${sample.hour}`).toBeLessThan(210);
  }
  expect(report.hidden).toBeLessThan(5);
  expect(errors).toEqual([]);
});
