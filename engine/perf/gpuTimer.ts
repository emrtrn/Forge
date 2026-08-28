/**
 * GPU-side frame timing via `EXT_disjoint_timer_query_webgl2`.
 *
 * The CPU profiler answers "how long did we spend *issuing* the frame"; this
 * answers "how long did the GPU spend *executing* it" — together they answer the
 * only question that decides what to optimise, which of the two you are bound
 * by. Everything awkward about this API is a consequence of three facts:
 *
 *  - **Queries cannot nest.** Only one `TIME_ELAPSED` may be active at a time,
 *    so a GPU breakdown can never be a tree like the CPU one. Spans are
 *    sequential, and anything finer has to be measured by comparing whole
 *    frames against each other.
 *  - **Results arrive late.** A query begun this frame typically resolves one to
 *    three frames later, so every sample carries a caller-supplied `tag` — the
 *    only way to know which frame's work a late result is describing.
 *  - **Results can be invalidated.** A GPU power-state change or context switch
 *    raises `GPU_DISJOINT_EXT`, and every result in flight becomes meaningless;
 *    {@link GpuFrameTimer.poll} drops them rather than reporting garbage.
 *
 * Browsers also quantise the returned nanoseconds as a side-channel mitigation,
 * so sub-0.1 ms differences are not signal. Callers should say so where the
 * numbers are shown.
 *
 * Availability is not universal (Chrome/Edge desktop yes, Firefox varies, Safari
 * no), which is why construction goes through {@link GpuFrameTimer.create} and
 * returns `null` instead of a timer that silently reports zero.
 */

/** The slice of WebGL2 this needs — an interface so tests can drive a fake. */
export interface GpuTimerContext {
  createQuery(): WebGLQuery | null;
  deleteQuery(query: WebGLQuery | null): void;
  beginQuery(target: number, query: WebGLQuery): void;
  endQuery(target: number): void;
  getQueryParameter(query: WebGLQuery, pname: number): unknown;
  getParameter(pname: number): unknown;
  getExtension(name: string): unknown;
  readonly QUERY_RESULT_AVAILABLE: number;
  readonly QUERY_RESULT: number;
}

export interface GpuFrameSample {
  /** Whatever the caller passed to {@link GpuFrameTimer.begin} for that frame. */
  readonly tag: number;
  readonly ms: number;
}

export interface GpuFrameStats {
  readonly lastMs: number;
  readonly averageMs: number;
  readonly maxMs: number;
  readonly samples: number;
}

interface DisjointTimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

export const GPU_TIMER_EXTENSION = "EXT_disjoint_timer_query_webgl2";

/** Frames of GPU time the rolling readout averages over. */
const DEFAULT_WINDOW = 60;
/**
 * Queries allowed in flight. Results lag a few frames; a small pool absorbs that
 * without ever growing, and a frame that finds the pool empty is skipped rather
 * than allowed to stall the pipeline waiting for one.
 */
const DEFAULT_POOL = 8;

export class GpuFrameTimer {
  /** @returns a timer, or `null` where the browser has no timer queries. */
  static create(gl: GpuTimerContext | null, poolSize = DEFAULT_POOL): GpuFrameTimer | null {
    if (!gl) return null;
    const extension = gl.getExtension(GPU_TIMER_EXTENSION) as DisjointTimerExtension | null;
    if (!extension || typeof extension.TIME_ELAPSED_EXT !== "number") return null;
    return new GpuFrameTimer(gl, extension, poolSize);
  }

  private readonly idle: WebGLQuery[] = [];
  private readonly inFlight: { readonly query: WebGLQuery; readonly tag: number }[] = [];
  private readonly window: number[] = [];
  private active: WebGLQuery | null = null;
  private created = 0;
  private lastMs = 0;
  private disposed = false;
  /** Counts result batches thrown away by a disjoint event, for the caller. */
  private disjointEvents = 0;

  private constructor(
    private readonly gl: GpuTimerContext,
    private readonly extension: DisjointTimerExtension,
    private readonly poolSize: number,
  ) {}

  /**
   * Open a span around the draw calls the caller is about to issue.
   *
   * @returns whether a query was actually begun. `false` means every query is
   * still waiting on the GPU — the frame goes unmeasured, which is the correct
   * trade against blocking the pipeline to reclaim one.
   */
  begin(tag = 0): boolean {
    if (this.disposed || this.active) return false;
    const query = this.take();
    if (!query) return false;
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
    this.active = query;
    this.pendingTag = tag;
    return true;
  }

  end(): void {
    if (!this.active) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.inFlight.push({ query: this.active, tag: this.pendingTag });
    this.active = null;
  }

  /**
   * Collect whatever the GPU has finished with.
   *
   * Only samples tagged `0` — ordinary frames — feed the rolling stats; a caller
   * running a measurement sweep tags its frames so its own, deliberately
   * abnormal ones cannot drag the continuous readout around.
   */
  poll(): GpuFrameSample[] {
    if (this.disposed || this.inFlight.length === 0) return [];
    // Checked first: a disjoint event means everything currently in flight was
    // measured across a GPU state change and is not a duration at all.
    if (this.gl.getParameter(this.extension.GPU_DISJOINT_EXT) === true) {
      this.disjointEvents += 1;
      for (const entry of this.inFlight) this.idle.push(entry.query);
      this.inFlight.length = 0;
      return [];
    }
    const samples: GpuFrameSample[] = [];
    // Results resolve in submission order, so stop at the first one that is not
    // ready rather than scanning past it.
    while (this.inFlight.length > 0) {
      const entry = this.inFlight[0]!;
      if (this.gl.getQueryParameter(entry.query, this.gl.QUERY_RESULT_AVAILABLE) !== true) break;
      this.inFlight.shift();
      const nanoseconds = Number(this.gl.getQueryParameter(entry.query, this.gl.QUERY_RESULT) ?? 0);
      this.idle.push(entry.query);
      if (!Number.isFinite(nanoseconds)) continue;
      const ms = nanoseconds / 1_000_000;
      samples.push({ tag: entry.tag, ms });
      if (entry.tag === 0) this.record(ms);
    }
    return samples;
  }

  stats(): GpuFrameStats {
    const samples = this.window.length;
    if (samples === 0) return { lastMs: 0, averageMs: 0, maxMs: 0, samples: 0 };
    let total = 0;
    let peak = 0;
    for (const value of this.window) {
      total += value;
      if (value > peak) peak = value;
    }
    return { lastMs: this.lastMs, averageMs: total / samples, maxMs: peak, samples };
  }

  /** How many times results have been discarded as invalid since creation. */
  get disjointCount(): number {
    return this.disjointEvents;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // A leaked query per frame is a real leak, so the pool is emptied on both
    // sides — the ones waiting on the GPU included.
    if (this.active) {
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.gl.deleteQuery(this.active);
      this.active = null;
    }
    for (const entry of this.inFlight) this.gl.deleteQuery(entry.query);
    for (const query of this.idle) this.gl.deleteQuery(query);
    this.inFlight.length = 0;
    this.idle.length = 0;
  }

  private pendingTag = 0;

  private take(): WebGLQuery | null {
    const reused = this.idle.pop();
    if (reused) return reused;
    if (this.created >= this.poolSize) return null;
    const query = this.gl.createQuery();
    if (!query) return null;
    this.created += 1;
    return query;
  }

  private record(ms: number): void {
    this.lastMs = ms;
    this.window.push(ms);
    if (this.window.length > DEFAULT_WINDOW) this.window.shift();
  }
}
