import type { EngineUpdateContext, Subsystem } from "./Subsystem";
import type { SubsystemTimingRecorder } from "./subsystemProfiler";

/**
 * The frame region the whole subsystem block is measured as. Its children are
 * the individual subsystems, so the group's residual is the registry's own
 * overhead — the loop, the map walk, the timing calls themselves.
 */
export const ENGINE_REGION_ID = "engine";

export class SubsystemRegistry {
  private readonly subsystems = new Map<string, Subsystem>();
  /** When set (only under `?debug`), each subsystem's `update()` is timed. */
  private profiler: SubsystemTimingRecorder | null = null;
  private now: () => number = defaultNow;

  register(subsystem: Subsystem): Subsystem {
    if (this.subsystems.has(subsystem.id)) {
      throw new Error(`Subsystem already registered: ${subsystem.id}`);
    }
    this.subsystems.set(subsystem.id, subsystem);
    // A module can register after profiling was switched on (a capability
    // attaching mid-session); declare it now or it reads as a top-level region
    // and gets counted twice against the frame.
    this.profiler?.declareRegion?.({ id: subsystem.id, parent: ENGINE_REGION_ID });
    return subsystem;
  }

  has(id: string): boolean {
    return this.subsystems.has(id);
  }

  get<TSubsystem extends Subsystem = Subsystem>(id: string): TSubsystem | null {
    return (this.subsystems.get(id) as TSubsystem | undefined) ?? null;
  }

  require<TSubsystem extends Subsystem = Subsystem>(id: string): TSubsystem {
    const subsystem = this.get<TSubsystem>(id);
    if (!subsystem) throw new Error(`Subsystem not registered: ${id}`);
    return subsystem;
  }

  list(): readonly Subsystem[] {
    return [...this.subsystems.values()];
  }

  async init(): Promise<void> {
    for (const subsystem of this.subsystems.values()) {
      await subsystem.init?.();
    }
  }

  async start(): Promise<void> {
    for (const subsystem of this.subsystems.values()) {
      await subsystem.start?.();
    }
  }

  /**
   * Attaches (or clears) a timing recorder. With no recorder the update loop
   * keeps its plain, un-timed path so production pays nothing; with one, each
   * subsystem's `update()` is wrapped in a `now()` measurement. The `now` clock
   * is injectable so the wiring is deterministic in headless tests.
   */
  setProfiler(profiler: SubsystemTimingRecorder | null, now?: () => number): void {
    this.profiler = profiler;
    if (now) this.now = now;
    if (profiler?.declareRegion) {
      profiler.declareRegion({ id: ENGINE_REGION_ID });
      for (const id of this.subsystems.keys()) {
        profiler.declareRegion({ id, parent: ENGINE_REGION_ID });
      }
    }
  }

  update(context: EngineUpdateContext): void {
    const { profiler } = this;
    if (!profiler) {
      for (const subsystem of this.subsystems.values()) {
        subsystem.update?.(context);
      }
      return;
    }
    const now = this.now;
    const blockStart = now();
    for (const subsystem of this.subsystems.values()) {
      if (!subsystem.update) continue;
      const start = now();
      subsystem.update(context);
      profiler.record(subsystem.id, now() - start);
    }
    // The block as a whole, so its residual reports what the registry itself
    // costs on top of the subsystems it runs.
    profiler.record(ENGINE_REGION_ID, now() - blockStart);
    // No endFrame() here: the subsystem block is one region of the frame, not
    // the end of it. Everything the shell does afterwards — game modes, UI,
    // the environment, the render submit — happens after this returns, and
    // closing the frame here is what used to make all of it invisible.
  }

  async dispose(): Promise<void> {
    const ordered = [...this.subsystems.values()];
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      await ordered[index]?.dispose?.();
    }
  }
}

/** High-resolution clock when available, else a millisecond fallback. */
function defaultNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
