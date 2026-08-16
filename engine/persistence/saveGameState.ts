/**
 * Save payload contract: which runtime facts become a save-game payload, and how
 * a loaded payload becomes a restore request.
 *
 * {@link SaveGameStore} next door owns only the storage mechanics and treats the
 * payload as opaque; this module is the shape. It sits in the engine (not in
 * `src/game`) because the facts it captures — the active level, the possessed
 * pawn's transform, the behavior state explicitly opted into persistence — are
 * platform facts every fork shares. The save-game *capability* that drives it is
 * `src/scene/capabilities/saveGameModule.ts`, and capability modules may not
 * import game code; project-specific save data belongs in a fork's own payload
 * on top of this one, not in here.
 */
import type { PersistentScriptStateEntry } from "../behavior/behaviorSubsystem";
import type { TransformComponent } from "../scene/components";
import type { SceneJsonValue } from "../scene/entity";

export interface SavedPlayerTransform {
  readonly position: readonly [number, number, number];
  readonly facingYawDeg: number;
}

export interface GameSaveState {
  readonly activeLevelPath: string;
  readonly player: SavedPlayerTransform | null;
  /** BehaviorContext state entries explicitly opted into persistence. */
  readonly flags: readonly PersistentScriptStateEntry[];
}

export interface GameSaveRestoreRequest {
  readonly levelPath: string;
  readonly player: SavedPlayerTransform | null;
  readonly persistentState: readonly PersistentScriptStateEntry[];
}

export interface CollectSaveStateInput {
  readonly activeLevelPath: string;
  readonly playerTransform?: Pick<TransformComponent, "position" | "rotation"> | null;
  readonly persistentState?: readonly PersistentScriptStateEntry[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readVec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z) ? [x, y, z] : null;
}

function cloneSceneJsonValue(value: SceneJsonValue): SceneJsonValue {
  if (Array.isArray(value)) return value.map(cloneSceneJsonValue);
  if (typeof value === "object" && value !== null) {
    const clone: Record<string, SceneJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) clone[key] = cloneSceneJsonValue(entry);
    return clone;
  }
  return value;
}

function isSceneJsonValue(value: unknown): value is SceneJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    isFiniteNumber(value)
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isSceneJsonValue);
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(isSceneJsonValue);
}

function normalizePlayer(value: unknown): SavedPlayerTransform | null {
  if (!isPlainObject(value)) return null;
  const position = readVec3(value.position);
  if (!position || !isFiniteNumber(value.facingYawDeg)) return null;
  return { position, facingYawDeg: value.facingYawDeg };
}

function normalizePersistentState(value: unknown): PersistentScriptStateEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: PersistentScriptStateEntry[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    if (typeof raw.entityId !== "string" || raw.entityId.length === 0) continue;
    if (typeof raw.key !== "string" || raw.key.length === 0) continue;
    if (!isSceneJsonValue(raw.value)) continue;
    entries.push({
      entityId: raw.entityId,
      key: raw.key,
      value: cloneSceneJsonValue(raw.value),
    });
  }
  return entries.sort(
    (a, b) => a.entityId.localeCompare(b.entityId) || a.key.localeCompare(b.key),
  );
}

export function collectSaveState(input: CollectSaveStateInput): GameSaveState {
  const player = input.playerTransform
    ? {
        position: [...input.playerTransform.position] as [number, number, number],
        facingYawDeg: input.playerTransform.rotation[1],
      }
    : null;
  return {
    activeLevelPath: input.activeLevelPath,
    player,
    flags: normalizePersistentState(input.persistentState ?? []),
  };
}

export function applySaveState(value: unknown): GameSaveRestoreRequest | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.activeLevelPath !== "string" || value.activeLevelPath.length === 0) return null;
  const player = value.player === null || value.player === undefined ? null : normalizePlayer(value.player);
  if (value.player !== null && value.player !== undefined && player === null) return null;
  return {
    levelPath: value.activeLevelPath,
    player,
    persistentState: normalizePersistentState(value.flags),
  };
}

export function consumeRestoreForLoadedLevel(
  pending: GameSaveRestoreRequest | null,
  loadedLevelPath: string,
): { readonly restore: GameSaveRestoreRequest | null; readonly pending: GameSaveRestoreRequest | null } {
  if (!pending) return { restore: null, pending: null };
  if (pending.levelPath !== loadedLevelPath) return { restore: null, pending };
  return { restore: pending, pending: null };
}
