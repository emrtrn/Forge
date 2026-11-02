import { createForgeRuntime } from "@/scene/ForgeRuntime";
import { createDefaultRuntimeModules } from "@/scene/capabilities/defaultRuntimeModules";
import { createGameModule } from "@/game/gameModule";
import { GpuFrameTimer } from "@engine/perf/gpuTimer";
import type { AuthoredEnvironment } from "@engine/render-three/authoredEnvironment";
import type { RuntimeServices } from "@/scene/capabilities/RuntimeServices";
import { worldEnvironmentService } from "@/scene/capabilities/runtimeServiceKeys";
import type { RoomLayout } from "@engine/scene/layout";
import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";

// QA-only instrumentation of the real runtime, following lake-performance.ts.
// No hooks are added to the engine/editor or shipping game entrypoint.
const forge = await createForgeRuntime({ canvas: document.querySelector("canvas")!,
  modules: createDefaultRuntimeModules(), gameModules: [createGameModule()], debug: false });
await forge.loadLevel("layouts/__wes-acceptance.level.json");
const app = forge.app;
const a = app as unknown as {
  camera: PerspectiveCamera; renderer: WebGLRenderer; scene: Scene; layout: RoomLayout;
  environment: AuthoredEnvironment;
  runtimeServices: RuntimeServices;
  gpuSweepSession: { beginFrame(): void; endFrame(): void; disable(): void };
  qualitySettings: unknown;
};
app.setGraphicsQualityLevel("high");
app.setGraphicsAdaptive(false);
a.gpuSweepSession.disable();
const gl = a.renderer.getContext() as WebGL2RenderingContext;
const debug = gl.getExtension("WEBGL_debug_renderer_info");
const device = String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
const software = /swiftshader|llvmpipe|lavapipe|softpipe|software|basic render/i.test(device);
const frameTimer = software ? null : GpuFrameTimer.create(gl);
const captureTimer = software ? null : GpuFrameTimer.create(gl);
const gpu = new Map<number, number>();
const captureGpu = new Map<number, number>();
let serial = 0, active = false, captureActive = false, started = 0, renderStart = 0;
let samples: Array<{ tag: number; at: number; renderSubmitMs: number; calls: number; triangles: number }> = [];
let captures: Array<{ tag: number; cpuSubmitMs: number }> = [];
let currentTag = 0;
type Scenario = { id: string; enabled: boolean; hour: number; weather: "clear" | "cloudy" | "fog"; dayLengthMinutes?: number };
const controller = a.runtimeServices.resolve(worldEnvironmentService);
if (!controller) throw new Error("World Environment capability service is missing");
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const pose = { position: [0, 4, 16], target: [0, 3.5, 0], fov: 65 } as const;
function camera() {
  a.camera.position.set(...pose.position); a.camera.lookAt(...pose.target);
  a.camera.fov = pose.fov; a.camera.updateProjectionMatrix(); a.camera.updateMatrixWorld(true);
}
const update = a.environment.update.bind(a.environment);
a.environment.update = () => { camera(); update(0); }; // stationary camera + frozen cloud phase
const reflect = a.environment.applyReflection.bind(a.environment);
a.environment.applyReflection = (layout, recapture = false) => {
  // The original implementation captures iff forced or no target exists.
  const hasTarget = !!(a.environment as unknown as { reflectionTarget: unknown }).reflectionTarget;
  if (!(active || captureActive) || (!recapture && hasTarget)) return reflect(layout, recapture);
  const tag = ++serial, before = performance.now();
  captureTimer?.begin(tag);
  try { return reflect(layout, recapture); }
  finally {
    captureTimer?.end(); if (captureTimer) gl.flush();
    captures.push({ tag, cpuSubmitMs: performance.now() - before });
  }
};
const begin = a.gpuSweepSession.beginFrame.bind(a.gpuSweepSession);
const end = a.gpuSweepSession.endFrame.bind(a.gpuSweepSession);
a.gpuSweepSession.beginFrame = () => {
  begin();
  if (!active) return;
  currentTag = ++serial; renderStart = performance.now(); frameTimer?.begin(currentTag);
};
a.gpuSweepSession.endFrame = () => {
  end();
  if (active) {
    frameTimer?.end(); if (frameTimer) gl.flush();
    const stats = app.getRenderStats();
    samples.push({ tag: currentTag, at: performance.now() - started,
      renderSubmitMs: performance.now() - renderStart, calls: stats.drawCalls, triangles: stats.triangles });
  }
  for (const sample of frameTimer?.poll() ?? []) gpu.set(sample.tag, sample.ms);
  for (const sample of captureTimer?.poll() ?? []) captureGpu.set(sample.tag, sample.ms);
};
async function drain(tags: number[], values: Map<number, number>, timer: GpuFrameTimer | null) {
  if (!timer) return;
  for (let tries = 0; tries < 120 && tags.some(tag => !values.has(tag)); tries++) await frame();
}
function witness() {
  const info = a.renderer.info;
  return { device, timerAvailable: !!gl.getExtension("EXT_disjoint_timer_query_webgl2"), gpuTimingEnabled: !!frameTimer, camera: pose,
    worldEnvironment: controller!.current(),
    quality: a.qualitySettings, buffer: app.getDrawingBufferSnapshot(),
    geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0,
    render: app.getRenderStats(), gameObjects: a.layout.actors?.map(actor => actor.name), glError: gl.getError() };
}
(window as any).__wesAcceptance = {
  witness,
  async select(next: Scenario) {
    // Reload only the real clock controller, not the scene/physics. The
    // production capability advances it with TimeControl's simulation delta.
    controller!.load(next.enabled ? { ...a.layout.worldEnvironment,
      time: { hour: next.hour, dayLengthMinutes: next.dayLengthMinutes ?? 0 },
      weather: { preset: next.weather, intensity: 1 } } : null);
    await frame(); await frame(); return witness();
  },
  async measure(durationMs: number) {
    samples = []; captures = []; gpu.clear(); captureGpu.clear();
    const disjointBefore = (frameTimer?.disjointCount ?? 0) + (captureTimer?.disjointCount ?? 0);
    const beginAt = performance.now(); started = beginAt; active = true;
    try { while (performance.now() - beginAt < durationMs) await frame(); }
    finally { active = false; }
    const elapsedMs = performance.now() - beginAt;
    await drain(samples.map(s => s.tag), gpu, frameTimer);
    await drain(captures.map(s => s.tag), captureGpu, captureTimer);
    const disjoint = ((frameTimer?.disjointCount ?? 0) + (captureTimer?.disjointCount ?? 0)) !== disjointBefore;
    return { elapsedMs, samples: samples.map((s, i) => ({ ...s,
      frameMs: i ? s.at - samples[i - 1]!.at : null, gpuMs: disjoint ? null : gpu.get(s.tag) ?? null })),
      captures: captures.map(s => ({ ...s, gpuMs: disjoint ? null : captureGpu.get(s.tag) ?? null })), disjoint, witness: witness() };
  },
  async ibl(count: number) {
    captures = []; captureGpu.clear();
    const before = captureTimer?.disjointCount ?? 0;
    captureActive = true;
    try { for (let i = 0; i < count; i++) { await frame(); a.environment.applyReflection(a.layout, true); } }
    finally { captureActive = false; }
    await drain(captures.map(s => s.tag), captureGpu, captureTimer);
    const disjoint = (captureTimer?.disjointCount ?? 0) !== before;
    return { samples: captures.map(s => ({ ...s, gpuMs: disjoint ? null : captureGpu.get(s.tag) ?? null })), disjoint };
  },
};
camera(); forge.start();
