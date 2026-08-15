/**
 * Layer 2 capability: Generic Spline Actors that carry entities along an
 * authored route.
 *
 * Owns the {@link SplinePathFollowerSubsystem} that used to be baked into
 * `RuntimeSceneApp`. Switching this module off leaves the splines themselves
 * (Layer 1 scene content, including their collision) intact — only the
 * following motion stops.
 *
 * Both of its dependencies are resolved through the service container instead
 * of being injected directly, and both are resolved lazily, per call: the
 * spline registry is replaced on every level build, and the character-movement
 * reset may be provided by a module that starts after this one (or not at all,
 * in a character-free game — in which case writing the transform through is
 * exactly the right behavior).
 */
import { SplinePathFollowerSubsystem } from "@engine/scene/splinePathFollower";
import { createSplineRegistry, type SplineRegistry } from "@engine/scene/splineRegistry";

import type { CapabilityModule } from "./CapabilityModule";
import {
  characterTransformResetService,
  splineFollowerDebugService,
  splineRegistrySourceService,
} from "./runtimeServiceKeys";

export const SPLINE_FOLLOWER_MODULE_ID = "spline-follower";

export function createSplineFollowerModule(): CapabilityModule {
  let subsystem: SplinePathFollowerSubsystem | null = null;
  /** Stand-in when no host publishes a registry: every lookup simply misses. */
  let emptyRegistry: SplineRegistry | null = null;

  return {
    id: SPLINE_FOLLOWER_MODULE_ID,

    onRuntimeStart(services) {
      const followers = new SplinePathFollowerSubsystem(
        () =>
          services.resolve(splineRegistrySourceService)?.() ??
          (emptyRegistry ??= createSplineRegistry()),
        (entityId, transform) => {
          services.resolve(characterTransformResetService)?.(entityId, transform);
          services.syncEntityTransform(entityId, transform);
        },
      );
      subsystem = followers;
      // "post-movement": an explicit authored route wins over the AI/nav move
      // intent the movement solver may have applied to the same actor.
      services.addSubsystem("post-movement", followers);
      services.addEntitySink(followers);
      services.provide(splineFollowerDebugService, followers);
    },

    onLevelUnloaded() {
      subsystem?.clear();
    },

    dispose() {
      subsystem?.dispose();
      subsystem = null;
      emptyRegistry = null;
    },
  };
}
