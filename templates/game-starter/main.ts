/**
 * game-starter: the smallest complete Forge game (Phase H).
 *
 * This file is the *entire* application. There is no scene setup here — no
 * lights, no materials, no terrain wiring, no render loop of its own — because
 * building a level's content is the platform's job (Layer 1) and the opt-in
 * capabilities cover the general runtime behavior (Layer 2). A game supplies
 * only what is actually its own: its rules, as a `ForgeGameModule` (Layer 3).
 * This starter has none yet, which is the point — it renders a full level with
 * zero gameplay code, and a fork grows from here without editing the runtime.
 *
 * To use it: copy the Forge template, replace `src/main.ts` with this file,
 * drop `main.level.json` into `public/layouts/`, and point
 * `public/project.3dgame.json` → `editor.defaultScene` at it.
 *
 * When the game does get rules, they plug in without touching anything else:
 *
 * ```ts
 * const forge = await createForgeRuntime({
 *   canvas,
 *   modules: createDefaultRuntimeModules(),
 *   gameModules: [createMyGameModule()],
 * });
 * ```
 */
import { attachDebugStats } from "@/scene/debugStats";
import { createDefaultRuntimeModules } from "@/scene/capabilities/defaultRuntimeModules";
import { createForgeRuntime } from "@/scene/ForgeRuntime";

/** Public-root relative path of the level this starter opens. */
const STARTER_LEVEL = "layouts/main.level.json";

async function main(): Promise<void> {
  const canvas = document.getElementById("game-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Missing required element: #game-canvas");
  }

  // Layer 2: every general capability the template ships with. A game that does
  // not need one (a top-down strategy game has no character movement) drops it
  // from this list — the level's scene content is unaffected either way.
  const forge = await createForgeRuntime({
    canvas,
    modules: createDefaultRuntimeModules(),
  });

  // Diagnostics, not scene setup: the perf overlay behind `?debug` (fps, draw
  // calls, capability state). Drop these three lines and the game still runs.
  if (new URLSearchParams(location.search).has("debug")) {
    const host = document.getElementById("debug-stats");
    if (host instanceof HTMLElement) attachDebugStats(forge.app, host);
  }

  // The level this starter ships (`main.level.json`, copied into
  // `public/layouts/`). Call `loadLevel()` with no argument instead to open
  // whatever the project manifest names as `editor.defaultScene`.
  await forge.loadLevel(STARTER_LEVEL);
  forge.start();
}

void main();
