/**
 * The runtime's shared-service contract: every handle a capability module may
 * publish or look up, in one place.
 *
 * Keeping the keys here (rather than each module exporting its own) makes the
 * loose-coupling surface between Layer 2 modules readable as a list, and lets a
 * consumer depend on a *capability* without importing the module that currently
 * happens to implement it. Every service is optional by construction: `resolve`
 * returning `undefined` means the providing module is switched off, which
 * modules must handle as normal (I3 — opting a module out removes only its
 * behavior).
 *
 * Some services are still provided by `RuntimeSceneApp` while the matching
 * subsystem is baked into the shell; as later Phase E slices extract those,
 * the provider moves to the module without the consumers changing.
 */
import type { MovingPlatformQuery } from "@engine/physics/movingPlatformSubsystem";
import type { PhysicsTransformSink } from "@engine/physics/physicsSubsystem";
import type { SplinePathFollowerDebugState } from "@engine/scene/splinePathFollower";
import type { SplineRegistry } from "@engine/scene/splineRegistry";

import { runtimeServiceKey } from "./RuntimeServices";

/**
 * Live kinematic platforms for this frame. The character movement solver reads
 * it to collide with, stand on, and be carried by a platform.
 * Provided by: `movingPlatformModule`.
 */
export const movingPlatformQueryService =
  runtimeServiceKey<MovingPlatformQuery>("moving-platform-query");

/**
 * The current level's spline registry. It is re-created per level, so the
 * service is a getter rather than the registry itself.
 * Provided by: the runtime shell (owner of the built level's splines).
 */
export const splineRegistrySourceService =
  runtimeServiceKey<() => SplineRegistry>("spline-registry-source");

/**
 * Teleports an entity in the character movement solver's own state and syncs
 * the result to render/physics. A mover that writes a transform directly (a
 * spline route) must call this, or the solver overwrites it from its stale
 * local copy on the next frame.
 * Provided by: the runtime shell (character movement is still baked in).
 */
export const characterTransformResetService =
  runtimeServiceKey<PhysicsTransformSink>("character-transform-reset");

/** Read side of the spline-follower debug overlay (`?debug`) and browser smokes. */
export interface SplineFollowerDebugSource {
  followers(): readonly SplinePathFollowerDebugState[];
}

/** Provided by: `splineFollowerModule`. */
export const splineFollowerDebugService =
  runtimeServiceKey<SplineFollowerDebugSource>("spline-follower-debug");
