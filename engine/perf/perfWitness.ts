/**
 * The machine-readable perf witness: a compact JSON snapshot the runtime writes
 * onto the canvas so a harness outside the page can read what the page was
 * doing, without the page having to talk to it.
 *
 * Why a DOM attribute and not a callback: the reader is a Playwright script in
 * another process. A `data-` attribute is the one channel that needs no bridge,
 * survives a page it does not control, and is trivially inspectable by hand when
 * a run goes wrong. `tools/perf/browserPerfHarness.mjs` already looks for one.
 *
 * Two rules, both about not becoming the problem:
 *
 *  1. **Sampled, never per frame.** Serialising this every frame would make the
 *     observation a measurable part of what is being observed. It is written on
 *     the overlay's own half-second cadence.
 *  2. **Generic.** The template has no units, no wallets and no match clock. The
 *     witness carries what any Forge scene has — frame time, what was drawn,
 *     what quality is in force, what the memory counters say — and a fork adds
 *     its own fields through `extra` without editing this file.
 *
 * Pure and DOM-free: the shell serialises the result, this only shapes it.
 */
import type { FrameMetrics, FrameSpikeCounts } from "./frameMetrics";
import type { GpuFrameStats } from "./gpuTimer";

export interface PerfWitnessInput {
  readonly metrics: FrameMetrics;
  readonly spikes: FrameSpikeCounts;
  /** GPU frame time, or null where the browser has no timer queries. */
  readonly gpu: GpuFrameStats | null;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
  readonly programs: number;
  /** JS heap in bytes, or null off Chrome. */
  readonly jsHeapBytes: number | null;
  readonly qualityLevel: string;
  readonly adaptiveEnabled: boolean;
  readonly reductionDepth: number;
  readonly timeScale: number;
  readonly paused: boolean;
  readonly sceneSeconds: number;
  /** Fork-supplied fields. Merged last, and never overwritten by this shape. */
  readonly extra?: Readonly<Record<string, number | string | boolean | null>>;
}

/**
 * One sample of the witness.
 *
 * Field names are short because this is serialised sixty times a minute into an
 * attribute, and long because a capture read six months later has to be legible
 * without this file open. The compromise is: no abbreviations that are not
 * already the names used in the overlay.
 */
export interface PerfWitness {
  readonly schema: 1;
  readonly frameMs: number;
  readonly avgFrameMs: number;
  readonly p95FrameMs: number;
  readonly over33ms: number;
  readonly over50ms: number;
  readonly over100ms: number;
  /** Null rather than 0 where the browser will not say — a different fact. */
  readonly gpuMs: number | null;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
  readonly programs: number;
  readonly jsHeapBytes: number | null;
  readonly quality: string;
  readonly adaptive: boolean;
  readonly reductionDepth: number;
  readonly timeScale: number;
  readonly paused: boolean;
  readonly sceneSeconds: number;
  readonly [key: string]: number | string | boolean | null | undefined;
}

/** Two decimals: past that it is timer quantisation dressed as precision. */
function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

export function buildPerfWitness(input: PerfWitnessInput): PerfWitness {
  const witness: PerfWitness = {
    schema: 1,
    frameMs: round(input.metrics.frameTimeMs),
    avgFrameMs: round(input.metrics.averageFrameTimeMs),
    p95FrameMs: round(input.metrics.p95FrameTimeMs),
    over33ms: input.spikes.over33ms,
    over50ms: input.spikes.over50ms,
    over100ms: input.spikes.over100ms,
    // Null, not zero: "the GPU cost nothing" and "nobody measured the GPU" are
    // opposite findings, and a report reading this months later cannot ask.
    gpuMs: input.gpu ? round(input.gpu.averageMs) : null,
    drawCalls: input.drawCalls,
    triangles: input.triangles,
    geometries: input.geometries,
    textures: input.textures,
    programs: input.programs,
    jsHeapBytes: input.jsHeapBytes,
    quality: input.qualityLevel,
    adaptive: input.adaptiveEnabled,
    reductionDepth: input.reductionDepth,
    timeScale: input.timeScale,
    paused: input.paused,
    sceneSeconds: round(input.sceneSeconds),
  };
  if (!input.extra) return witness;
  // Fork fields never shadow the template's: a witness whose `quality` means
  // something different per fork is a witness nothing can compare.
  const merged: Record<string, number | string | boolean | null | undefined> = {};
  for (const [key, value] of Object.entries(input.extra)) {
    if (!(key in witness)) merged[key] = value;
  }
  return { ...merged, ...witness };
}

/** Serialises a witness for the canvas attribute. */
export function serializePerfWitness(witness: PerfWitness): string {
  return JSON.stringify(witness);
}
