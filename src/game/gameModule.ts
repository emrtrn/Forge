/**
 * The template's Layer 3 game module — the fork-owned half of the runtime.
 *
 * `main.ts` plugs this into `createForgeRuntime`, and everything game-specific
 * the runtime shell used to import directly is published from here instead. A
 * fork edits (or replaces) this file; it never edits `RuntimeSceneApp` (I4).
 *
 * Today it supplies the three catalogs the shell must not hard-code:
 *  - the Game Mode catalog — which modes exist, and how an authored
 *    `worldSettings.gameMode` id resolves to one. Built-in ids come from the
 *    registry; a `*.actor.json` class ref is a project Game Mode built from its
 *    Actor Script class, and a ref that turns out not to be a `gameMode` class
 *    falls back to the default camera mode so a stale reference can't break Play.
 *  - the behavior catalog — script id → update function, rebuilt per level so
 *    behavior state never leaks between scenes.
 *  - the AI task vocabulary the Behavior Tree runner executes.
 *
 * It also runs the authored gameplay rules (score, objectives, round timer,
 * win/loss screen) through its level, tick and teardown hooks — rules are game
 * content, so no part of them lives in the shell.
 */
import { createGameAiTaskRegistry } from "./ai/tasks";
import { createGameRulesRuntime, type GameRulesRuntime } from "./gameRulesRuntime";
import { createBehaviorRegistry } from "./behaviors";
import { isGameModeClassRef } from "./gameModes/catalog";
import { createProjectGameMode } from "./gameModes/projectGameMode";
import { resolveGameMode } from "./gameModes/registry";
import { readGameModeDefaultPawnClassRef } from "@engine/scene/actorScript";
import type { ForgeGameModule } from "@/scene/ForgeGameModule";
import type { GameModeDefinition } from "@/scene/gameModeTypes";
import {
  aiTaskRegistryService,
  behaviorRegistryFactoryService,
  gameModeProviderService,
  gameUiMessageService,
  type GameModeResolveRequest,
} from "@/scene/capabilities/runtimeServiceKeys";

async function resolveActiveGameMode(
  request: GameModeResolveRequest,
): Promise<GameModeDefinition> {
  const { gameModeId, loadActorClass } = request;
  if (!isGameModeClassRef(gameModeId)) return resolveGameMode(gameModeId);
  const def = await loadActorClass(gameModeId as string);
  if (def.parentClass !== "gameMode") return resolveGameMode(undefined);
  return createProjectGameMode({
    classRef: gameModeId as string,
    displayName: def.name,
    defaultPawnClassRef: readGameModeDefaultPawnClassRef(def),
  });
}

export function createGameModule(): ForgeGameModule {
  let rules: GameRulesRuntime | null = null;
  return {
    id: "forge.game",
    register(runtime) {
      runtime.services.provide(gameModeProviderService, {
        resolve: (request) => resolveActiveGameMode(request),
      });
      runtime.services.provide(behaviorRegistryFactoryService, (host) =>
        createBehaviorRegistry(host),
      );
      runtime.services.provide(aiTaskRegistryService, createGameAiTaskRegistry());
      rules = createGameRulesRuntime(runtime.services);
      runtime.services.provide(gameUiMessageService, (message) =>
        rules?.handleUiMessage(message) ?? false,
      );
    },
    onLevelLoaded(context) {
      rules?.levelLoaded(context);
    },
    update(deltaSeconds) {
      rules?.update(deltaSeconds);
    },
    onLevelUnloaded() {
      rules?.reset();
    },
    dispose() {
      rules?.reset();
    },
  };
}
