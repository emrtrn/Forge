import type { DeformationDirtyRect } from "@engine/scene/deformationField";

/** Ground (m) a tyre still wets after it leaves water; its print fades out along it. */
export const TERRAIN_WET_TRAIL_LENGTH = 5;
/** Seconds a freshly printed, fully wet cell takes to dry. */
export const TERRAIN_WET_TRAIL_DRY_SECONDS = 40;
/** Wetness of the first print (0..1). */
export const TERRAIN_WET_TRAIL_STRENGTH = 1;
/**
 * Prints dry in steps this long (s): every step re-uploads the prints' bounds,
 * so drying costs one bounded upload a second rather than one per level.
 */
export const TERRAIN_WET_TRAIL_DRY_STEP_SECONDS = 1;
/** Horizontal jump (m) between two ticks treated as a teleport: the tyre re-anchors without a print. */
const TELEPORT_DISTANCE = 2;
/** A tyre unseen this long (airborne, despawned) is forgotten. */
const FORGET_SECONDS = 2;

export interface TerrainWetTrailContact {
  id: string;
  x: number;
  z: number;
  /** Tyre width (m): the print's width. */
  width: number;
  /** The contact stands in water (a Lake, a rut puddle): the tyre is soaked again. */
  inWater: boolean;
}

interface Tyre { x: number; z: number; water: number; unseen: number }

const mod = (value: number, size: number): number => ((value % size) + size) % size;

/**
 * Wet tyre prints, presentation only: a tyre leaving water carries it for
 * {@link TERRAIN_WET_TRAIL_LENGTH} m and prints a band that fades along that
 * distance, then dries over {@link TERRAIN_WET_TRAIL_DRY_SECONDS}. Storage
 * matches the deformation field's toroidal window — world cell (x, z) at
 * mod(z, N) * N + mod(x, N) — so the track texture carries it in a spare
 * channel. Never touches soil, physics or save state.
 */
export class TerrainWetTrail {
  /** Wetness per cell, 0..255; an upload view, callers must not mutate it. */
  readonly wet: Uint8Array;
  private readonly active = new Map<number, { cx: number; cz: number }>();
  private readonly tyres = new Map<string, Tyre>();
  private minX = 0;
  private minZ = 0;
  private drySeconds = 0;
  private dryRemainder = 0;
  private dirtyMinX = Infinity;
  private dirtyMinZ = Infinity;
  private dirtyMaxX = -Infinity;
  private dirtyMaxZ = -Infinity;

  constructor(readonly cellsPerSide: number, readonly cellSize: number) {
    this.wet = new Uint8Array(cellsPerSide ** 2);
  }

  get activeCellCount(): number {
    return this.active.size;
  }

  /** Follows the deformation window's world-cell origin; prints that leave it are dropped. */
  setOrigin(minX: number, minZ: number): void {
    if (minX === this.minX && minZ === this.minZ) return;
    this.minX = minX;
    this.minZ = minZ;
    for (const [index, cell] of this.active) {
      if (this.inWindow(cell.cx, cell.cz)) continue;
      this.wet[index] = 0;
      this.active.delete(index);
      this.markDirty(cell.cx, cell.cz);
    }
  }

  /** One fixed slice: dries every print, then prints each tyre's path since the last slice. */
  advance(dt: number, contacts: readonly TerrainWetTrailContact[]): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.drySeconds += dt;
    if (this.drySeconds >= TERRAIN_WET_TRAIL_DRY_STEP_SECONDS) {
      this.dryRemainder += this.drySeconds * 255 / TERRAIN_WET_TRAIL_DRY_SECONDS;
      this.drySeconds = 0;
    }
    const dry = Math.floor(this.dryRemainder);
    if (dry > 0) {
      this.dryRemainder -= dry;
      for (const [index, cell] of this.active) {
        const value = this.wet[index]! - dry;
        this.wet[index] = Math.max(0, value);
        if (value <= 0) this.active.delete(index);
        this.markDirty(cell.cx, cell.cz);
      }
    }
    const seen = new Set<string>();
    for (const contact of contacts) {
      if (![contact.x, contact.z, contact.width].every(Number.isFinite) || contact.width <= 0) continue;
      seen.add(contact.id);
      const tyre = this.tyres.get(contact.id);
      if (contact.inWater) {
        this.tyres.set(contact.id, { x: contact.x, z: contact.z, water: 1, unseen: 0 });
        continue;
      }
      if (!tyre) continue;
      const distance = Math.hypot(contact.x - tyre.x, contact.z - tyre.z);
      const water = distance > TELEPORT_DISTANCE ? tyre.water : Math.max(0, tyre.water - distance / TERRAIN_WET_TRAIL_LENGTH);
      if (distance <= TELEPORT_DISTANCE && distance > 0) this.print(tyre, contact, tyre.water, water);
      if (water <= 0) {
        this.tyres.delete(contact.id);
        continue;
      }
      tyre.x = contact.x;
      tyre.z = contact.z;
      tyre.water = water;
      tyre.unseen = 0;
    }
    for (const [id, tyre] of this.tyres) {
      if (seen.has(id)) continue;
      tyre.unseen += dt;
      if (tyre.unseen > FORGET_SECONDS) this.tyres.delete(id);
    }
  }

  /** Conservative world-cell bounds, split at texture seams into at most 4 rectangles (as the field's). */
  takeDirty(): DeformationDirtyRect[] {
    if (this.dirtyMinX === Infinity) return [];
    const size = this.cellsPerSide;
    const split = (min: number, max: number): [number, number][] => {
      const length = Math.min(size, max - min + 1);
      if (length === size) return [[0, size]];
      const start = mod(min, size);
      const first = Math.min(length, size - start);
      return first === length ? [[start, first]] : [[start, first], [0, length - first]];
    };
    const rects: DeformationDirtyRect[] = [];
    for (const [x, width] of split(this.dirtyMinX, this.dirtyMaxX)) {
      for (const [y, height] of split(this.dirtyMinZ, this.dirtyMaxZ)) rects.push({ x, y, width, height });
    }
    this.dirtyMinX = this.dirtyMinZ = Infinity;
    this.dirtyMaxX = this.dirtyMaxZ = -Infinity;
    return rects;
  }

  /**
   * Discs every cell along the path, wetness fading from `from` to `to`. One
   * cell wider than the tyre's half width, so the render's tent filter keeps a
   * tyre-wide band at full strength; the square root keeps the print strong
   * until its last stretch rather than fading evenly.
   */
  private print(start: { x: number; z: number }, end: TerrainWetTrailContact, from: number, to: number): void {
    const size = this.cellSize;
    const radius = end.width / 2 + size;
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    const steps = Math.max(1, Math.ceil(length / size));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const x = start.x + (end.x - start.x) * t;
      const z = start.z + (end.z - start.z) * t;
      const value = Math.round(255 * TERRAIN_WET_TRAIL_STRENGTH * Math.sqrt(from + (to - from) * t));
      if (value <= 0) continue;
      const x0 = Math.floor((x - radius) / size), x1 = Math.floor((x + radius) / size);
      const z0 = Math.floor((z - radius) / size), z1 = Math.floor((z + radius) / size);
      for (let cz = z0; cz <= z1; cz += 1) for (let cx = x0; cx <= x1; cx += 1) {
        if (!this.inWindow(cx, cz) || ((cx + 0.5) * size - x) ** 2 + ((cz + 0.5) * size - z) ** 2 > radius ** 2) continue;
        const index = mod(cz, this.cellsPerSide) * this.cellsPerSide + mod(cx, this.cellsPerSide);
        if (this.wet[index]! >= value) continue;
        this.wet[index] = value;
        this.active.set(index, { cx, cz });
        this.markDirty(cx, cz);
      }
    }
  }

  private inWindow(cx: number, cz: number): boolean {
    return cx >= this.minX && cx < this.minX + this.cellsPerSide && cz >= this.minZ && cz < this.minZ + this.cellsPerSide;
  }

  private markDirty(cx: number, cz: number): void {
    this.dirtyMinX = Math.min(this.dirtyMinX, cx);
    this.dirtyMinZ = Math.min(this.dirtyMinZ, cz);
    this.dirtyMaxX = Math.max(this.dirtyMaxX, cx);
    this.dirtyMaxZ = Math.max(this.dirtyMaxZ, cz);
  }
}
