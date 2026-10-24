export type AssetResidencyState = "loading" | "resident" | "failed" | "pending-evict";

export interface AssetResidencyHooks {
  /** Resolves when usable; rejection or a synchronous throw marks the asset failed. */
  load(id: string): Promise<void>;
  /** Frees an unowned asset whose load succeeded. */
  evict(id: string): void;
}

export interface AssetResidencyOptions {
  evictDelayMs: number;
  now(): number;
}

export interface AssetResidencySnapshot {
  owners: number;
  loading: number;
  resident: number;
  pendingEvict: number;
  failed: number;
}

interface AssetEntry {
  owners: Set<string>;
  state: AssetResidencyState;
  token: symbol;
  deadline?: number;
}

interface ReadyWaiter {
  owners: string[];
  resolve(): void;
}

export class AssetResidency {
  private readonly entries = new Map<string, AssetEntry>();
  private readonly owners = new Map<string, Set<string>>();
  private readonly waiters = new Set<ReadyWaiter>();

  constructor(private readonly hooks: AssetResidencyHooks, private readonly options: AssetResidencyOptions) {
    if (!Number.isFinite(options.evictDelayMs) || options.evictDelayMs < 0) {
      throw new RangeError("evictDelayMs must be finite and nonnegative");
    }
  }

  /** Replaces the owner's ids; an empty set releases the owner. */
  setOwner(owner: string, ids: Iterable<string>): void {
    const next = new Set(ids);
    if (!next.size) {
      this.releaseOwner(owner);
      return;
    }
    const previous = this.owners.get(owner) ?? new Set<string>();
    this.owners.set(owner, next);
    for (const id of next) {
      if (previous.has(id)) continue;
      const entry = this.entries.get(id);
      if (entry) {
        entry.owners.add(owner);
        if (entry.state === "pending-evict") {
          entry.state = "resident";
          delete entry.deadline;
        }
      } else {
        const token = Symbol();
        this.entries.set(id, { owners: new Set([owner]), state: "loading", token });
        try {
          this.hooks.load(id).then(() => this.settle(id, token, true), () => this.settle(id, token, false));
        } catch {
          this.settle(id, token, false);
        }
      }
    }
    for (const id of previous) if (!next.has(id)) this.release(id, owner);
    this.checkWaiters();
  }

  releaseOwner(owner: string): void {
    const ids = this.owners.get(owner);
    this.owners.delete(owner);
    if (ids) for (const id of ids) this.release(id, owner);
    this.checkWaiters();
  }

  /** Teardown releases ownership but keeps the eviction delay for cross-level reuse. */
  releaseAll(): void {
    for (const owner of this.owners.keys()) this.releaseOwner(owner);
  }

  isOwnerReady(owner: string): boolean {
    for (const id of this.owners.get(owner) ?? []) {
      const state = this.entries.get(id)?.state;
      if (state !== "resident" && state !== "failed") return false;
    }
    return true;
  }

  /** Released and unknown owners count as ready; load failures never reject this wait. */
  whenReady(owners: Iterable<string>): Promise<void> {
    const listed = [...owners];
    if (listed.every((owner) => this.isOwnerReady(owner))) return Promise.resolve();
    return new Promise((resolve) => this.waiters.add({ owners: listed, resolve }));
  }

  state(id: string): AssetResidencyState | undefined {
    return this.entries.get(id)?.state;
  }

  update(): void {
    const now = this.options.now();
    for (const [id, entry] of this.entries) {
      if (entry.state !== "pending-evict" || !(now >= entry.deadline!)) continue;
      this.hooks.evict(id);
      this.entries.delete(id);
    }
  }

  snapshot(): AssetResidencySnapshot {
    const snapshot = { owners: this.owners.size, loading: 0, resident: 0, pendingEvict: 0, failed: 0 };
    for (const entry of this.entries.values()) {
      if (entry.state === "pending-evict") snapshot.pendingEvict += 1;
      else snapshot[entry.state] += 1;
    }
    return snapshot;
  }

  private release(id: string, owner: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.owners.delete(owner);
    if (entry.owners.size) return;
    if (entry.state === "resident") {
      entry.state = "pending-evict";
      entry.deadline = this.options.now() + this.options.evictDelayMs;
    } else if (entry.state === "failed") {
      this.entries.delete(id);
    }
  }

  private settle(id: string, token: symbol, succeeded: boolean): void {
    const entry = this.entries.get(id);
    if (!entry || entry.token !== token || entry.state !== "loading") return;
    if (entry.owners.size) {
      entry.state = succeeded ? "resident" : "failed";
    } else if (succeeded) {
      entry.state = "pending-evict";
      entry.deadline = this.options.now() + this.options.evictDelayMs;
    } else {
      this.entries.delete(id);
    }
    this.checkWaiters();
  }

  private checkWaiters(): void {
    for (const waiter of this.waiters) {
      if (!waiter.owners.every((owner) => this.isOwnerReady(owner))) continue;
      this.waiters.delete(waiter);
      waiter.resolve();
    }
  }
}
