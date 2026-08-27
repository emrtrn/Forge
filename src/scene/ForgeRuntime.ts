/**
 * The Layer 3 composition API: how a fork builds a Forge runtime.
 *
 * ```ts
 * const forge = await createForgeRuntime({ canvas, modules: createDefaultRuntimeModules() });
 * forge.use(createDemoGameModule());
 * await forge.loadLevel();       // project default scene, or an explicit path
 * forge.start();
 * ```
 *
 * The factory owns the composition order the layered runtime depends on:
 * Layer 2 capabilities are chosen when the shell is constructed, the Layer 3
 * game module registers before any level exists, and only then is a level
 * built. A fork therefore never edits `RuntimeSceneApp` to add its game (I4) —
 * it passes a different module list and a different game module here.
 *
 * For now the factory wraps the runtime shell rather than replacing it (plan
 * §8): the shell keeps owning Layer 0/1, and every phase that moves more of it
 * behind a module is invisible to this API.
 */
import type { CapabilityModule } from "./capabilities/CapabilityModule";
import type { ForgeGameModule } from "./ForgeGameModule";
import { RuntimeSceneApp } from "./RuntimeSceneApp";
import type { QualityExtensions } from "@engine/perf/qualityProfiles";

export interface ForgeRuntimeOptions {
  /** The canvas the runtime renders into. */
  readonly canvas: HTMLCanvasElement;
  /** Opt-in Layer 2 capability modules, in registration order. */
  readonly modules?: readonly CapabilityModule[];
  /**
   * Layer 3 game modules to register while the runtime is composed — before the
   * capabilities attach, so a module here may publish services a Layer 2 module
   * reads as it starts (the AI task vocabulary). {@link ForgeRuntime.use} adds
   * modules afterwards; those are visible from the first level build onwards.
   */
  readonly gameModules?: readonly ForgeGameModule[];
  /** `?debug`: boot/travel timing logs + per-subsystem profiling. */
  readonly debug?: boolean;
  /** Retained script-message trace depth (dev overlay); 0 disables tracing. */
  readonly scriptMessageTraceLimit?: number;
  /** Fork-owned content-quality settings (never authored layout data). */
  readonly qualityExtensions?: QualityExtensions;
  /** Fork override for asynchronous runtime-actor spawn dispatch. */
  readonly spawnBudgetPerFrame?: number;
}

export interface ForgeRuntime {
  /**
   * The runtime shell. Exposed for the host page's own wiring (the `?debug`
   * overlay reads its stats), not as an invitation for a game to reach into it:
   * game code talks to the runtime through its module hooks and services.
   */
  readonly app: RuntimeSceneApp;
  /** Registers a Layer 3 game module. Call before the first `loadLevel`. */
  use(module: ForgeGameModule): ForgeRuntime;
  /** Builds a level: an explicit public-root path, or the project default. */
  loadLevel(levelPath?: string): Promise<void>;
  /** Starts the frame loop (and every registered game module). */
  start(): void;
  /** Tears the runtime down: Layer 3, then Layer 2, then the shell. */
  dispose(): void;
}

/**
 * Composes a runtime. Async by contract — a fork awaits it — so later phases can
 * move asynchronous setup (a project manifest, a module's preload) in front of
 * the first level without changing a single call site.
 */
export async function createForgeRuntime(options: ForgeRuntimeOptions): Promise<ForgeRuntime> {
  const app = new RuntimeSceneApp(options.canvas, {
    // The factory drives the level explicitly, so the shell must not race ahead
    // and build one before the game module has registered.
    autoLoadLevel: false,
    ...(options.modules ? { capabilities: options.modules } : {}),
    ...(options.gameModules ? { gameModules: options.gameModules } : {}),
    ...(options.debug !== undefined ? { debug: options.debug } : {}),
    ...(options.scriptMessageTraceLimit !== undefined
      ? { scriptMessageTraceLimit: options.scriptMessageTraceLimit }
      : {}),
    ...(options.qualityExtensions ? { qualityExtensions: options.qualityExtensions } : {}),
    ...(options.spawnBudgetPerFrame !== undefined
      ? { spawnBudgetPerFrame: options.spawnBudgetPerFrame }
      : {}),
  });

  const runtime: ForgeRuntime = {
    app,
    use(module) {
      app.useGameModule(module);
      return runtime;
    },
    loadLevel(levelPath) {
      return app.loadLevel(levelPath);
    },
    start() {
      app.start();
    },
    dispose() {
      app.dispose();
    },
  };
  return runtime;
}
