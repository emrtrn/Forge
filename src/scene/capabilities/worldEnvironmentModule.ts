/**
 * Layer 2 capability: the World Environment's Play clock (WES v0.3 §13).
 *
 * On level load it starts the level's time, season and weather from the World
 * Environment actor's defaults (never from an editor preview), advances the
 * clock with the simulation delta — so pausing or scaling time pauses or scales
 * the day — and publishes the state through {@link worldEnvironmentService} for
 * game modules and the renderer. Switching the module off leaves Play with the
 * authored look: the shell finds no service and renders no override.
 */
import { WorldEnvironmentController } from "@engine/environment/worldEnvironmentController";

import type { CapabilityModule } from "./CapabilityModule";
import { worldEnvironmentService } from "./runtimeServiceKeys";

export const WORLD_ENVIRONMENT_MODULE_ID = "world-environment";

export function createWorldEnvironmentModule(): CapabilityModule {
  const controller = new WorldEnvironmentController();

  return {
    id: WORLD_ENVIRONMENT_MODULE_ID,

    onRuntimeStart(services) {
      services.provide(worldEnvironmentService, controller);
    },

    onLevelLoaded(context) {
      controller.load(context.layout.worldEnvironment);
    },

    onLevelUnloaded() {
      controller.clear();
    },

    update(deltaSeconds) {
      controller.advance(deltaSeconds);
    },

    dispose() {
      controller.clear();
    },
  };
}
