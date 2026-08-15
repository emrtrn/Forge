/**
 * Ordered, failure-isolating owner of the registered Layer 2 capability modules.
 *
 * Lifecycle order is part of the contract: setup hooks (`onLevelLoaded`,
 * `update`) run in registration order so a later module can depend on an
 * earlier one, and teardown hooks (`onLevelUnloaded`, `dispose`) run in reverse
 * so dependencies outlive their dependents.
 *
 * A module that throws is quarantined instead of taking the runtime down with
 * it: the level still boots, the remaining modules still run, and the failure
 * is reported once rather than every frame (I6 — the template must keep
 * booting). Quarantine is cleared on the next level load, so a module that
 * failed on one level gets a clean chance on the next.
 */
import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeContext } from "./RuntimeContext";
import type { RuntimeServices } from "./RuntimeServices";

type Hook = "onRuntimeStart" | "onLevelLoaded" | "onLevelUnloaded" | "update" | "dispose";

export class CapabilityRegistry {
  private readonly modules: CapabilityModule[] = [];
  private readonly byId = new Map<string, CapabilityModule>();
  /** Ids of modules skipped for the rest of the level after a hook threw. */
  private readonly quarantined = new Set<string>();
  /**
   * Ids of modules whose `onRuntimeStart` threw. Unlike per-level quarantine
   * this is permanent: a module that never finished attaching (its subsystems
   * were never queued) cannot be given "another chance" on the next level.
   */
  private readonly startFailed = new Set<string>();
  private disposed = false;

  get size(): number {
    return this.modules.length;
  }

  /** Registered module ids, in registration order. */
  ids(): readonly string[] {
    return this.modules.map((module) => module.id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): CapabilityModule | undefined {
    return this.byId.get(id);
  }

  /**
   * Adds a module. Duplicate ids throw rather than silently replacing: the
   * registry is built at a composition root, so a collision is a wiring bug and
   * a silently dropped capability is exactly the failure mode this plan removes.
   */
  register(module: CapabilityModule): this {
    if (this.disposed) throw new Error("Cannot register a capability module on a disposed registry.");
    if (this.byId.has(module.id)) {
      throw new Error(`Duplicate capability module id: "${module.id}".`);
    }
    this.byId.set(module.id, module);
    this.modules.push(module);
    return this;
  }

  /**
   * Attaches every module to the runtime shell, in registration order: this is
   * where modules create and queue their subsystems and publish their services.
   * Runs once, during shell construction, before any level is built.
   */
  runtimeStart(services: RuntimeServices): void {
    for (const module of this.modules) {
      if (!module.onRuntimeStart) continue;
      try {
        module.onRuntimeStart(services);
      } catch (error) {
        this.startFailed.add(module.id);
        this.quarantine(module, "onRuntimeStart", error);
      }
    }
  }

  /** Feeds the built level to every module, in registration order. */
  async levelLoaded(context: RuntimeContext): Promise<void> {
    this.quarantined.clear();
    for (const id of this.startFailed) this.quarantined.add(id);
    for (const module of this.modules) {
      if (!module.onLevelLoaded || this.quarantined.has(module.id)) continue;
      try {
        await module.onLevelLoaded(context);
      } catch (error) {
        this.quarantine(module, "onLevelLoaded", error);
      }
    }
  }

  /** Drops per-level module state before a Level Travel rebuild (reverse order). */
  levelUnloaded(): void {
    this.forEachReversed("onLevelUnloaded", (module) => {
      if (this.startFailed.has(module.id)) return;
      module.onLevelUnloaded?.();
    });
  }

  update(deltaSeconds: number): void {
    for (const module of this.modules) {
      if (!module.update || this.quarantined.has(module.id)) continue;
      try {
        module.update(deltaSeconds);
      } catch (error) {
        this.quarantine(module, "update", error);
      }
    }
  }

  /** Tears every module down (reverse order) and blocks further registration. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.forEachReversed("dispose", (module) => module.dispose?.());
  }

  private forEachReversed(hook: Hook, run: (module: CapabilityModule) => void): void {
    for (let index = this.modules.length - 1; index >= 0; index -= 1) {
      const module = this.modules[index];
      if (!module) continue;
      try {
        run(module);
      } catch (error) {
        this.quarantine(module, hook, error);
      }
    }
  }

  private quarantine(module: CapabilityModule, hook: Hook, error: unknown): void {
    if (!this.quarantined.has(module.id)) {
      console.error(`[capabilities] module "${module.id}" failed in ${hook}:`, error);
    }
    this.quarantined.add(module.id);
  }
}

/** Builds a registry from an ordered module set (the fork's opt-in list). */
export function createCapabilityRegistry(
  modules: Iterable<CapabilityModule> = [],
): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  for (const module of modules) registry.register(module);
  return registry;
}
