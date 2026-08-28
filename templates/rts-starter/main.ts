/**
 * rts-starter: the plan's validation case (Phase I).
 *
 * This is the app that used to require writing a whole second runtime shell.
 * A top-down strategy game has no player character, no skeleton, no locomotion
 * animation — and on the pre-plan runtime those were wired unconditionally into
 * the shell, so building an RTS meant bypassing `RuntimeSceneApp` and, with it,
 * losing every piece of scene construction it did: terrain, materials, lights,
 * the environment stack, VFX, collision. Each one had to be re-plumbed by hand.
 *
 * Here that whole problem is two decisions, and no re-plumbing:
 *   1. a *shorter capability list* — the character modules simply left out,
 *   2. a *game module* whose entire content is "my Game Mode is the RTS camera".
 *
 * Everything else is identical to `templates/game-starter`, which is the point:
 * the same `createForgeRuntime` → `loadLevel` → `start`, the same level file,
 * the same LevelRuntime pipeline building it. There is no scene-setup code here
 * either, and dropping three capabilities cost this level nothing.
 */
import { attachDebugStats } from "@/scene/debugStats";
import { createDefaultRuntimeModules } from "@/scene/capabilities/defaultRuntimeModules";
import { createForgeRuntime } from "@/scene/ForgeRuntime";
import { AI_CHARACTER_ANIMATION_MODULE_ID } from "@/scene/capabilities/aiCharacterAnimationModule";
import { CHARACTER_MOVEMENT_MODULE_ID } from "@/scene/capabilities/characterMovementModule";
import { SKELETAL_ANIMATION_MODULE_ID } from "@/scene/capabilities/skeletalAnimationModule";
import { gameModeProviderService } from "@/scene/capabilities/runtimeServiceKeys";
import { rtsCameraGameMode } from "@/game/gameModes/rtsCameraGameMode";
import type { ForgeGameModule } from "@/scene/ForgeGameModule";

/** Public-root relative path of the level this starter opens. */
const STARTER_LEVEL = "layouts/rts.level.json";

/**
 * What a characterless game switches off. A capability only attaches once it is
 * registered, so filtering the template's list here *is* the opt-out — and it
 * stays correct as the template grows new capabilities, which an
 * inclusion list hand-copied from `defaultRuntimeModules` would not.
 *
 * Dropping these removes exactly three behaviors and nothing else: the level's
 * scene content still builds in full (plan invariant I3). The runtime says so
 * out loud too — open a level that *does* author a CharacterMovement component
 * with this list and the console reports it as an unsupported capability
 * instead of leaving you to guess why the character stands still.
 */
const CHARACTER_CAPABILITIES = new Set<string>([
  CHARACTER_MOVEMENT_MODULE_ID,
  SKELETAL_ANIMATION_MODULE_ID,
  AI_CHARACTER_ANIMATION_MODULE_ID,
]);

/**
 * The whole game, as Layer 3 sees it: one Game Mode.
 *
 * A real strategy game grows from here — a behavior catalog for its scripted
 * objects, an AI task vocabulary for its units, its own rules runtime — and each
 * of those is another service published from this same `register` hook. None of
 * them is a reason to touch the runtime shell.
 */
const rtsStarterGameModule: ForgeGameModule = {
  id: "rts.starter",
  register(runtime) {
    runtime.services.provide(gameModeProviderService, {
      resolve: async () => rtsCameraGameMode,
    });
  },
};

async function main(): Promise<void> {
  const canvas = document.getElementById("game-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Missing required element: #game-canvas");
  }

  const forge = await createForgeRuntime({
    canvas,
    modules: createDefaultRuntimeModules().filter(
      (module) => !CHARACTER_CAPABILITIES.has(module.id),
    ),
    gameModules: [rtsStarterGameModule],
  });

  // Diagnostics, not scene setup: the perf overlay behind `?debug`.
  if (new URLSearchParams(location.search).has("debug")) {
    const host = document.getElementById("debug-stats");
    if (host instanceof HTMLElement) attachDebugStats(forge.app, host);
  }

  await forge.loadLevel(STARTER_LEVEL);
  forge.start();
}

void main();
