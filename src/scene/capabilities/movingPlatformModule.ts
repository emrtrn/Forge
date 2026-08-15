/**
 * Layer 2 capability: authored kinematic moving platforms.
 *
 * Owns the {@link MovingPlatformSubsystem} that used to be baked into
 * `RuntimeSceneApp`. Switching this module off stops platforms from moving —
 * the platform meshes, their colliders and everything else the level authored
 * still build (I3), because that is Layer 1 scene content.
 */
import {
  MovingPlatformSubsystem,
  type MovingPlatformQuery,
} from "@engine/physics/movingPlatformSubsystem";

import type { CapabilityModule } from "./CapabilityModule";
import { movingPlatformQueryService } from "./runtimeServiceKeys";

export const MOVING_PLATFORM_MODULE_ID = "moving-platform";

export function createMovingPlatformModule(): CapabilityModule {
  let subsystem: MovingPlatformSubsystem | null = null;

  return {
    id: MOVING_PLATFORM_MODULE_ID,

    onRuntimeStart(services) {
      const platforms = new MovingPlatformSubsystem(services.syncEntityTransform);
      subsystem = platforms;
      // The "platform" slot ticks after physics and before movement, so a rider
      // is carried by the same frame's platform delta (no one-frame lag).
      services.addSubsystem("platform", platforms);
      services.addEntitySink(platforms);
      services.provide<MovingPlatformQuery>(movingPlatformQueryService, platforms);
    },

    onLevelUnloaded() {
      // Level Travel: drop this level's platforms so the engine loop ticks an
      // empty set while the next level loads.
      subsystem?.clear();
    },

    dispose() {
      subsystem?.dispose();
      subsystem = null;
    },
  };
}
