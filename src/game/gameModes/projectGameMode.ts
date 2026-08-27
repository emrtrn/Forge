/**
 * Project Game Mode: a {@link GameModeDefinition} built at runtime from a user
 * authored `gameMode` Actor Script class (`*.actor.json`). Unlike the built-in
 * modes (compiled into the registry), a project mode is data-driven — the user
 * creates it in the Content Browser, selects it in World Settings, and points its
 * `defaultPawnClassRef` variable at a `character` Actor Script (e.g. Player).
 *
 * The play behavior reuses the TPS session verbatim (follow camera + locomotion +
 * possession of the resolved player character). The only project-specific part is
 * the default pawn: when the scene has no authored player, the runtime spawns this
 * mode's {@link PawnDefinition.pawnClassRef} Actor Script at the Player Start (see
 * `RuntimeSceneApp.applyPlayerStartSpawn`). Built-in modes are unaffected.
 */
import { TpsCharacterSession, TPS_PLAYER_CONTROLLER } from "./tpsCharacterGameMode";
import type { GameModeDefinition, PlayerControllerDefinition } from "@/scene/gameModeTypes";

/** Resolved config for a project Game Mode, sourced from its Actor Script class. */
export interface ProjectGameModeConfig {
  /** Class ref of the `gameMode` Actor Script (its `worldSettings.gameMode` id). */
  readonly classRef: string;
  /** Human-facing label (the Actor Script's name). */
  readonly displayName: string;
  /** Default pawn Actor Script class ref to spawn, or undefined when unset. */
  readonly defaultPawnClassRef?: string | undefined;
}

/**
 * Builds a {@link GameModeDefinition} for a project `gameMode` class. The mode's
 * id is its class ref so it round-trips through `worldSettings.gameMode`. The
 * session is a {@link TpsCharacterSession}; the default pawn carries the class's
 * `defaultPawnClassRef` (absent means the mode only possesses an authored player).
 */
export function createProjectGameMode(config: ProjectGameModeConfig): GameModeDefinition {
  const playerController: PlayerControllerDefinition = {
    ...TPS_PLAYER_CONTROLLER,
    id: `${config.classRef}#controller`,
  };
  return {
    id: config.classRef,
    displayName: config.displayName,
    description: "Project Game Mode (Actor Script).",
    defaultPawn: {
      id: `${config.classRef}#pawn`,
      kind: "character",
      ...(config.defaultPawnClassRef ? { pawnClassRef: config.defaultPawnClassRef } : {}),
    },
    playerController,
    createSession: (context) => new TpsCharacterSession(context, playerController),
  };
}
