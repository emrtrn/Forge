/**
 * Layer 3 of the layered runtime: the game module a fork plugs in.
 *
 * Where a {@link CapabilityModule} owns one *general* runtime behavior (Layer 2:
 * dialogue, save-game, AI…), a game module owns the rules of one *specific*
 * game: which Game Mode runs, what its HUD does, how its win/loss state is
 * evaluated. Forge's own template registers a demo game module; a fork replaces
 * it without editing the runtime shell (I4).
 *
 * Lifecycle, in the order the shell drives it:
 *   register(runtime)   once, while the runtime is being composed — before any
 *                       level exists, so the module can publish the services the
 *                       shell and the capabilities resolve during a level build.
 *   onLevelLoaded(ctx)  after Layer 1 content and *after* every Layer 2 module,
 *                       so game rules read a level whose capabilities are ready.
 *   start()             once, when the runtime's frame loop starts.
 *   update(dt)          per frame, after the Layer 2 tick and the Game Mode.
 *   onLevelUnloaded()   per Level Travel teardown (before Layer 2 unloads).
 *   dispose()           once, when the runtime shuts down.
 *
 * Every hook is optional: a module declares only the parts it uses.
 */
import type { PerspectiveCamera, Scene } from "three";

import type { RuntimeContext } from "./capabilities/RuntimeContext";
import type { RuntimeServices } from "./capabilities/RuntimeServices";

/**
 * The narrow view of the runtime a game module gets at registration time.
 *
 * `services` is the same container the capability modules attach to, so Layer 3
 * publishes and resolves through exactly one mechanism: a game module provides
 * its game-specific services here (and may queue its own subsystems into a tick
 * slot), while the shell and the capabilities resolve them without ever
 * importing the game.
 */
export interface ForgeRuntimeHandle {
  readonly services: RuntimeServices;
  /** The runtime's scene graph, for game-owned objects that outlive a level. */
  readonly scene: Scene;
  /** The runtime camera the Game Mode drives. */
  readonly camera: PerspectiveCamera;
}

export interface ForgeGameModule {
  /** Stable identifier, unique within one runtime. Used in diagnostics. */
  readonly id: string;

  /** Runs once while the runtime is composed, before any level exists. */
  register?(runtime: ForgeRuntimeHandle): void;

  /** Runs after Layer 1 content and every Layer 2 module for the built level. */
  onLevelLoaded?(context: RuntimeContext): void | Promise<void>;

  /** Runs when the frame loop starts (after the first level, if one was loaded). */
  start?(): void;

  /** Per-frame tick, in seconds, on the same clamped delta the engine uses. */
  update?(deltaSeconds: number): void;

  /** Runs when the current level is torn down but the runtime keeps living. */
  onLevelUnloaded?(): void;

  /** Runs once when the owning runtime shuts down. */
  dispose?(): void;
}

/**
 * Ordered, failure-isolating owner of a runtime's game modules.
 *
 * Mirrors {@link CapabilityRegistry}'s contract deliberately — registration
 * order for setup, reverse order for teardown, a throwing module quarantined
 * rather than taking the runtime down (I6) — because a fork should not have to
 * learn two lifecycle rules. Quarantine clears on the next level load, except
 * for a module whose `register` threw: it never finished attaching, so it stays
 * out for the whole session.
 */
export interface GameModuleHost {
  /** Registered module ids, in registration order. */
  ids(): readonly string[];
  /**
   * Adds a module and immediately runs its `register` hook. Duplicate ids throw:
   * the composition root is the only caller, so a collision is a wiring bug and
   * a silently dropped game module is exactly the failure this plan removes.
   */
  use(module: ForgeGameModule): void;
  levelLoaded(context: RuntimeContext): Promise<void>;
  levelUnloaded(): void;
  start(): void;
  update(deltaSeconds: number): void;
  dispose(): void;
}

type Hook = "register" | "onLevelLoaded" | "onLevelUnloaded" | "start" | "update" | "dispose";

export function createGameModuleHost(handle: ForgeRuntimeHandle): GameModuleHost {
  const modules: ForgeGameModule[] = [];
  const ids = new Set<string>();
  const quarantined = new Set<string>();
  const registerFailed = new Set<string>();
  let disposed = false;

  const quarantine = (module: ForgeGameModule, hook: Hook, error: unknown): void => {
    if (!quarantined.has(module.id)) {
      console.error(`[game] module "${module.id}" failed in ${hook}:`, error);
    }
    quarantined.add(module.id);
  };

  const forEach = (hook: Hook, run: (module: ForgeGameModule) => void): void => {
    for (const module of modules) {
      if (quarantined.has(module.id)) continue;
      try {
        run(module);
      } catch (error) {
        quarantine(module, hook, error);
      }
    }
  };

  return {
    ids: () => modules.map((module) => module.id),

    use(module) {
      if (disposed) throw new Error("Cannot register a game module on a disposed runtime.");
      if (ids.has(module.id)) throw new Error(`Duplicate game module id: "${module.id}".`);
      ids.add(module.id);
      modules.push(module);
      if (!module.register) return;
      try {
        module.register(handle);
      } catch (error) {
        registerFailed.add(module.id);
        quarantine(module, "register", error);
      }
    },

    async levelLoaded(context) {
      quarantined.clear();
      for (const id of registerFailed) quarantined.add(id);
      for (const module of modules) {
        if (!module.onLevelLoaded || quarantined.has(module.id)) continue;
        try {
          await module.onLevelLoaded(context);
        } catch (error) {
          quarantine(module, "onLevelLoaded", error);
        }
      }
    },

    levelUnloaded() {
      for (let index = modules.length - 1; index >= 0; index -= 1) {
        const module = modules[index];
        if (!module || registerFailed.has(module.id)) continue;
        try {
          module.onLevelUnloaded?.();
        } catch (error) {
          quarantine(module, "onLevelUnloaded", error);
        }
      }
    },

    start() {
      forEach("start", (module) => module.start?.());
    },

    update(deltaSeconds) {
      forEach("update", (module) => module.update?.(deltaSeconds));
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (let index = modules.length - 1; index >= 0; index -= 1) {
        const module = modules[index];
        if (!module) continue;
        try {
          module.dispose?.();
        } catch (error) {
          quarantine(module, "dispose", error);
        }
      }
    },
  };
}
