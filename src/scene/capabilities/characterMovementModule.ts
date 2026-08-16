/**
 * Layer 2 capability: Character Movement — the kinematic solver that turns
 * input (or an AI move intent) into a character's next transform.
 *
 * Owns the {@link CharacterMovementSubsystem}: capsule collision, ground
 * probing and step-up, slope handling, gravity and jumps, knockback launches,
 * and riding moving platforms. It ticks in the `movement` slot — after the
 * `decision` slot that produces AI intents, before the `post-movement` slot
 * where an explicit spline route overrides the solve.
 *
 * What it needs from the world it moves characters through comes in as one host
 * service, because all of it is live shell/Layer 3 state: input actions, the
 * physics query, gravity, the Game Mode's control yaw and possession, AI move
 * intents and the locomotion report sink. Without that host the module
 * registers no solver at all — there would be nothing to move characters with.
 * Platforms are the exception: they are resolved per call from
 * `moving-platform-query`, so the solver simply sees no platforms when that
 * module is off, whichever order the two attached in.
 *
 * Switched off, characters stop being simulated as pawns: the level, its
 * meshes, its physics bodies and its scripts are untouched, the shell's
 * transform/velocity lookups all report "no solved characters", and a mover
 * that would have gone through the solver writes its transform directly. This
 * is the top-down / no-pawn case the layered runtime plan exists for.
 */
import { CharacterMovementSubsystem } from "@engine/movement/characterMovementSubsystem";

import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeServices } from "./RuntimeServices";
import {
  characterMovementHostService,
  characterMovementQueryService,
  characterTransformResetService,
  movingPlatformQueryService,
} from "./runtimeServiceKeys";

export const CHARACTER_MOVEMENT_MODULE_ID = "character-movement";

export function createCharacterMovementModule(): CapabilityModule {
  let movement: CharacterMovementSubsystem | null = null;

  return {
    id: CHARACTER_MOVEMENT_MODULE_ID,

    onRuntimeStart(services: RuntimeServices) {
      const host = services.resolve(characterMovementHostService);
      // No host means no world to move through: stay unregistered rather than
      // installing a solver that would silently do nothing every frame.
      if (!host) return;

      movement = new CharacterMovementSubsystem(host.actions, services.syncEntityTransform, host.physics, {
        getGravityY: () => host.getGravityY(),
        getControlYaw: (entityId) => host.getControlYaw(entityId),
        isPlayerControlled: (entityId) => host.isPlayerControlled(entityId),
        getMoveIntent: (entityId, transform, deltaSeconds) =>
          host.getMoveIntent(entityId, transform, deltaSeconds),
        reportLocomotion: (entityId, report) => host.reportLocomotion(entityId, report),
        dynamicBlockers: (entityId, transform) => host.dynamicBlockers(entityId, transform),
        // Resolved per call, so the solver sees no platforms when the
        // moving-platform module is switched off (I3) — and does not care
        // whether that module attached before or after it.
        platforms: {
          platforms: () => services.resolve(movingPlatformQueryService)?.platforms() ?? [],
        },
      });

      services.addSubsystem("movement", movement);
      services.addEntitySink(movement);

      services.provide(characterMovementQueryService, {
        transformOf: (entityId) => movement?.transformOf(entityId) ?? null,
        velocityOf: (entityId) => movement?.velocityOf(entityId) ?? null,
        forEachCharacter: (visit) => movement?.forEachCharacter(visit),
        launch: (entityId, velocity, options) => movement?.launch(entityId, velocity, options),
      });

      // A direct transform write (a spline route, a respawn, a save restore) has
      // to land in the solver's own state too, or it overwrites the write from
      // its stale local copy on the next frame.
      services.provide(characterTransformResetService, (entityId, transform) => {
        movement?.resetEntityTransform(entityId, transform);
        services.syncEntityTransform(entityId, transform);
      });
    },

    onLevelUnloaded() {
      // Empty the solver while the level it solved is still intact, so the
      // frames between teardown and rebuild simulate nothing.
      movement?.clear();
    },

    dispose() {
      movement?.dispose();
      movement = null;
    },
  };
}
