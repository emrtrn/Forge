/**
 * Layer 2 of the layered runtime: an opt-in capability.
 *
 * A capability module owns one general runtime behavior (dialogue, save-game,
 * character movement, runtime UI, AI…) that a fork may switch off without
 * losing any Layer 1 scene content. Every hook is optional, so a module only
 * declares the parts of the lifecycle it actually uses.
 *
 * Modules must not import `@/game` or the editor: game rules belong to Layer 3
 * (`ForgeGameModule`), authoring belongs to the editor shell.
 */
import type { RuntimeContext } from "./RuntimeContext";

export interface CapabilityModule {
  /**
   * Stable identifier, unique within one registry. Used for opt-out sets,
   * diagnostics, and the quarantine log when a hook throws.
   */
  readonly id: string;

  /**
   * Runs after the LevelRuntime pipeline has built the level's scene content.
   * May be async; the registry awaits each module in registration order so a
   * module can rely on the modules registered before it being ready.
   */
  onLevelLoaded?(context: RuntimeContext): void | Promise<void>;

  /**
   * Runs when the current level is torn down (Level Travel) but the runtime
   * keeps living. Modules drop per-level state here and keep per-session state.
   */
  onLevelUnloaded?(): void;

  /** Per-frame tick, in seconds, with the same clamped delta the engine uses. */
  update?(deltaSeconds: number): void;

  /** Runs once when the owning runtime shuts down. */
  dispose?(): void;
}
