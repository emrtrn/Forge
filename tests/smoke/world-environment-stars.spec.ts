import { expect, test } from "./test";

test.setTimeout(180_000);

test("World Environment: stars survive camera movement, fade by day and stay behind clouds and geometry", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/__wes-stars", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><body style='margin:0;background:black'>" }));
  await page.goto("/__wes-stars");
  const report = await page.evaluate(async () => {
    const T = await import("/tests/smoke/pages/engineThree.ts" as string);
    const { AuthoredEnvironment } = await import("/engine/render-three/authoredEnvironment.ts" as string);
    const { resolveWorldEnvironment } = await import("/engine/environment/worldEnvironment.ts" as string);
    const { stateFromDefaults } = await import("/engine/environment/environmentResolve.ts" as string);
    const { resolvePostProcess } = await import("/engine/scene/postProcess.ts" as string);
    const { PostProcessPipeline, applyPostProcessToneMapping, createPostProcessEffectPasses } = await import("/engine/render-three/postProcess.ts" as string);
    const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    const width = 960, height = 540;
    renderer.setSize(width, height);
    document.body.append(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(60, width / height, 0.1, 500);
    const aim = new T.Vector3(0, 0.65, -1).normalize();
    camera.lookAt(aim);
    const layout = {
      schema: 1, name: "Stars", loadGroups: [], instances: [], characters: [],
      skyAtmosphere: { exposure: 1 },
      worldEnvironment: { hidden: false, night: { starBrightness: 1, starDensity: 0.5, starSize: 1, moonBrightness: 1 } },
    };
    const settings = resolveWorldEnvironment(layout.worldEnvironment);
    const env = new AuthoredEnvironment({ scene, renderer, camera: () => camera, resolveSunActor: () => null });
    env.applySky(layout);
    const post = resolvePostProcess({ toneMapping: "aces", exposure: 1, bloom: { enabled: true, threshold: 1, intensity: 1, radius: 1 } });
    applyPostProcessToneMapping(renderer, post);
    env.applySkyPostProcessExposure(post, layout);
    const pipeline = new PostProcessPipeline({ scene, renderer, camera, width, height });
    pipeline.setEffectPasses(createPostProcessEffectPasses(post, { scene, camera, width, height }));
    let composite = false;
    const apply = (hour = 0, brightness = 1, density = 0.5, size = 1, fog = false) => {
      Object.assign(layout.worldEnvironment.night, { starBrightness: brightness, starDensity: density, starSize: size });
      env.applyWorldEnvironment(layout, {
        state: { ...stateFromDefaults(settings), hour, weather: { preset: fog ? "fog" : "clear", intensity: 1 } },
        sun: null, ambient: null, dynamicClock: true,
      });
      env.update(0);
    };
    const gl = renderer.getContext();
    const render = () => {
      if (composite) pipeline.render(0); else renderer.render(scene, camera);
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const diff = (a: Uint8Array, b: Uint8Array) => {
      let sum = 0, count = 0, max = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(0, a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!);
        sum += d; if (d > 8) count++; max = Math.max(max, d);
      }
      return { sum, count, max };
    };
    const images: { name: string; png: string }[] = [];
    const capture = (name: string) => images.push({ name, png: renderer.domElement.toDataURL("image/png") });
    try {
      apply(0, 0); let off = render();
      const offCalls = renderer.info.render.calls, textures = renderer.info.memory.textures;
      apply(); const night = render(); const nightCalls = renderer.info.render.calls;
      capture("night-default-60deg");
      const textureDelta = renderer.info.memory.textures - textures;
      const signal = diff(night, off);
      camera.position.set(100, 50, -80); camera.lookAt(camera.position.clone().add(aim)); env.update(0);
      const moved = render();
      const translation = diff(night, moved).sum + diff(moved, night).sum;
      apply(0, 0); off = render();
      apply(0, 1, 1); const dense = diff(render(), off);
      apply(0, 1, 0.5, 2); const larger = diff(render(), off);
      apply(0, 2); const brighter = diff(render(), off);
      apply(0, 1, 0); const zeroDensity = diff(render(), off);
      apply(12); const day = render(); capture("day"); apply(12, 0); const dayDifference = diff(day, render());
      apply(0, 1, 0.5, 1, true); const fog = diff(render(), off);
      apply();
      const geometry = new T.PlaneGeometry(100, 100), material = new T.MeshBasicMaterial({ color: 0x000000 });
      const blocker = new T.Mesh(geometry, material);
      blocker.position.copy(camera.position).addScaledVector(aim, 5); blocker.quaternion.copy(camera.quaternion);
      scene.add(blocker); const blocked = render(); apply(0, 0); const foregroundDifference = diff(blocked, render());
      scene.remove(blocker); geometry.dispose(); material.dispose();
      env.applyClouds({ ...layout, cloudLayer: { coverage: 1, density: 1, softness: 0.01, speed: 0 } });
      apply(); const cloudy = render(); apply(0, 0); const cloudDifference = diff(cloudy, render());
      env.applyClouds(layout);
      apply(); layout.worldEnvironment.hidden = true; apply(); const hidden = render();
      layout.worldEnvironment.hidden = false; apply(0, 0);
      // Hidden WES restores daytime authored sky, so compare against no WES.
      env.applyWorldEnvironment(layout, { state: null, sun: null, ambient: null });
      const hiddenDifference = diff(hidden, render());
      composite = true;
      apply(0, 0); const postOff = render(); apply(); const postSignal = diff(render(), postOff); capture("night-bloom-60deg");
      apply(18.25); render(); capture("twilight");
      apply(0, 1, 1, 3); render(); capture("maximum-density-size");
      // Alternate view crosses a cube face boundary (x == z), including zenith.
      camera.lookAt(camera.position.clone().add(new T.Vector3(1, 1.2, -1))); env.update(0);
      apply(); render(); capture("cube-boundary-zenith");
      // Paired GPU times are diagnostic only, never a universal performance
      // assertion. SwiftShader/unsupported timer-query devices report null.
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const gpu = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "unknown";
      const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      let gpuTiming: { offMs: number; onMs: number; deltaMs: number; pairs: number } | null = null;
      if (timer && !/swiftshader|software/i.test(gpu)) {
        composite = false;
        const measure = async (brightness: number) => {
          apply(0, brightness);
          const query = gl.createQuery()!;
          gl.beginQuery(timer.TIME_ELAPSED_EXT, query); renderer.render(scene, camera); gl.endQuery(timer.TIME_ELAPSED_EXT);
          let ready = false;
          for (let attempt = 0; attempt < 120; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 8));
            if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) { ready = true; break; }
          }
          const value = ready && !gl.getParameter(timer.GPU_DISJOINT_EXT) ? Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6 : NaN;
          gl.deleteQuery(query);
          return value;
        };
        await measure(0); await measure(1);
        const offTimes: number[] = [], onTimes: number[] = [];
        for (let pair = 0; pair < 9; pair++) {
          if (pair % 2) { onTimes.push(await measure(1)); offTimes.push(await measure(0)); }
          else { offTimes.push(await measure(0)); onTimes.push(await measure(1)); }
        }
        if ([...offTimes, ...onTimes].every(Number.isFinite)) {
          const median = (values: number[]) => [...values].sort((a, b) => a - b)[4]!;
          gpuTiming = { offMs: median(offTimes), onMs: median(onTimes), deltaMs: median(onTimes.map((v, i) => v - offTimes[i]!)), pairs: 9 };
        }
      }
      return { signal, dense, larger, brighter, zeroDensity, dayDifference, fog, foregroundDifference, cloudDifference, hiddenDifference,
        translation, offCalls, nightCalls, textureDelta, postSignal, gpu, gpuTiming, images };
    } finally { pipeline.dispose(); env.teardown(); renderer.dispose(); }
  });
  await testInfo.attach("star-measurements", { body: JSON.stringify({ ...report, images: undefined }, null, 2), contentType: "application/json" });
  for (const { name, png } of report.images) await testInfo.attach(name, { body: Buffer.from(png.split(",")[1]!, "base64"), contentType: "image/png" });
  expect(report.signal.count).toBeGreaterThan(50);
  expect(report.signal.max).toBeGreaterThan(25);
  expect(report.translation).toBeLessThan(100);
  expect(report.dense.count).toBeGreaterThan(report.signal.count);
  expect(report.larger.sum).toBeGreaterThan(report.signal.sum);
  expect(report.brighter.sum).toBeGreaterThan(report.signal.sum);
  expect(report.zeroDensity.sum).toBe(0);
  expect(report.dayDifference.sum).toBe(0);
  expect(report.fog.sum).toBeLessThan(report.signal.sum * 0.2);
  expect(report.foregroundDifference.sum).toBe(0);
  expect(report.cloudDifference.count).toBe(0);
  expect(report.cloudDifference.max).toBeLessThanOrEqual(4);
  expect(report.hiddenDifference.sum).toBe(0);
  expect(report.nightCalls).toBe(report.offCalls);
  expect(report.textureDelta).toBe(0);
  expect(report.postSignal.count).toBeGreaterThan(50);
  expect(errors).toEqual([]);
});
