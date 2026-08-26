/**
 * The capability set the Forge template boots with.
 *
 * A fork composes its own list — dropping what its game does not need (a
 * top-down RTS has no character movement), keeping everything else — and passes
 * it to the runtime. Order is the registration order: setup runs front to back,
 * teardown back to front. It is *not* the tick order; that comes from each
 * module's tick slot (see `RUNTIME_TICK_SLOTS`), so reordering this list can
 * never silently change simulation behavior.
 *
 * Every entry must be constructed fresh per runtime (modules own subsystem
 * state), hence a factory rather than a shared constant.
 */
import { createAiModule } from "./aiModule";
import type { CapabilityModule } from "./CapabilityModule";
import { createCharacterMovementModule } from "./characterMovementModule";
import { createDialogueModule } from "./dialogueModule";
import { createMovingPlatformModule } from "./movingPlatformModule";
import { createRuntimeUiModule } from "./runtimeUiModule";
import { createSaveGameModule } from "./saveGameModule";
import { createSkeletalAnimationModule } from "./skeletalAnimationModule";
import { createSplineFollowerModule } from "./splineFollowerModule";

export function createDefaultRuntimeModules(): CapabilityModule[] {
  return [
    createMovingPlatformModule(),
    createSplineFollowerModule(),
    // Registered after the platform module purely for readability — the solver
    // resolves platforms per call, and its tick comes from the `movement` slot.
    createCharacterMovementModule(),
    // After the movement module so its entity sink still runs first, matching the
    // order the two subsystems were seeded in before either was a module.
    createAiModule(),
    createSkeletalAnimationModule(),
    createDialogueModule(),
    // The UI mounts before save-game so the save menu's slot fields are seeded
    // into an already-bound widget (order here is setup order, never tick order).
    createRuntimeUiModule(),
    createSaveGameModule(),
  ];
}
