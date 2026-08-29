/**
 * The shell-side half of the GPU sweep (`src/scene/gpuSweepSession.ts`): the
 * part that owns the timer queries and the scene.
 *
 * `gpuSweep.test.ts` covers the arithmetic and the schedule; this covers what
 * they are wired to. Everything here defends one promise — that asking the
 * question leaves the scene exactly as it was found. A sweep hides content,
 * freezes the shadow map and skips the post-process pipeline; if any of that
 * survives the run, the diagnostic has quietly become a bug in the editor.
 *
 * It runs headless because the session imports `three` for types only and reads
 * the scene structurally, so a plain object graph and a fake WebGL2 context are
 * enough to drive a whole run frame by frame.
 */
import assert from "node:assert/strict";

import type { Scene, WebGLRenderer } from "three";

import { GPU_TIMER_EXTENSION, type GpuTimerContext } from "../../engine/perf/gpuTimer";
import type { GpuSweepOutcome } from "../../engine/perf/gpuSweepRunner";
import { GpuSweepSession } from "../../src/scene/gpuSweepSession";

type Check = (label: string, fn: () => void) => void;

const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;

interface FakeObject {
  visible: boolean;
  userData: Record<string, unknown>;
  parent: FakeObject | null;
  name: string;
}

/** One tagged top-level scene child, the way a shell tags what it builds. */
function object(source: string): FakeObject {
  return { visible: true, userData: { forgeSceneSource: source }, parent: null, name: source };
}

/**
 * A WebGL2 context that resolves every query immediately, reporting whatever the
 * caller says the current configuration costs. Real results lag by frames; the
 * runner is tested against that separately, and hiding the lag here keeps this
 * file about the scene rather than about query plumbing.
 */
class FakeGl implements GpuTimerContext {
  readonly QUERY_RESULT_AVAILABLE = 0x9194;
  readonly QUERY_RESULT = 0x8866;
  /** Queries handed out, so a leak in `dispose` is visible as a mismatch. */
  created = 0;
  deleted = 0;
  private active: object | null = null;
  private readonly resolved = new Map<object, number>();

  constructor(
    /** Milliseconds the GPU "spends" on a frame drawn in the current state. */
    private readonly costMs: () => number,
    /** Whether the timer extension is available at all. */
    private readonly hasExtension = true,
  ) {}

  createQuery(): WebGLQuery | null {
    this.created += 1;
    return {} as WebGLQuery;
  }

  deleteQuery(): void {
    this.deleted += 1;
  }

  beginQuery(_target: number, query: WebGLQuery): void {
    this.active = query as unknown as object;
  }

  endQuery(): void {
    if (this.active) this.resolved.set(this.active, this.costMs() * 1_000_000);
    this.active = null;
  }

  getQueryParameter(query: WebGLQuery, pname: number): unknown {
    const key = query as unknown as object;
    if (pname === this.QUERY_RESULT_AVAILABLE) return this.resolved.has(key);
    return this.resolved.get(key) ?? 0;
  }

  getParameter(): unknown {
    return false;
  }

  getExtension(name: string): unknown {
    if (!this.hasExtension || name !== GPU_TIMER_EXTENSION) return null;
    return { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT };
  }
}

interface Harness {
  readonly session: GpuSweepSession;
  readonly children: FakeObject[];
  readonly shadowMap: { autoUpdate: boolean };
  readonly gl: FakeGl;
  /** Runs one frame: begin, "draw", end. */
  frame(): void;
  /** True while the sweep's post-process step is skipping the pipeline. */
  bypassSeen: boolean;
  holds: number;
  releases: number;
}

/**
 * A scene whose GPU cost is a function of what is actually drawn: two ms per
 * visible top-level child, three more while the shadow map is updating, four
 * more while the post-process pipeline runs. A run should therefore recover
 * exactly those numbers, one row at a time.
 */
function harness(options: { sources: string[]; postProcess?: boolean }): Harness {
  const children = options.sources.map(object);
  const shadowMap = { autoUpdate: true };
  const state = {
    bypassSeen: false,
    holds: 0,
    releases: 0,
  };
  let session!: GpuSweepSession;
  const gl = new FakeGl(() => {
    const visible = children.filter((child) => child.visible).length;
    const shadows = shadowMap.autoUpdate ? 3 : 0;
    const post = options.postProcess && !session.bypassPostProcess ? 4 : 0;
    return visible * 2 + shadows + post;
  });
  const renderer = { getContext: () => gl, shadowMap } as unknown as WebGLRenderer;
  const scene = { children, userData: {}, parent: null, name: "scene" } as unknown as Scene;
  session = new GpuSweepSession({
    renderer,
    scene,
    renderStats: () => ({ drawCalls: 100, triangles: 50_000 }),
    sceneSeconds: () => 12,
    ...(options.postProcess ? { postProcessActive: () => true } : {}),
    hold: () => {
      state.holds += 1;
    },
    release: () => {
      state.releases += 1;
    },
  });
  const self: Harness = {
    session,
    children,
    shadowMap,
    gl,
    frame: () => {
      session.beginFrame();
      if (session.bypassPostProcess) self.bypassSeen = true;
      session.endFrame();
    },
    get bypassSeen() {
      return state.bypassSeen;
    },
    set bypassSeen(value: boolean) {
      state.bypassSeen = value;
    },
    get holds() {
      return state.holds;
    },
    get releases() {
      return state.releases;
    },
  };
  return self;
}

/** Drives frames until the sweep reports, or the budget runs out. */
function runToCompletion(harness: Harness, maxFrames = 400): GpuSweepOutcome | null {
  let outcome: GpuSweepOutcome | null = null;
  harness.session.start((result) => {
    outcome = result;
  });
  for (let frame = 0; frame < maxFrames && outcome === null; frame += 1) harness.frame();
  return outcome;
}

export function registerGpuSweepSessionTests(check: Check): void {
  check("a browser without timer queries is told so, and the scene is untouched", () => {
    const children = [object("foliage")];
    const gl = new FakeGl(() => 8, false);
    const session = new GpuSweepSession({
      renderer: { getContext: () => gl, shadowMap: { autoUpdate: true } } as unknown as WebGLRenderer,
      scene: { children } as unknown as Scene,
      renderStats: () => ({ drawCalls: 0, triangles: 0 }),
      sceneSeconds: () => 0,
    });
    session.enable();
    let outcome: GpuSweepOutcome | null = null;
    session.start((result) => {
      outcome = result;
    });
    // A table of zeros would read as "nothing costs anything" — a wrong answer
    // wearing the clothes of a right one.
    assert.equal(outcome?.kind, "failed");
    assert.match((outcome as { reason: string }).reason, /GPU timer queries/);
    assert.equal(children[0]?.visible, true);
  });

  check("each saving is attributed to the category that was switched off", () => {
    const app = harness({ sources: ["foliage", "foliage", "foliage", "static-mesh", "static-mesh", "editor-overlay"] });
    app.session.enable();
    const outcome = runToCompletion(app);
    assert.equal(outcome?.kind, "done");
    const rows = new Map(
      (outcome as { sweep: { rows: { label: string; savingMs: number }[] } }).sweep.rows.map(
        (row) => [row.label, Number(row.savingMs.toFixed(2))],
      ),
    );
    // Three foliage children at 2 ms each, two static meshes, one overlay, and
    // the shadow pass at 3 ms. The editor's own overlay is a row of its own
    // precisely because it is tagged like any other content.
    assert.equal(rows.get("foliage"), 6);
    assert.equal(rows.get("static-mesh"), 4);
    assert.equal(rows.get("editor-overlay"), 2);
    assert.equal(rows.get("shadow map"), 3);
  });

  check("a finished run puts the scene back and releases only its own hold", () => {
    const app = harness({ sources: ["foliage", "static-mesh"] });
    app.session.enable();
    assert.equal(runToCompletion(app)?.kind, "done");
    assert.deepEqual(app.children.map((child) => child.visible), [true, true]);
    assert.equal(app.shadowMap.autoUpdate, true);
    assert.equal(app.holds, 1);
    assert.equal(app.releases, 1);
  });

  check("the post-process row exists only where a pipeline is drawing", () => {
    const withPipeline = harness({ sources: ["foliage"], postProcess: true });
    withPipeline.session.enable();
    const outcome = runToCompletion(withPipeline);
    assert.equal(outcome?.kind, "done");
    const rows = (outcome as { sweep: { rows: { label: string; savingMs: number }[] } }).sweep.rows;
    assert.equal(rows.find((row) => row.label === "post-process")?.savingMs, 4);
    // The bypass is a state the shell reads while drawing, so it has to be seen
    // set during the run and clear after it.
    assert.equal(withPipeline.bypassSeen, true);
    assert.equal(withPipeline.session.bypassPostProcess, false);

    const withoutPipeline = harness({ sources: ["foliage"] });
    withoutPipeline.session.enable();
    const plain = runToCompletion(withoutPipeline);
    assert.equal(plain?.kind, "done");
    const plainRows = (plain as { sweep: { rows: { label: string }[] } }).sweep.rows;
    assert.equal(plainRows.some((row) => row.label === "post-process"), false);
    assert.equal(withoutPipeline.bypassSeen, false);
  });

  check("switching timing off mid-run restores the scene and reports nothing", () => {
    const app = harness({ sources: ["foliage", "static-mesh"] });
    app.session.enable();
    let reported = false;
    app.session.start(() => {
      reported = true;
    });
    // Driven until a step is actually switched off — that hidden content is the
    // state that must not survive somebody closing the panel.
    for (let frame = 0; frame < 40 && app.children.every((child) => child.visible); frame += 1) {
      app.frame();
    }
    assert.equal(app.children.some((child) => !child.visible), true);
    app.session.disable();
    assert.deepEqual(app.children.map((child) => child.visible), [true, true]);
    assert.equal(app.shadowMap.autoUpdate, true);
    assert.equal(app.releases, 1);
    // No table: whoever switched the overlay off is not waiting for one.
    assert.equal(reported, false);
    assert.equal(app.session.frameStats(), null);
  });

  check("only ordinary frames feed the rolling GPU readout", () => {
    const app = harness({ sources: ["foliage", "static-mesh"] });
    app.session.enable();
    // Nothing measured yet reads as `null`, never as 0 ms.
    assert.equal(app.session.frameStats(), null);
    for (let frame = 0; frame < 3; frame += 1) app.frame();
    const before = app.session.frameStats();
    // Two children at 2 ms plus the 3 ms shadow pass.
    assert.equal(before?.samples, 3);
    assert.equal(before?.averageMs, 7);
    assert.equal(runToCompletion(app)?.kind, "done");
    // Every sweep frame is tagged, so a deliberately crippled frame can never
    // drag the continuous readout around.
    assert.equal(app.session.frameStats()?.samples, 3);
    assert.equal(app.session.frameStats()?.averageMs, 7);
  });
}
