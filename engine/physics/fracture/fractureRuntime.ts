import type { FractureBakeResult } from "./fractureBake";
import type { AssetFractureDef, PlacementFractureOverride } from "./fractureTypes";

/** A three-component vector independent of the render and physics backends. */
export type FractureVec3 = readonly [number, number, number];
/** Irreversible fracture state of a registered entity. */
export type FractureState = "intact" | "fractured";

/** Level-owned override on one placement or actor; absent fields use the asset. */
export type FractureOverride = Readonly<Omit<PlacementFractureOverride, "enabled">> & {
  readonly enabled?: boolean;
};

interface RegistryEntry {
  readonly def: AssetFractureDef;
  readonly breakImpulse: number;
  state: FractureState;
  damage: number;
}

/** Routes every break trigger through a single intact-to-fractured transition. */
export class FractureRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  /** Replaces an entity and resets it; disabled definitions or overrides remove it. */
  register(entityId: string, def: AssetFractureDef, override?: FractureOverride): boolean {
    if (!def.enabled || override?.enabled === false) {
      this.entries.delete(entityId);
      return false;
    }
    const threshold = override?.breakImpulse;
    this.entries.set(entityId, {
      def,
      breakImpulse: threshold !== undefined && Number.isFinite(threshold) && threshold >= 0
        ? threshold : def.breakImpulse,
      state: "intact",
      damage: 0,
    });
    return true;
  }

  /** Removes an entity and its state. */
  unregister(entityId: string): void {
    this.entries.delete(entityId);
  }

  /** Removes all registrations. */
  clear(): void {
    this.entries.clear();
  }

  /** Whether an entity is registered. */
  has(entityId: string): boolean {
    return this.entries.has(entityId);
  }

  /** Returns registered ids in registration order. */
  ids(): string[] {
    return [...this.entries.keys()];
  }

  /** Returns the current state, or null when unregistered. */
  state(entityId: string): FractureState | null {
    return this.entries.get(entityId)?.state ?? null;
  }

  /** Returns the asset definition, or null when unregistered. */
  def(entityId: string): AssetFractureDef | null {
    return this.entries.get(entityId)?.def ?? null;
  }

  /** Returns the valid placement threshold or asset threshold, or null. */
  breakImpulse(entityId: string): number | null {
    return this.entries.get(entityId)?.breakImpulse ?? null;
  }

  /** Returns accumulated damage, or zero when unregistered. */
  damage(entityId: string): number {
    return this.entries.get(entityId)?.damage ?? 0;
  }

  /** Breaks once when a finite impulse reaches the threshold. */
  applyImpact(entityId: string, impulse: number): boolean {
    const entry = this.entries.get(entityId);
    if (!entry || !Number.isFinite(impulse) || impulse < entry.breakImpulse) return false;
    return this.requestBreak(entityId);
  }

  /** Accumulates positive finite damage on intact entities and checks the threshold. */
  applyDamage(entityId: string, amount: number): boolean {
    const entry = this.entries.get(entityId);
    if (!entry || entry.state !== "intact" || !(amount > 0) || !Number.isFinite(amount)) return false;
    entry.damage += amount;
    return entry.def.damageToBreak !== null && entry.damage >= entry.def.damageToBreak
      ? this.requestBreak(entityId) : false;
  }

  /** Performs the scripted intact-to-fractured transition exactly once. */
  requestBreak(entityId: string): boolean {
    const entry = this.entries.get(entityId);
    if (!entry || entry.state !== "intact") return false;
    entry.state = "fractured";
    return true;
  }

  /** Restores a fractured save-game state without emitting a break. */
  markFractured(entityId: string): void {
    const entry = this.entries.get(entityId);
    if (entry) entry.state = "fractured";
  }
}

/** Source pose with Euler degrees in Three.js XYZ order. */
export interface FracturePlacement {
  readonly position: FractureVec3;
  readonly rotation: FractureVec3;
  readonly scale: FractureVec3;
}

/** Breaking hit in world space; a null point uses the kept volume centre. */
export interface FractureImpactInfo {
  readonly point: FractureVec3 | null;
  /** N·s of the breaking hit. */
  readonly impulse: number;
}

/** One chunk body to create, with a scaled body-local hull. */
export interface ChunkSpawnSpec {
  readonly chunkIndex: number;
  readonly chunkId: string;
  readonly position: FractureVec3;
  readonly rotation: FractureVec3;
  readonly scale: FractureVec3;
  readonly massKg: number;
  readonly hull: readonly FractureVec3[];
  readonly linearVelocity: FractureVec3;
  /** Impulse to apply once after body creation. */
  readonly impulse: FractureVec3;
  /** Seconds; Infinity means permanent. */
  readonly lifetime: number;
  /** The chunk's share of the whole baked volume (every chunk, kept or not). */
  readonly volumeFraction: number;
}

/** Maximum outward kick speed before the impact attenuation, m/s. */
export const FRACTURE_MAX_BREAK_SPEED = 6;
/** Outward kick speed for scripted breaks, m/s. */
export const FRACTURE_SCRIPTED_BREAK_SPEED = 1.5;
/** Minimum mass of a chunk body, kg. */
export const FRACTURE_MIN_CHUNK_MASS = 0.01;

/** Plans deterministic world-space chunk spawns without creating bodies or meshes. */
export function planChunkSpawns(
  bake: FractureBakeResult,
  def: AssetFractureDef,
  placement: FracturePlacement,
  sourceVelocity: FractureVec3,
  impact: FractureImpactInfo | null,
): ChunkSpawnSpec[] {
  const kept = bake.chunks.map((chunk, index) => ({ chunk, index }))
    .sort((a, b) => b.chunk.volume - a.chunk.volume || a.index - b.index)
    .slice(0, Math.max(0, Math.floor(def.maxActiveChunks)))
    .sort((a, b) => a.index - b.index);
  if (kept.length === 0) return [];

  const [rx, ry, rz] = placement.rotation.map((degrees) => degrees * Math.PI / 360);
  const cx = Math.cos(rx!);
  const sx = Math.sin(rx!);
  const cy = Math.cos(ry!);
  const sy = Math.sin(ry!);
  const cz = Math.cos(rz!);
  const sz = Math.sin(rz!);
  const quaternion: readonly [number, number, number, number] = [
    sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz,
  ];
  const worldPoint = (point: FractureVec3): FractureVec3 => {
    const rotated = rotate(multiply(placement.scale, point), quaternion);
    return [placement.position[0] + rotated[0], placement.position[1] + rotated[1], placement.position[2] + rotated[2]];
  };
  const massScale = Math.abs(placement.scale[0] * placement.scale[1] * placement.scale[2]);
  const masses = kept.map(({ chunk }) => Math.max(FRACTURE_MIN_CHUNK_MASS, chunk.mass * massScale));
  const totalMass = masses.reduce((sum, mass) => sum + mass, 0);
  const totalVolume = kept.reduce((sum, { chunk }) => sum + chunk.volume, 0);
  const meanVolume = totalVolume / kept.length;
  const bakedVolume = bake.chunks.reduce((sum, chunk) => sum + chunk.volume, 0);
  const centre: [number, number, number] = [0, 0, 0];
  if (totalVolume > 0) {
    for (const { chunk } of kept) {
      for (let axis = 0; axis < 3; axis += 1) centre[axis]! += chunk.pivot[axis]! * chunk.volume / totalVolume;
    }
  }
  const origin = impact?.point ?? worldPoint(centre);
  const speed = impact === null ? FRACTURE_SCRIPTED_BREAK_SPEED
    : totalMass > 0 && Number.isFinite(impact.impulse) && impact.impulse > 0
      ? 0.5 * Math.min(FRACTURE_MAX_BREAK_SPEED, impact.impulse / totalMass) : 0;

  return kept.map(({ chunk, index }, keptIndex) => {
    const position = worldPoint(chunk.pivot);
    const offset: FractureVec3 = [position[0] - origin[0], position[1] - origin[1], position[2] - origin[2]];
    const length = Math.hypot(...offset);
    const direction: FractureVec3 = length < 1e-9 ? [0, 1, 0]
      : [offset[0] / length, offset[1] / length, offset[2] / length];
    const massKg = masses[keptIndex]!;
    const kick = massKg * speed;
    return {
      chunkIndex: index, chunkId: chunk.id, position,
      rotation: [...placement.rotation], scale: [...placement.scale], massKg,
      hull: chunk.hull.map((point) => multiply(placement.scale, point)),
      linearVelocity: [...sourceVelocity],
      impulse: [direction[0] * kick, direction[1] * kick, direction[2] * kick],
      lifetime: def.chunkLifetime === 0 ? Infinity
        : def.chunkLifetime * (meanVolume === 0 ? 1 : 0.5 + 0.5 * Math.min(1, chunk.volume / meanVolume)),
      volumeFraction: bakedVolume > 0 ? chunk.volume / bakedVolume : 0,
    };
  });
}

function multiply(a: FractureVec3, b: FractureVec3): FractureVec3 {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

function rotate(vector: FractureVec3, q: readonly [number, number, number, number]): FractureVec3 {
  const [x, y, z] = vector;
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
}

/** A live chunk and its lifetime, in seconds; Infinity never expires. */
export interface LiveChunk {
  readonly id: string;
  readonly ownerId: string;
  readonly bornAt: number;
  readonly expiresAt: number;
}

/** Lifetime and count budget with oldest-first eviction and stable insertion ties. */
export class ChunkBudget {
  private readonly chunks = new Map<string, LiveChunk>();

  /** Adds or replaces a chunk with a fresh insertion position. */
  add(chunk: LiveChunk): void {
    this.chunks.delete(chunk.id);
    this.chunks.set(chunk.id, chunk);
  }

  /** Removes a chunk and reports whether it existed. */
  remove(id: string): boolean {
    return this.chunks.delete(id);
  }

  /** Removes expired chunks in birth order, including the exact boundary. */
  expire(now: number): string[] {
    return this.removeMatching((chunk) => chunk.expiresAt !== Infinity && chunk.expiresAt <= now);
  }

  /** Removes oldest chunks until the floored, non-negative cap is met. */
  enforce(cap: number): string[] {
    const count = Math.max(0, this.size - Math.max(0, Math.floor(cap)));
    const removed = this.ids().slice(0, count);
    for (const id of removed) this.chunks.delete(id);
    return removed;
  }

  /** Removes all chunks belonging to an owner, in birth order. */
  removeOwner(ownerId: string): string[] {
    return this.removeMatching((chunk) => chunk.ownerId === ownerId);
  }

  /** Removes every chunk and returns ids in birth order. */
  clear(): string[] {
    const removed = this.ids();
    this.chunks.clear();
    return removed;
  }

  /** Number of live chunks. */
  get size(): number {
    return this.chunks.size;
  }

  /** Returns ids ordered by birth time, then insertion order. */
  ids(): string[] {
    return [...this.chunks.values()].sort((a, b) => a.bornAt - b.bornAt).map((chunk) => chunk.id);
  }

  private removeMatching(predicate: (chunk: LiveChunk) => boolean): string[] {
    const removed = this.ids().filter((id) => predicate(this.chunks.get(id)!));
    for (const id of removed) this.chunks.delete(id);
    return removed;
  }
}
