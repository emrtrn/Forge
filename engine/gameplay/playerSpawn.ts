/**
 * Pure TPS spawn resolution (no Three.js/DOM).
 *
 * In the TPS Game Mode the possessed player starts at the scene's first Player
 * Start marker (an instance under the synthetic `marker:playerStart` asset). When
 * the scene has no marker the player spawns at the world origin. Used by the
 * runtime shell to rewrite the player character's start transform before the
 * scene is built, so render, physics and behavior all begin at the spawn point.
 *
 * When the scene has no authored player character at all, the runtime spawns a
 * default character pawn (see {@link createDefaultPlayerCharacter}) at the Player
 * Start so Play always has someone to possess.
 */
import { PLAYER_START_ASSET_ID } from "@engine/scene/shapes";
import { readRotation } from "@engine/scene/transform";
import type { LayoutCharacter, RoomLayout, Vec3 } from "@engine/scene/layout";

export interface PlayerStartSpawn {
  /** Index into `layout.characters` of the resolved player. */
  readonly characterIndex: number;
  /** World spawn position (the marker's, or the origin when none exists). */
  readonly position: Vec3;
  /** Spawn yaw in degrees from the marker, or null to keep the authored facing. */
  readonly yawDeg: number | null;
}

/**
 * A Player Start marker's world position + yaw, or null when the scene has no
 * matching marker. Yaw is the marker's Y rotation in degrees.
 *
 * `spawnTag` selects a specific marker for Level Travel: the first marker whose
 * `metadata.spawnTag` equals the tag. When the tag is absent, or no marker
 * carries it, the first Player Start marker in the level is used — so an
 * untagged level (or a travel with no spawn tag) still spawns at the default
 * start. Markers are placements under the synthetic `marker:playerStart` asset.
 */
export function findPlayerStartTransform(
  layout: RoomLayout,
  spawnTag?: string,
): { position: Vec3; yawDeg: number | null } | null {
  const markers = layout.instances.find(
    (entry) => entry.assetId === PLAYER_START_ASSET_ID,
  )?.placements;
  if (!markers || markers.length === 0) return null;
  const tagged =
    spawnTag !== undefined
      ? markers.find((placement) => placement.metadata?.spawnTag === spawnTag)
      : undefined;
  const marker = tagged ?? markers[0];
  if (!marker) return null;
  return {
    position: [marker.position[0], marker.position[1], marker.position[2]],
    yawDeg: readRotation(marker)[1],
  };
}

/** Resolves the player character the same way the TPS mode possesses one. */
function resolvePlayerCharacterIndex(layout: RoomLayout): number | null {
  const tagged = layout.characters.findIndex((c) => c.metadata?.player === true);
  if (tagged !== -1) return tagged;
  const input = layout.characters.findIndex((c) => c.behavior?.script === "input-move");
  return input === -1 ? null : input;
}

/** True when the layout already contains a character the TPS mode would possess. */
export function hasPlayerCharacter(layout: RoomLayout): boolean {
  return resolvePlayerCharacterIndex(layout) !== null;
}

/**
 * Computes where the TPS player should spawn, or null when the scene has no
 * player character to move. With a Player Start marker the player takes its
 * position + yaw; without one it spawns at the origin keeping its authored
 * facing.
 */
export function computePlayerStartSpawn(
  layout: RoomLayout,
  spawnTag?: string,
): PlayerStartSpawn | null {
  const characterIndex = resolvePlayerCharacterIndex(layout);
  if (characterIndex === null) return null;

  const start = findPlayerStartTransform(layout, spawnTag);
  if (!start) {
    return { characterIndex, position: [0, 0, 0], yawDeg: null };
  }
  return { characterIndex, position: start.position, yawDeg: start.yawDeg };
}

/** Inputs for {@link createDefaultPlayerCharacter}, sourced from the mode's pawn. */
export interface DefaultPlayerPawnSpec {
  /** Character asset id to instantiate. */
  readonly assetId: string;
  /** Authored uniform scale; defaults to 1. */
  readonly scale?: number | undefined;
  /** `input-move` walk speed; defaults to 3. */
  readonly speed?: number | undefined;
}

/**
 * Builds the synthetic player character the TPS mode spawns when the scene has
 * no authored player. It carries the `player` metadata tag + `input-move`
 * behavior, so the same possession path picks it up, placed at the given Player
 * Start transform. Runtime-only: the caller appends it to the in-memory layout,
 * never to the saved file.
 */
export function createDefaultPlayerCharacter(
  pawn: DefaultPlayerPawnSpec,
  position: Vec3,
  yawDeg: number | null,
): LayoutCharacter {
  return {
    assetId: pawn.assetId,
    name: "Player",
    position: [position[0], position[1], position[2]],
    rotation: [0, yawDeg ?? 0, 0],
    scale: pawn.scale ?? 1,
    scaleLocked: true,
    animation: "idle",
    metadata: { player: true },
    behavior: { script: "input-move", params: { speed: pawn.speed ?? 3 } },
  };
}
