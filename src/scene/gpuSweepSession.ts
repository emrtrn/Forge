/**
 * The shell-side half of the GPU A/B sweep: the timer queries, the step plan
 * built from the live scene, and the per-frame bookkeeping that feeds
 * {@link GpuSweepRunner}.
 *
 * It exists as its own module because two shells need it and neither should own
 * it. The runtime (`RuntimeSceneApp`) asks the question while playing; the
 * editor viewport (`SceneApp`) asks it while authoring — "is what I just placed
 * what this frame is paying for?" is an authoring question first. Copying a
 * hundred lines of query tagging and scene restoration into the second shell is
 * how the two quietly stop measuring the same thing.
 *
 * The division of labour is the one the plan's principle #6 states: the runner
 * (pure, engine-side) decides *when* to measure, this class decides *what* to
 * switch off, and the shell only says when its frame begins and ends.
 */
import type { Object3D, Scene, WebGLRenderer } from "three";

import { GpuSweepRunner, type GpuSweepOutcome } from "@engine/perf/gpuSweepRunner";
import {
  GpuFrameTimer,
  type GpuFrameSample,
  type GpuFrameStats,
  type GpuTimerContext,
} from "@engine/perf/gpuTimer";

import { sceneSourceOf, type SceneCostObject } from "./runtimeDebugSnapshot";

/**
 * Content categories the sweep will measure separately before the rest are
 * merged into one. A cap, because the sweep costs roughly twenty frames per
 * step and an untagged scene can produce a bucket per loose mesh.
 */
const GPU_SWEEP_MAX_CATEGORIES = 8;
/** Synthetic steps: not scene content, but the two biggest per-frame passes. */
const GPU_SWEEP_SHADOW_ID = "shadow map";
const GPU_SWEEP_POST_ID = "post-process";

/**
 * One entry of the sweep plan: a label, and how to switch that content out of
 * the frame and back in. The runner never sees the toggle — it schedules ids and
 * this class owns the scene, which is what keeps the scheduler unit-testable.
 */
interface GpuSweepStep {
  readonly id: string;
  readonly apply: (off: boolean) => void;
}

export interface GpuSweepSessionOptions {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  /** Draw calls + triangles of the frame just drawn; recorded with the sweep. */
  readonly renderStats: () => { drawCalls: number; triangles: number };
  /** Engine clock at the end of the run, so a table says when it was taken. */
  readonly sceneSeconds: () => number;
  /** Whether this shell is drawing through a post-process pipeline right now. */
  readonly postProcessActive?: () => boolean;
  /**
   * Optional hold on the simulation for the length of the run. The runtime
   * takes its own pause holder here; the editor viewport has no time control
   * and passes nothing — gameplay is already switched off while authoring, and
   * the bracketed baseline is what catches whatever does still drift.
   */
  readonly hold?: () => void;
  readonly release?: () => void;
}

/**
 * Narrows the renderer's context to the timer-query slice, or `null` on a WebGL1
 * context (which has no queries at all). A cast would compile and then throw on
 * the first `createQuery`; the feature test is the honest form, and the timer's
 * own `create` already treats `null` as "no GPU timing available".
 */
function asGpuTimerContext(gl: unknown): GpuTimerContext | null {
  const candidate = gl as Partial<GpuTimerContext> | null;
  return candidate && typeof candidate.createQuery === "function" ? (gl as GpuTimerContext) : null;
}

export class GpuSweepSession {
  /**
   * GPU-side frame timing, created only while somebody is reading the overlay
   * and only where the browser exposes timer queries — so it stays `null` on a
   * shipping frame and on Safari. The CPU profiler says how long issuing the
   * frame took; this says how long executing it took, and only the two together
   * name the bound.
   */
  private timer: GpuFrameTimer | null = null;
  /** The sweep in progress, or null. See {@link start}. */
  private runner: GpuSweepRunner | null = null;
  /** Its step plan: how to turn each measured category off and back on. */
  private plan: readonly GpuSweepStep[] = [];
  private consume: ((outcome: GpuSweepOutcome) => void) | null = null;
  /** Which plan entry is currently switched off, so it can be switched back. */
  private applied: number | null = null;
  /** Last seen disjoint tally, to notice a *new* one rather than a total. */
  private disjointSeen = 0;
  /** Set by the sweep's post-process step: draw straight, skipping the pipeline. */
  private bypassPost = false;

  constructor(private readonly options: GpuSweepSessionOptions) {}

  /** True while the sweep's post-process step wants the pipeline skipped. */
  get bypassPostProcess(): boolean {
    return this.bypassPost;
  }

  /**
   * Starts issuing timer queries. Idempotent, and inert where the extension is
   * withheld — {@link frameStats} then keeps reporting `null`, and a sweep asked
   * for anyway reports why rather than a table of zeros.
   *
   * Gated by the caller rather than always on, because timer queries cost a
   * driver round trip per frame: they exist only while somebody is reading.
   */
  enable(): void {
    if (this.timer) return;
    this.timer = GpuFrameTimer.create(asGpuTimerContext(this.options.renderer.getContext()));
  }

  /**
   * Stops timing and releases the queries. A sweep still running is abandoned
   * silently — the scene is put back, but no table is produced: whoever just
   * switched the overlay off is not waiting for one.
   */
  disable(): void {
    this.abort();
    this.timer?.dispose();
    this.timer = null;
  }

  /**
   * Windowed GPU frame time, or `null` when nothing is measuring it. Never a
   * zero, because "the GPU cost nothing" and "nobody measured the GPU" must not
   * read alike.
   */
  frameStats(): GpuFrameStats | null {
    const stats = this.timer?.stats();
    return stats && stats.samples > 0 ? stats : null;
  }

  /**
   * Called immediately before the shell draws: puts the scene into the
   * configuration the next frame belongs to and opens the query for it.
   *
   * Tag 0 stays reserved for ordinary frames, so the rolling `gpu` readout is
   * never fed a deliberately crippled frame.
   */
  beginFrame(): void {
    const step = this.runner?.currentStep() ?? null;
    this.applyStep(step?.planIndex ?? null);
    this.timer?.begin(step?.tag ?? 0);
  }

  /** Called immediately after the draw: closes the query and collects results. */
  endFrame(): void {
    if (!this.timer) return;
    this.timer.end();
    const samples = this.timer.poll();
    if (this.runner) this.advance(samples);
  }

  /**
   * Starts the sweep: turns each content category off in turn, with an
   * untouched frame measured either side of every step, and reports what each
   * one gives back.
   *
   * Reports `failed` rather than an empty table when there is no GPU timer:
   * a table of zeros would read as `nothing costs anything`, which is a wrong
   * answer wearing the clothes of a right one.
   */
  start(consume: (outcome: GpuSweepOutcome) => void): void {
    if (this.runner) return;
    if (!this.timer) {
      consume({ kind: "failed", reason: "This browser has no GPU timer queries." });
      return;
    }
    this.plan = this.buildPlan();
    if (this.plan.length === 0) {
      consume({ kind: "failed", reason: "Nothing in this scene to turn off." });
      return;
    }
    this.consume = consume;
    this.disjointSeen = this.timer.disjointCount;
    this.runner = new GpuSweepRunner(this.plan.map(({ id }) => ({ id })));
    this.options.hold?.();
  }

  dispose(): void {
    this.disable();
  }

  /**
   * The sweep's step plan, derived from the scene rather than from a table.
   *
   * Content categories come from the same `forgeSceneSource` tags the shadow
   * inventory buckets by, so a fork that adds a content kind gets a sweep row
   * for it by tagging it and nothing else. The tail is merged into one `other`
   * row: the sweep costs roughly twenty frames per step, and an untagged scene
   * can otherwise produce a bucket per loose mesh.
   *
   * Then two passes that are not content at all but are usually the largest
   * single things in the frame.
   */
  private buildPlan(): GpuSweepStep[] {
    const { scene, renderer, postProcessActive } = this.options;
    const bySource = new Map<string, Object3D[]>();
    for (const child of scene.children) {
      // Already hidden: turning it off would measure nothing and spend twenty
      // frames doing it.
      if (!child.visible) continue;
      const source = sceneSourceOf(
        child as unknown as SceneCostObject,
        scene as unknown as SceneCostObject,
      );
      const bucket = bySource.get(source);
      if (bucket) bucket.push(child);
      else bySource.set(source, [child]);
    }
    const ranked = [...bySource.entries()].sort((a, b) => b[1].length - a[1].length);
    const kept = ranked.slice(0, GPU_SWEEP_MAX_CATEGORIES);
    const rest = ranked.slice(GPU_SWEEP_MAX_CATEGORIES).flatMap(([, objects]) => objects);
    const steps: GpuSweepStep[] = kept.map(([id, objects]) => ({
      id,
      apply: (off: boolean) => {
        for (const object of objects) object.visible = !off;
      },
    }));
    if (rest.length > 0) {
      steps.push({
        id: "other",
        apply: (off: boolean) => {
          for (const object of rest) object.visible = !off;
        },
      });
    }
    steps.push({
      id: GPU_SWEEP_SHADOW_ID,
      // Frozen, not disabled. Flipping `shadowMap.enabled` recompiles every
      // material that samples a shadow, and that compile lands inside the frame
      // being measured — where it would be read as the cost of shadows.
      // Freezing `autoUpdate` skips the shadow depth pass instead, which is the
      // per-frame cost this row is asking about.
      apply: (off: boolean) => {
        renderer.shadowMap.autoUpdate = !off;
      },
    });
    if (postProcessActive?.()) {
      steps.push({
        id: GPU_SWEEP_POST_ID,
        apply: (off: boolean) => {
          this.bypassPost = off;
        },
      });
    }
    return steps;
  }

  /** Switches the scene into the configuration one step wants, and back out. */
  private applyStep(planIndex: number | null): void {
    if (this.applied === planIndex) return;
    if (this.applied !== null) this.plan[this.applied]?.apply(false);
    this.applied = planIndex;
    if (planIndex !== null) this.plan[planIndex]?.apply(true);
  }

  /** Feeds one frame's tagged GPU results into the sweep and advances it. */
  private advance(samples: readonly GpuFrameSample[]): void {
    const runner = this.runner;
    if (!runner) return;
    for (const sample of samples) {
      if (sample.tag !== 0) runner.acceptSample(sample.tag, sample.ms);
    }
    const disjoint = this.timer?.disjointCount ?? 0;
    if (disjoint > this.disjointSeen) {
      this.disjointSeen = disjoint;
      runner.noteDisjoint();
    }
    runner.noteFrame();
    const stats = this.options.renderStats();
    const outcome = runner.advance({
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
      sceneSeconds: this.options.sceneSeconds(),
    });
    if (outcome.kind === "running") return;
    const consume = this.finish();
    consume?.(outcome);
  }

  /** Restores the scene and drops the run without reporting it. */
  private abort(): void {
    if (this.runner) this.finish();
  }

  /**
   * Puts the scene back exactly as it was found, releases only this run's hold,
   * and hands back the consumer so the caller decides whether to report.
   */
  private finish(): ((outcome: GpuSweepOutcome) => void) | null {
    this.applyStep(null);
    this.bypassPost = false;
    this.options.renderer.shadowMap.autoUpdate = true;
    this.runner = null;
    this.plan = [];
    this.options.release?.();
    const consume = this.consume;
    this.consume = null;
    return consume;
  }
}
