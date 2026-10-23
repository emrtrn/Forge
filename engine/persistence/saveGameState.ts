/**
 * Save payload contract: which runtime facts become a save-game payload, and how
 * a loaded payload becomes a restore request.
 *
 * {@link SaveGameStore} next door owns only the storage mechanics and treats the
 * payload as opaque; this module is the shape. It sits in the engine (not in
 * `src/game`) because the facts it captures — the active level, the possessed
 * pawn's transform, the level's vehicles and which one the player drives, the
 * behavior state explicitly opted into persistence — are platform facts every
 * fork shares. The save-game *capability* that drives it is
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

/** Automatic-gearbox position a moving car keeps through a save. */
export interface SavedVehicleDrivetrain {
  /** -1 = reverse; 1..N = forward. */
  readonly gear: number;
  readonly engineRpm: number;
}

/**
 * One ray-cast vehicle's simulated state (vehicle plan 4b): where it is, how
 * it is moving and whether it stands on its handbrake, so a car parked across
 * the level — or one saved at speed — comes back as it was, not at its spawn.
 */
export interface SavedVehicleState {
  readonly entityId: string;
  readonly position: readonly [number, number, number];
  /** Euler degrees, the {@link TransformComponent} convention. */
  readonly rotation: readonly [number, number, number];
  /** World m/s. */
  readonly linearVelocity: readonly [number, number, number];
  /** World rad/s. */
  readonly angularVelocity: readonly [number, number, number];
  readonly handbrake: boolean;
  /** Null for a car without a drivetrain (flat-force model). */
  readonly drivetrain: SavedVehicleDrivetrain | null;
}

export interface GameSaveState {
  readonly activeLevelPath: string;
  /**
   * The possessed pawn's transform. While the player drives, that pawn is the
   * vehicle, so this is the car's pose — the spot a driver whose car is gone at
   * load time stands up at.
   */
  readonly player: SavedPlayerTransform | null;
  /** BehaviorContext state entries explicitly opted into persistence. */
  readonly flags: readonly PersistentScriptStateEntry[];
  /** Every live vehicle in the level. Absent in saves written before vehicle plan 4b. */
  readonly vehicles?: readonly SavedVehicleState[];
  /**
   * The vehicle an on-foot pawn was driving, which a load seats it back in.
   * Null on foot, and for a Game Mode whose pawn *is* the vehicle.
   */
  readonly drivingVehicleId?: string | null;
}

export interface GameSaveRestoreRequest {
  readonly levelPath: string;
  readonly player: SavedPlayerTransform | null;
  readonly persistentState: readonly PersistentScriptStateEntry[];
  readonly vehicles: readonly SavedVehicleState[];
  readonly drivingVehicleId: string | null;
}

export interface CollectSaveStateInput {
  readonly activeLevelPath: string;
  readonly playerTransform?: Pick<TransformComponent, "position" | "rotation"> | null;
  readonly persistentState?: readonly PersistentScriptStateEntry[];
  readonly vehicles?: readonly SavedVehicleState[];
  readonly drivingVehicleId?: string | null;
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

function normalizeDrivetrain(value: unknown): SavedVehicleDrivetrain | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return undefined;
  const { gear, engineRpm } = value;
  if (!isFiniteNumber(gear) || !Number.isInteger(gear) || (gear !== -1 && gear < 1)) return undefined;
  if (!isFiniteNumber(engineRpm) || engineRpm < 0) return undefined;
  return { gear, engineRpm };
}

function normalizeVehicle(value: unknown): SavedVehicleState | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.entityId !== "string" || value.entityId.length === 0) return null;
  const position = readVec3(value.position);
  const rotation = readVec3(value.rotation);
  const linearVelocity = readVec3(value.linearVelocity);
  const angularVelocity = readVec3(value.angularVelocity);
  const drivetrain = normalizeDrivetrain(value.drivetrain);
  if (!position || !rotation || !linearVelocity || !angularVelocity || drivetrain === undefined) {
    return null;
  }
  return {
    entityId: value.entityId,
    position,
    rotation,
    linearVelocity,
    angularVelocity,
    handbrake: value.handbrake === true,
    drivetrain,
  };
}

/** Valid entries only, one per entity (the first wins), in the saved order. */
function normalizeVehicles(value: unknown): SavedVehicleState[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const vehicles: SavedVehicleState[] = [];
  for (const raw of value) {
    const vehicle = normalizeVehicle(raw);
    if (!vehicle || seen.has(vehicle.entityId)) continue;
    seen.add(vehicle.entityId);
    vehicles.push(vehicle);
  }
  return vehicles;
}

function normalizeDrivingVehicleId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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
    vehicles: normalizeVehicles(input.vehicles ?? []),
    drivingVehicleId: normalizeDrivingVehicleId(input.drivingVehicleId),
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
    // A damaged vehicle entry costs that car its saved pose, never the load.
    vehicles: normalizeVehicles(value.vehicles),
    drivingVehicleId: normalizeDrivingVehicleId(value.drivingVehicleId),
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
