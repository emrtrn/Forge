// Shared plumbing for the Forge WebGPU spike (Forge-WebGPU rebuild plan, Faz 1).
// Throwaway: results go into the plan, this folder is not part of the app.
//
// Rules for every page in spikes/webgpu:
//  - three is imported only through `three/webgpu` and `three/tsl` (never the
//    WebGL entry `three`), plus three's examples/jsm addons.
//  - Forge modules are imported only from its three-free layers (`@engine/terrain`,
//    `@engine/scene`, `@engine/physics`), never from `@engine/render-three`.
//  - The page writes the same `data-forge-perf` witness shape as Forge's runtime,
//    so the Phase 0 baseline harness reads both the same way.
import * as THREE from "three/webgpu";

export interface BackendProof {
  isWebGPUBackend: boolean;
  backend: string;
  compatibilityMode: boolean | null;
  adapter: { vendor: string | undefined; architecture: string | undefined; device: string | undefined; description: string | undefined } | null;
  timestampQuery: boolean;
  features: string[];
  limits: Record<string, number>;
  userAgent: string;
}

export interface SpikeRenderer {
  renderer: THREE.WebGPURenderer;
  proof: BackendProof;
}

/** The pose the Phase 0 harness hands over (same key Forge's runtime reads). */
export interface CameraPose {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

const LIMIT_KEYS = [
  "maxTextureDimension2D", "maxTextureArrayLayers", "maxBindGroups", "maxStorageBufferBindingSize",
  "maxBufferSize", "maxComputeWorkgroupStorageSize", "maxComputeInvocationsPerWorkgroup", "maxColorAttachments",
];

/** Creates and initialises a WebGPURenderer; never falls back silently. */
export async function createSpikeRenderer(canvas: HTMLCanvasElement, options: { forceWebGL?: boolean } = {}): Promise<SpikeRenderer> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, trackTimestamp: true, forceWebGL: options.forceWebGL === true });
  await renderer.init();
  // The backend's device / adapter are not in the public typings.
  const backend = renderer.backend as unknown as {
    isWebGPUBackend?: boolean;
    compatibilityMode?: boolean;
    device?: { features: Set<string>; limits: Record<string, number>; adapterInfo?: Record<string, string> };
  };
  const device = backend.device;
  const info = device?.adapterInfo;
  const proof: BackendProof = {
    isWebGPUBackend: backend.isWebGPUBackend === true,
    backend: backend.isWebGPUBackend === true ? "webgpu" : "webgl2",
    compatibilityMode: typeof backend.compatibilityMode === "boolean" ? backend.compatibilityMode : null,
    adapter: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null,
    timestampQuery: device ? device.features.has("timestamp-query") : false,
    features: device ? [...device.features].sort() : [],
    limits: device ? Object.fromEntries(LIMIT_KEYS.map((k) => [k, Number(device.limits[k])])) : {},
    userAgent: navigator.userAgent,
  };
  canvas.dataset.forgeBackend = proof.backend;
  return { renderer, proof };
}

/** Reads the harness pose once (and removes it, like Forge's runtime). */
export function consumeCameraPose(): CameraPose | null {
  try {
    const raw = localStorage.getItem("forge.play.cameraPose");
    if (!raw) return null;
    localStorage.removeItem("forge.play.cameraPose");
    const pose = JSON.parse(raw) as CameraPose;
    return Array.isArray(pose.position) && Array.isArray(pose.quaternion) ? pose : null;
  } catch {
    return null;
  }
}

export function applyCameraPose(camera: THREE.Camera, pose: CameraPose): void {
  camera.position.set(...pose.position);
  camera.quaternion.set(...pose.quaternion);
  camera.updateMatrixWorld();
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}
const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Render loop with Forge's witness: frame interval, GPU time from timestamp
 * queries (resolved every frame), draw calls and triangles of the last frame.
 * Published on the canvas every 500 ms as `data-forge-perf`.
 */
export function startMeasuredLoop(spike: SpikeRenderer, frame: (dtMs: number) => void, quality = "spike"): () => void {
  const { renderer, proof } = spike;
  const canvas = renderer.domElement;
  const intervals: number[] = [];
  const gpu: number[] = [];
  let last: number | null = null;
  let nextPublish = 0;
  let pendingGpu = false;
  let running = true;
  let drawCalls = 0;
  let triangles = 0;
  const started = performance.now();
  const tick = (now: number): void => {
    if (!running) return;
    const dt = last === null ? 16.7 : now - last;
    if (last !== null) {
      intervals.push(dt);
      if (intervals.length > 600) intervals.shift();
    }
    last = now;
    frame(dt);
    drawCalls = renderer.info.render.drawCalls;
    triangles = renderer.info.render.triangles;
    if (proof.timestampQuery && !pendingGpu) {
      pendingGpu = true;
      renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER).then((ms) => {
        if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
          gpu.push(ms);
          if (gpu.length > 120) gpu.shift();
        }
      }).finally(() => { pendingGpu = false; });
    }
    if (now >= nextPublish) {
      nextPublish = now + 500;
      const avg = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
      canvas.dataset.forgePerf = JSON.stringify({
        schema: 1,
        frameMs: round2(dt),
        avgFrameMs: round2(avg),
        p95FrameMs: round2(quantile(intervals, 0.95)),
        gpuMs: gpu.length ? round2(gpu.reduce((a, b) => a + b, 0) / gpu.length) : null,
        drawCalls,
        triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.memory.programs ?? null,
        jsHeapBytes: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
        quality,
        adaptive: false,
        reductionDepth: 0,
        timeScale: 1,
        paused: false,
        sceneSeconds: round2((now - started) / 1000),
        backend: proof.backend,
        isWebGPUBackend: proof.isWebGPUBackend,
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => { running = false; };
}

/** Text report on the page and `window.__spikeReport` for the runner. */
export function report(status: "complete" | "failed", data: Record<string, unknown>): void {
  (window as unknown as { __spikeReport?: unknown }).__spikeReport = { status, ...data };
  const out = document.getElementById("out");
  if (out) out.textContent = JSON.stringify({ status, ...data }, null, 2);
}
