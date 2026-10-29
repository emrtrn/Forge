import { createForgeRuntime } from "@/scene/ForgeRuntime";
import { createDefaultRuntimeModules } from "@/scene/capabilities/defaultRuntimeModules";
import { createGameModule } from "@/game/gameModule";
import { updateLandscapeLod } from "@engine/render-three/landscape";
import { isPlanarReflectionCamera } from "@engine/render-three/planarReflectionSource";
import type { LakeWaterController } from "@/scene/lakeWaterController";
import type { RoomLayout } from "@engine/scene/layout";
import type { PerspectiveCamera, Scene, WebGLRenderer, Group } from "three";

// All instrumentation lives in this QA entrypoint, never in a shipping frame.
const params = new URLSearchParams(location.search), kind = params.get("kind") ?? "small";
const profile = params.get("profile") ?? "caustics";
const started = performance.now();
const forge = await createForgeRuntime({ canvas: document.querySelector("canvas")!,
  modules: createDefaultRuntimeModules(), gameModules: [createGameModule()], debug: false });
const factoryMs = performance.now() - started, loadStart = performance.now();
await forge.loadLevel(`layouts/__lake-perf-${kind}-${profile}.level.json`);
const bootMs = performance.now() - started, levelMs = performance.now() - loadStart, navigationReadyMs = performance.now();
const a = forge.app as unknown as {
  camera: PerspectiveCamera; renderer: WebGLRenderer; scene: Scene; lakes: LakeWaterController; layout: RoomLayout;
  landscapeObjects: Group[]; frameHandle: number; onFrame: ((dt: number) => void) | null;
  gpuSweepSession: { beginFrame(): void; endFrame(): void; disable(): void };
  environment: { update(dt: number): void }; qualitySettings: unknown;
  setGraphicsAdaptive(enabled: boolean): boolean; setGraphicsQualityLevel(level: "ultra"): boolean;
  waterReflections: { size: number }; postProcessPipeline: unknown;
};
const gl = a.renderer.getContext() as WebGL2RenderingContext;
const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
const debug = gl.getExtension("WEBGL_debug_renderer_info");
const device = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
a.setGraphicsQualityLevel("ultra"); a.setGraphicsAdaptive(false);
a.gpuSweepSession.disable();
const fullscreen = document.querySelector<HTMLButtonElement>("#fullscreen")!;
fullscreen.onclick = async () => { await document.documentElement.requestFullscreen(); fullscreen.hidden = true; };

let pose = 0, active = false, caustics = true, water = true, route = false;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
function camera() {
  const t = pose * Math.PI * 2;
  const world = kind === "world", maximum = kind === "maximum";
  const radius = world ? 1150 : maximum ? 160 : 55, height = world ? 1250 : maximum ? 125 : 45;
  a.camera.position.set(Math.sin(t) * radius, height, Math.cos(t) * radius);
  a.camera.near = .1; a.camera.far = world ? 7000 : 2000;
  a.camera.lookAt(world || maximum ? 0 : -10, 11, 0); a.camera.updateProjectionMatrix(); a.camera.updateMatrixWorld(true);
}
const environmentUpdate = a.environment.update.bind(a.environment);
a.environment.update = dt => {
  if (measure) pose = route ? Math.floor(sampleIndex / 2) / pairCount : 0;
  environmentUpdate(dt); camera();
};

// Change only the caustic count, after the production terrain binder; retain
// the exact same shader, terrain, lighting, surface and post-process in A/B.
a.scene.traverse((node: any) => {
  if (!node.userData.forgeTerrain) return;
  const before = node.onBeforeRender;
  node.onBeforeRender = (...args: any[]) => {
    before(...args);
    const u = node.userData.forgeTerrain.materials.uniforms;
    if (!caustics || !water) u.uCausticCount.value = 0;
    // Paired neighbouring frames share a timestamp and route position.
    if (active) u.uCausticTime.value = pose * 5;
  };
});

type Sample = { query: WebGLQuery; on: boolean; pair: number; calls: number; captures: number; triangles: number; cpuMs: number; rafMs: number };
let samples: Sample[] = [], sample: Sample | null = null, measure = false, sampleIndex = 0;
let measureMode: "caustics" | "surface" | "lake" = "caustics", pairCount = 300, renderStart = 0, previous = 0;
let resolveDone: (() => void) | undefined, disjointSeen = false;
let captures = 0;
const render = a.renderer.render.bind(a.renderer);
a.renderer.render = (scene, camera) => { if (isPlanarReflectionCamera(camera)) captures++; render(scene, camera); };
const oldBegin = a.gpuSweepSession.beginFrame.bind(a.gpuSweepSession), oldEnd = a.gpuSweepSession.endFrame.bind(a.gpuSweepSession);
a.gpuSweepSession.beginFrame = () => {
  oldBegin();
  if (!measure || !ext) return;
  // Alternate AB / BA to reduce ordering and GPU-clock bias.
  const pair = Math.floor(sampleIndex / 2), on = (sampleIndex % 2 === 1) !== (pair % 2 === 1);
  pose = route ? pair / pairCount : 0; camera();
  for (const object of a.landscapeObjects) updateLandscapeLod(object, a.camera);
  caustics = measureMode !== "surface" && on;
  water = measureMode === "caustics" || on;
  for (const object of a.lakes.objects.values()) object.visible = water;
  const query = gl.createQuery();
  if (!query || gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) throw new Error("GPU query unavailable or already owned");
  renderStart = performance.now();
  captures = 0;
  sample = { query, on, pair, calls: 0, captures: 0, triangles: 0, cpuMs: 0, rafMs: previous ? renderStart - previous : 0 };
  previous = renderStart;
  gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
};
a.gpuSweepSession.endFrame = () => {
  if (sample && ext) {
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    // Submit both timestamp commands now: an idle display interval must not
    // become part of a deferred command buffer's elapsed-time query.
    gl.flush();
    disjointSeen ||= !!gl.getParameter(ext.GPU_DISJOINT_EXT);
    sample.cpuMs = performance.now() - renderStart;
    sample.calls = a.renderer.info.render.calls; sample.triangles = a.renderer.info.render.triangles;
    sample.captures = captures;
    samples.push(sample); sample = null;
    if (++sampleIndex >= pairCount * 2) { measure = false; resolveDone?.(); }
  }
  oldEnd();
};

function summary(values: number[]) {
  const sorted = [...values].sort((x, y) => x - y);
  return { count: values.length, p50: sorted[Math.ceil(values.length * .5) - 1] ?? null,
    p95: sorted[Math.ceil(values.length * .95) - 1] ?? null, max: sorted.at(-1) ?? null };
}
function witness() {
  const canvas = a.renderer.domElement;
  return { device, timer: !!ext, bootMs, factoryMs, levelMs, navigationReadyMs, kind, profile, fullscreen: !!document.fullscreenElement,
    screen: [screen.width, screen.height], viewport: [innerWidth, innerHeight], drawingBuffer: [canvas.width, canvas.height],
    pixelRatio: a.renderer.getPixelRatio(), postProcess: !!a.postProcessPipeline, quality: a.qualitySettings,
    reflectionGroups: a.waterReflections.size, textures: a.renderer.info.memory.textures, geometries: a.renderer.info.memory.geometries,
    lakes: [...a.lakes.results].map(([id, r]) => ({ id, status: r.status, message: r.message, cells: r.cells,
      triangles: r.indices.length / 3, bytes: r.bytes, buildMs: r.buildMs })), glError: gl.getError() };
}
(window as any).__lakePerf = {
  witness,
  async gpu(mode: "caustics" | "surface" | "lake", pairs = 300, moving = false) {
    if (!ext || /swiftshader|llvmpipe|software/i.test(device)) return { available: false, reason: "Hardware GPU timer required", device };
    measureMode = mode; pairCount = pairs; route = moving; active = true; samples = []; sampleIndex = 0; previous = 0; disjointSeen = false;
    // Warm the exact A/B production paths, including captures and post-process.
    for (let i = 0; i < 60; i++) {
      caustics = i % 2 === 0; water = mode === "caustics" || i % 2 === 0;
      for (const object of a.lakes.objects.values()) object.visible = water;
      await frame();
    }
    // Clear a stale disjoint flag before starting; reject any change in flight.
    gl.getParameter(ext.GPU_DISJOINT_EXT);
    try {
      await new Promise<void>(resolve => { resolveDone = resolve; measure = true; });
      let disjoint = disjointSeen || !!gl.getParameter(ext.GPU_DISJOINT_EXT);
      for (let i = 0; i < 180 && samples.some(s => !gl.getQueryParameter(s.query, gl.QUERY_RESULT_AVAILABLE)); i++) {
        await frame(); disjoint ||= !!gl.getParameter(ext.GPU_DISJOINT_EXT);
      }
      if (disjoint || samples.some(s => !gl.getQueryParameter(s.query, gl.QUERY_RESULT_AVAILABLE))) {
        return { available: false, reason: "Disjoint or incomplete GPU samples", device };
      }
      const raw = samples.map(({ query, ...s }) => ({ ...s, gpuMs: gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6 }));
      const off = raw.filter(s => !s.on), on = raw.filter(s => s.on);
      const delta = on.map(s => s.gpuMs - off.find(b => b.pair === s.pair)!.gpuMs);
      return { available: true, mode, moving, witness: witness(), baseline: summary(off.map(s => s.gpuMs)),
        enabled: summary(on.map(s => s.gpuMs)), pairedDelta: summary(delta),
        submitCpu: summary(raw.map(s => s.cpuMs)), raf: summary(raw.slice(1).map(s => s.rafMs)),
        additionalDraws: summary(on.map(s => s.calls - off.find(b => b.pair === s.pair)!.calls)), raw };
    } finally {
      measure = false; active = false; caustics = water = true; pose = 0;
      samples.forEach(s => gl.deleteQuery(s.query)); samples = [];
      for (const object of a.lakes.objects.values()) object.visible = true;
    }
  },
  async rebuild(count = 35) {
    const durations: number[] = [], retained: Array<{ textures: number; geometries: number; bytes: number }> = [];
    for (let i = 0; i < count; i++) {
      const id = `lake-warm-${i}`;
      performance.mark(`${id}-start`);
      const start = performance.now();
      await a.lakes.rebuild(a.layout.waterBodies ?? []);
      durations.push(performance.now() - start);
      performance.mark(`${id}-end`); performance.measure(id, `${id}-start`, `${id}-end`);
      await frame();
      retained.push({ textures: a.renderer.info.memory.textures, geometries: a.renderer.info.memory.geometries,
        bytes: [...a.lakes.results.values()].reduce((sum, r) => sum + r.bytes, 0) });
    }
    return { durations, retained, measured: summary(durations.slice(5)), witness: witness() };
  },
};
camera(); forge.start();
