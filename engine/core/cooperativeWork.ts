export interface WorkSlice { phase: string; milliseconds: number }
export interface CooperativeOptions {
  signal?: AbortSignal | undefined;
  onSlice?: ((slice: WorkSlice) => void) | undefined;
  now?: () => number;
  yieldTask?: () => Promise<void>;
  budgetMs?: number;
}

/** CPU generators yield after bounded batches. Every phase starts in a new
 * task, so an already-resolved Promise cannot join several phases into one
 * long microtask chain. The target is cooperative, not a real-time guarantee.
 */
export class CooperativeWork {
  private readonly now: () => number;
  private readonly yieldTask: () => Promise<void>;
  constructor(private readonly options: CooperativeOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.yieldTask = options.yieldTask ?? (() => {
      // Feature detection keeps older browsers/Node usable. Native scheduler
      // continuations avoid the nested setTimeout 4 ms clamp on large builds.
      const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
      return scheduler?.yield ? scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
    });
  }
  check(): void { this.options.signal?.throwIfAborted(); }
  async run<T>(phase: string, steps: Generator<void, T>): Promise<T> {
    const budget = this.options.budgetMs ?? 2;
    try {
      this.check(); await this.yieldTask(); this.check();
      let started = this.now();
      for (;;) {
        this.check();
        const step = steps.next(), elapsed = this.now() - started;
        if (step.done || elapsed >= budget) {
          this.options.onSlice?.({ phase, milliseconds: elapsed });
          if (step.done) return step.value;
          await this.yieldTask(); this.check(); started = this.now();
        }
      }
    } finally { steps.return(undefined as never); }
  }
}

/** The exact same algorithm remains available to synchronous engine callers. */
export function finishWork<T>(steps: Generator<void, T>): T {
  for (;;) { const step = steps.next(); if (step.done) return step.value; }
}
