// S3 Pipeline: the S2 terrain scene through one RenderPipeline (MRT -> GTAO /
// SSR / SSGI -> TRAA -> bloom), effects behind flags (shared/pipeline.ts).
// Two modes:
//  - default: one configuration (?config=<name>, default "balanced") with the
//    perf witness; the baseline window measures it (run.mjs --measure);
//  - ?sweep=1: per-effect cost in one page load. Every configuration of
//    CONFIGS in order, then "direct" again as a drift check; each gets a
//    warm-up (?warm=<s>, default 4) and a window (?window=<s>, default 10):
//    frame = window / frames, p95 of rAF intervals, GPU = median of the
//    timestamp queries (all render passes of the frame). Not the G method.
// URL: level=<project path>, config=<name>, sweep=1, configs=<a,b,...>.
import * as THREE from "three/webgpu";
import { report, startMeasuredLoop } from "../shared/spike";
import { buildTerrainScene, type TerrainScene } from "../shared/terrainScene";
import { CONFIGS, createPipeline, DEFAULT_BLOOM, EFFECT_SETTINGS, type BloomSettings, type SpikePipeline } from "../shared/pipeline";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const loading = document.querySelector<HTMLElement>(".forge-loading")!;

function levelBloom(level: Record<string, unknown>): BloomSettings {
  const b = (level.postProcess as { bloom?: { threshold?: number; intensity?: number; radius?: number } } | undefined)?.bloom;
  return b ? { strength: b.intensity ?? DEFAULT_BLOOM.strength, radius: b.radius ?? DEFAULT_BLOOM.radius, threshold: b.threshold ?? DEFAULT_BLOOM.threshold } : DEFAULT_BLOOM;
}

/** Renders one configuration; `null` flags = direct render. */
class Renderer {
  private pipeline: SpikePipeline | null = null;
  name = "";
  constructor(private ts: TerrainScene, private bloom: BloomSettings) {}
  use(name: string): Record<string, unknown> {
    if (!(name in CONFIGS)) throw new Error(`unknown config ${name}`);
    this.pipeline?.dispose();
    this.pipeline = null;
    const flags = CONFIGS[name]!;
    if (flags) this.pipeline = createPipeline(this.ts.renderer, this.ts.scene, this.ts.camera, flags, this.bloom);
    this.name = name;
    return this.pipeline ? this.pipeline.describe : { effects: [], direct: true };
  }
  frame(): void {
    const { renderer, scene, camera } = this.ts;
    // The pipeline renders several passes per frame: count the whole frame.
    renderer.info.reset();
    this.ts.update();
    if (this.pipeline) this.pipeline.render();
    else renderer.render(scene, camera);
  }
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round((s[lo]! + (s[hi]! - s[lo]!) * (i - lo)) * 100) / 100;
}

async function sweep(ts: TerrainScene, r: Renderer, names: string[], warmS: number, windowS: number) {
  const { renderer, proof } = ts;
  const rows: Record<string, unknown>[] = [];
  const out = document.getElementById("out");
  for (const name of names) {
    const describe = r.use(name);
    const intervals: number[] = [];
    const gpu: number[] = [];
    const draws: number[] = [];
    let frames = 0;
    let last: number | null = null;
    let pending = false;
    const firstFrameAt = performance.now();
    let windowStart = Infinity;
    let windowEnd = Infinity;
    await new Promise<void>((done) => {
      const tick = (now: number): void => {
        r.frame();
        const measuring = now >= windowStart;
        if (windowStart === Infinity && now - firstFrameAt >= warmS * 1000) {
          windowStart = now;
          windowEnd = now + windowS * 1000;
        }
        if (measuring) {
          frames += 1;
          if (last !== null) intervals.push(now - last);
          draws.push(renderer.info.render.drawCalls);
          if (proof.timestampQuery && !pending) {
            pending = true;
            renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER).then((ms) => {
              if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) gpu.push(ms);
            }).finally(() => { pending = false; });
          }
        }
        last = now;
        if (now >= windowEnd) { done(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const row = {
      config: name, describe, frames,
      frameMeanMs: Math.round((windowS * 1000 / Math.max(1, frames)) * 100) / 100,
      frameP95Ms: quantile(intervals, 0.95), gpuMedianMs: quantile(gpu, 0.5), gpuP95Ms: quantile(gpu, 0.95), gpuSamples: gpu.length,
      drawCalls: quantile(draws, 0.5),
    };
    rows.push(row);
    if (out) out.textContent = JSON.stringify(rows.map((x) => [x.config, x.frameMeanMs, x.gpuMedianMs]), null, 0);
    // A rejected timestamp resolve from the previous config must not leak into the next.
    await new Promise((res) => setTimeout(res, 50));
  }
  return rows;
}

async function main(): Promise<void> {
  // Five MRT targets (40 bytes / sample) exceed the WebGPU default of 32; R1 offers 128.
  const ts = await buildTerrainScene(canvas, params, { raiseLimits: { maxColorAttachmentBytesPerSample: 64 } });
  const { spike, renderer, proof, scene, camera, terrain, view, env, loadedMs } = ts;
  renderer.info.autoReset = false;
  await renderer.compileAsync(scene, camera);
  const bloomSettings = levelBloom(ts.level);
  const r = new Renderer(ts, bloomSettings);
  const base = {
    level: params.get("level"), loadMs: Math.round(loadedMs),
    proof: { backend: proof.backend, isWebGPUBackend: proof.isWebGPUBackend, timestampQuery: proof.timestampQuery, maxColorAttachmentBytesPerSample: proof.limits.maxColorAttachmentBytesPerSample },
    terrain: { tiles: terrain.tiles.size, resident: view.residentKeys.length, layers: terrain.layers.length },
    environment: env.describe, canvas: [canvas.width, canvas.height], effectSettings: EFFECT_SETTINGS, bloom: bloomSettings,
  };

  if (params.get("sweep") === "1") {
    const names = params.get("configs")?.split(",") ?? [...Object.keys(CONFIGS), "direct"];
    loading.hidden = true;
    const rows = await sweep(ts, r, names, Number(params.get("warm") ?? 4), Number(params.get("window") ?? 10));
    report("complete", { mode: "sweep", ...base, selection: ts.selection(), rows });
    return;
  }

  const name = params.get("config") ?? "balanced";
  const describe = r.use(name);
  startMeasuredLoop(spike, () => r.frame(), `s3-${name}`);
  await new Promise((res) => setTimeout(res, 500));
  loading.hidden = true;
  report("complete", { mode: "view", config: name, describe, ...base, readyMs: Math.round(performance.now() - ts.startedAt), selection: ts.selection() });
}

main().catch((error: unknown) => {
  loading.hidden = true;
  document.getElementById("out")?.classList.remove("quiet");
  report("failed", { error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) });
});
