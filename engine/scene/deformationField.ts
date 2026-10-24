/**
 * CPU-authoritative, world-aligned track field; independent of rendering/physics.
 * Stamp depths come from `sinkage` (`engine/physics/surface/sinkage.ts`).
 */

/** Channel 0: metres × 10,000 (0.1 mm steps, saturating at 6.5535 m). */
export const DEFORMATION_DEPTH_SCALE = 10_000;
const MAX_DEPTH_UNITS = 65_535;
/**
 * Per-cell refill ({@link DeformationField.recover}) runs in whole steps of this
 * length, so a rate in mm/s always removes an integer number of depth units.
 */
export const DEFORMATION_RECOVERY_STEP_SECONDS = 0.4;
/** At most this many recovery steps per call: a long pause never becomes one big refill spike. */
const MAX_RECOVERY_STEPS_PER_CALL = 3;

export interface DeformationFieldOptions {
  readonly windowSize?: number;
  readonly cellSize?: number;
  /** Called before active cells leave the window; world cell centres, depth in metres. */
  readonly onEvictCell?: DeformationCellVisitor;
}

export type DeformationCellVisitor = (worldX: number, worldZ: number, depth: number, disturbance: number) => void;

export interface DeformationSample {
  readonly depth: number;
  /** Channel 1 uses byte units (0..255), including stamp inputs and samples. */
  readonly disturbance: number;
}

export interface DeformationDirtyRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WheelDeformationStamp {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly width: number;
  readonly contactLength: number;
  /** Radians from +Z towards +X; omitted means travel direction (stationary: +Z). */
  readonly heading?: number;
  readonly targetDepth: number;
  readonly compaction: number;
  readonly disturbance: number;
  /** Refill rate (m/s) the touched cells keep for {@link DeformationField.recover}; 0/absent never refills. */
  readonly recoveryRate?: number;
}

const mod = (value: number, size: number): number => ((value % size) + size) % size;
const clamp = (value: number, max: number): number => Number.isFinite(value) ? Math.max(0, Math.min(value, max)) : 0;

/**
 * Cell (cx, cz) occupies [cx*s, (cx+1)*s) × [cz*s, (cz+1)*s), sampled at its
 * centre and stored at mod(cz, N)*N + mod(cx, N). The window starts centred on
 * world zero and recentres in whole cells. Public channel arrays are upload
 * views: callers must not mutate them. Default channel storage is 1 MiB
 * (depth 512 KiB, disturbance and per-cell recovery rate 256 KiB each).
 */
export class DeformationField {
  readonly windowSize: number;
  readonly cellSize: number;
  readonly cellsPerSide: number;
  readonly depth: Uint16Array;
  readonly disturbance: Uint8Array;
  /** Per-cell refill rate in mm/s (0..255), set by the stamp that last changed the cell. */
  readonly recovery: Uint8Array;
  private minX: number;
  private minZ: number;
  private readonly active = new Set<number>();
  private dirtyMinX = Infinity;
  private dirtyMinZ = Infinity;
  private dirtyMaxX = -Infinity;
  private dirtyMaxZ = -Infinity;
  private depthRecoveryRemainder = 0;
  private disturbanceRecoveryRemainder = 0;
  private recoverySeconds = 0;
  private readonly onEvictCell: DeformationCellVisitor | undefined;

  constructor(options: DeformationFieldOptions = {}) {
    this.onEvictCell = options.onEvictCell;
    this.windowSize = options.windowSize ?? 64;
    this.cellSize = options.cellSize ?? 0.125;
    const size = this.windowSize / this.cellSize;
    this.cellsPerSide = Math.round(size);
    if (!Number.isFinite(this.windowSize) || this.windowSize <= 0
      || !Number.isFinite(this.cellSize) || this.cellSize <= 0
      || !Number.isSafeInteger(this.cellsPerSide) || this.cellsPerSide < 1
      || Math.abs(size - this.cellsPerSide) > 1e-8
      || this.cellsPerSide ** 2 > 0xffff_ffff) {
      throw new RangeError("Deformation window must contain a positive integer number of cells per side");
    }
    this.depth = new Uint16Array(this.cellsPerSide ** 2);
    this.disturbance = new Uint8Array(this.cellsPerSide ** 2);
    this.recovery = new Uint8Array(this.cellsPerSide ** 2);
    this.minX = this.minZ = -Math.floor(this.cellsPerSide / 2);
    this.markDirty(this.minX, this.minZ, this.cellsPerSide, this.cellsPerSide);
  }

  /** Clears entering strips without shifting storage; dirty regions accumulate. */
  recenter(worldX: number, worldZ: number): void {
    const size = this.cellsPerSide;
    const nextX = Math.floor(worldX / this.cellSize) - Math.floor(size / 2);
    const nextZ = Math.floor(worldZ / this.cellSize) - Math.floor(size / 2);
    if (![nextX, nextZ, nextX + size, nextZ + size].every(Number.isSafeInteger)) {
      throw new RangeError("Deformation centre must have finite, safe world-cell coordinates");
    }
    const dx = nextX - this.minX;
    const dz = nextZ - this.minZ;
    if (dx === 0 && dz === 0) return;
    if (this.onEvictCell) {
      for (const index of this.active) {
        const cx = this.minX + mod(index % size - this.minX, size);
        const cz = this.minZ + mod(Math.floor(index / size) - this.minZ, size);
        if (cx < nextX || cx >= nextX + size || cz < nextZ || cz >= nextZ + size) {
          this.onEvictCell((cx + 0.5) * this.cellSize, (cz + 0.5) * this.cellSize,
            this.depth[index]! / DEFORMATION_DEPTH_SCALE, this.disturbance[index]!);
        }
      }
    }
    if (Math.abs(dx) >= size || Math.abs(dz) >= size) {
      this.depth.fill(0);
      this.disturbance.fill(0);
      this.active.clear();
      this.markDirty(nextX, nextZ, size, size);
    } else {
      if (dx !== 0) this.clearRegion(dx > 0 ? this.minX + size : nextX, nextZ, Math.abs(dx), size);
      const overlapX = Math.max(this.minX, nextX);
      if (dz !== 0) this.clearRegion(overlapX, dz > 0 ? this.minZ + size : nextZ, size - Math.abs(dx), Math.abs(dz));
    }
    this.minX = nextX;
    this.minZ = nextZ;
    if (this.active.size === 0) this.resetRecovery();
  }

  /** Bilinear depth at cell centres, edge-clamped inside the half-open window. */
  sample(worldX: number, worldZ: number): DeformationSample {
    const cx = worldX / this.cellSize;
    const cz = worldZ / this.cellSize;
    const size = this.cellsPerSide;
    if (!Number.isFinite(cx) || !Number.isFinite(cz)
      || cx < this.minX || cx >= this.minX + size || cz < this.minZ || cz >= this.minZ + size) {
      return { depth: 0, disturbance: 0 };
    }
    const x = Math.max(this.minX, Math.min(cx - 0.5, this.minX + size - 1));
    const z = Math.max(this.minZ, Math.min(cz - 0.5, this.minZ + size - 1));
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = Math.min(x0 + 1, this.minX + size - 1);
    const z1 = Math.min(z0 + 1, this.minZ + size - 1);
    const a = this.depth[this.index(x0, z0)]! * (1 - (x - x0)) + this.depth[this.index(x1, z0)]! * (x - x0);
    const b = this.depth[this.index(x0, z1)]! * (1 - (x - x0)) + this.depth[this.index(x1, z1)]! * (x - x0);
    return {
      depth: (a * (1 - (z - z0)) + b * (z - z0)) / DEFORMATION_DEPTH_SCALE,
      disturbance: this.disturbance[this.index(Math.floor(cx), Math.floor(cz))]!,
    };
  }

  /**
   * Exact fixed-heading rectangle swept along the contact segment. Each covered
   * cell centre receives one max-lerp per call, regardless of segment length.
   * Returns candidate cells visited, for deterministic work-budget checks.
   */
  stampWheel(stamp: WheelDeformationStamp): number {
    const [fx, fz] = stamp.from;
    const [tx, tz] = stamp.to;
    const dx = tx - fx;
    const dz = tz - fz;
    const heading = stamp.heading ?? (dx === 0 && dz === 0 ? 0 : Math.atan2(dx, dz));
    if (![fx, fz, tx, tz, dx, dz, stamp.width, stamp.contactLength, heading].every(Number.isFinite)
      || stamp.width <= 0 || stamp.contactLength <= 0) return 0;
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    const halfWidth = stamp.width / 2;
    const halfLength = stamp.contactLength / 2;
    const extentX = Math.abs(cos) * halfWidth + Math.abs(sin) * halfLength;
    const extentZ = Math.abs(sin) * halfWidth + Math.abs(cos) * halfLength;
    const across = dx * cos - dz * sin;
    const along = dx * sin + dz * cos;
    return this.stampRegion(
      Math.min(fx, tx) - extentX, Math.min(fz, tz) - extentZ,
      Math.max(fx, tx) + extentX, Math.max(fz, tz) + extentZ,
      stamp.targetDepth, stamp.compaction, stamp.disturbance, stamp.recoveryRate ?? 0,
      (x, z) => {
        const u = (x - fx) * cos - (z - fz) * sin;
        const v = (x - fx) * sin + (z - fz) * cos;
        let enter = 0;
        let exit = 1;
        // Segment/rectangle slab intersection in wheel-local coordinates.
        if (Math.abs(across) < 1e-12) {
          if (Math.abs(u) > halfWidth) return false;
        } else {
          const a = (u - halfWidth) / across;
          const b = (u + halfWidth) / across;
          enter = Math.max(enter, Math.min(a, b));
          exit = Math.min(exit, Math.max(a, b));
        }
        if (Math.abs(along) < 1e-12) {
          if (Math.abs(v) > halfLength) return false;
        } else {
          const a = (v - halfLength) / along;
          const b = (v + halfLength) / along;
          enter = Math.max(enter, Math.min(a, b));
          exit = Math.min(exit, Math.max(a, b));
        }
        return enter <= exit;
      },
    );
  }

  /** Generic full-compaction stamp by default; disturbance uses byte units. */
  stampDisc(worldPos: readonly [number, number], radius: number, depth: number, compaction = 1, disturbance = 255): number {
    const [x, z] = worldPos;
    if (![x, z, radius].every(Number.isFinite) || radius <= 0) return 0;
    return this.stampRegion(x - radius, z - radius, x + radius, z + radius, depth, compaction, disturbance, 0,
      (px, pz) => (px - x) ** 2 + (pz - z) ** 2 <= radius ** 2);
  }

  /**
   * Linear refill in m/s, visiting only active cells; returns the visited count.
   * Shared fractional carries preserve sub-quantum recovery across calls. Tint
   * clears when depth reaches zero; tint-only cells fade at 255 units per metre.
   */
  decay(dtSeconds: number, recoveryRate: number): number {
    if (!Number.isFinite(dtSeconds) || !Number.isFinite(recoveryRate)
      || dtSeconds <= 0 || recoveryRate <= 0 || this.active.size === 0) return 0;
    const metres = Math.min(dtSeconds * recoveryRate, MAX_DEPTH_UNITS / DEFORMATION_DEPTH_SCALE);
    const depthStep = this.depthRecoveryRemainder + metres * DEFORMATION_DEPTH_SCALE;
    const disturbanceStep = this.disturbanceRecoveryRemainder + metres * 255;
    const depthUnits = Math.floor(depthStep);
    const disturbanceUnits = Math.floor(disturbanceStep);
    this.depthRecoveryRemainder = depthStep - depthUnits;
    this.disturbanceRecoveryRemainder = disturbanceStep - disturbanceUnits;
    let visited = 0;
    for (const index of this.active) {
      visited += 1;
      const oldDepth = this.depth[index]!;
      const depth = Math.max(0, oldDepth - depthUnits);
      const disturbance = oldDepth > 0 ? (depth === 0 ? 0 : this.disturbance[index]!)
        : Math.max(0, this.disturbance[index]! - disturbanceUnits);
      if (depth !== oldDepth || disturbance !== this.disturbance[index]) {
        this.depth[index] = depth;
        this.disturbance[index] = disturbance;
        const x = this.minX + mod(index % this.cellsPerSide - this.minX, this.cellsPerSide);
        const z = this.minZ + mod(Math.floor(index / this.cellsPerSide) - this.minZ, this.cellsPerSide);
        this.markDirty(x, z, 1, 1);
      }
      if (depth === 0 && disturbance === 0) this.active.delete(index);
    }
    if (this.active.size === 0) this.resetRecovery();
    return visited;
  }

  /**
   * Refills each active cell at the rate its last stamp left (`recoveryRate`),
   * in whole {@link DEFORMATION_RECOVERY_STEP_SECONDS} steps so mm/s rates stay
   * exact; leftover time carries to the next call. A mud track (rate 0) stays
   * while a snow track beside it fills. Tint clears with the depth; tint-only
   * cells fade at 255 units per metre of refill, at least one unit a step.
   * Returns the cells visited.
   */
  recover(dtSeconds: number): number {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return 0;
    if (this.active.size === 0) {
      this.recoverySeconds = 0;
      return 0;
    }
    this.recoverySeconds += dtSeconds;
    const steps = Math.min(MAX_RECOVERY_STEPS_PER_CALL, Math.floor(this.recoverySeconds / DEFORMATION_RECOVERY_STEP_SECONDS));
    if (steps === 0) return 0;
    this.recoverySeconds = Math.min(this.recoverySeconds - steps * DEFORMATION_RECOVERY_STEP_SECONDS, DEFORMATION_RECOVERY_STEP_SECONDS);
    // mm/s × step seconds → metres → depth units: integral for the 0.4 s step.
    const unitsPerRate = steps * DEFORMATION_RECOVERY_STEP_SECONDS * DEFORMATION_DEPTH_SCALE / 1000;
    let visited = 0;
    for (const index of this.active) {
      visited += 1;
      const rate = this.recovery[index]!;
      if (rate === 0) continue;
      const oldDepth = this.depth[index]!;
      const depth = Math.max(0, oldDepth - Math.round(rate * unitsPerRate));
      const fade = Math.max(1, Math.round(rate * unitsPerRate * 255 / DEFORMATION_DEPTH_SCALE));
      const disturbance = oldDepth > 0 ? (depth === 0 ? 0 : this.disturbance[index]!)
        : Math.max(0, this.disturbance[index]! - fade);
      this.depth[index] = depth;
      this.disturbance[index] = disturbance;
      const x = this.minX + mod(index % this.cellsPerSide - this.minX, this.cellsPerSide);
      const z = this.minZ + mod(Math.floor(index / this.cellsPerSide) - this.minZ, this.cellsPerSide);
      this.markDirty(x, z, 1, 1);
      if (depth === 0 && disturbance === 0) {
        this.recovery[index] = 0;
        this.active.delete(index);
      }
    }
    if (this.active.size === 0) this.resetRecovery();
    return visited;
  }

  /** Conservative world-cell bounds, split at texture seams into at most 4 rectangles. */
  takeDirty(): DeformationDirtyRect[] {
    if (this.dirtyMinX === Infinity) return [];
    const split = (min: number, max: number): [number, number][] => {
      const size = this.cellsPerSide;
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

  stats(): { activeCellCount: number; maxDepth: number } {
    let max = 0;
    for (const index of this.active) max = Math.max(max, this.depth[index]!);
    return { activeCellCount: this.active.size, maxDepth: max / DEFORMATION_DEPTH_SCALE };
  }

  /** World-cell origin; channel arrays retain their toroidal storage order. */
  get originCell(): readonly [number, number] {
    return [this.minX, this.minZ];
  }

  /** Visits nonzero cells only. Visitors must not mutate or recenter the field. */
  forEachActiveCell(visit: DeformationCellVisitor): void {
    for (const index of this.active) {
      const x = this.minX + mod(index % this.cellsPerSide - this.minX, this.cellsPerSide);
      const z = this.minZ + mod(Math.floor(index / this.cellsPerSide) - this.minZ, this.cellsPerSide);
      visit((x + 0.5) * this.cellSize, (z + 0.5) * this.cellSize,
        this.depth[index]! / DEFORMATION_DEPTH_SCALE, this.disturbance[index]!);
    }
  }

  private index(x: number, z: number): number {
    return mod(z, this.cellsPerSide) * this.cellsPerSide + mod(x, this.cellsPerSide);
  }

  private markDirty(x: number, z: number, width: number, height: number): void {
    this.dirtyMinX = Math.min(this.dirtyMinX, x);
    this.dirtyMinZ = Math.min(this.dirtyMinZ, z);
    this.dirtyMaxX = Math.max(this.dirtyMaxX, x + width - 1);
    this.dirtyMaxZ = Math.max(this.dirtyMaxZ, z + height - 1);
  }

  private clearRegion(x: number, z: number, width: number, height: number): void {
    for (let cz = z; cz < z + height; cz += 1) {
      for (let cx = x; cx < x + width; cx += 1) {
        const index = this.index(cx, cz);
        this.depth[index] = this.disturbance[index] = this.recovery[index] = 0;
        this.active.delete(index);
      }
    }
    this.markDirty(x, z, width, height);
  }

  private resetRecovery(): void {
    this.depthRecoveryRemainder = this.disturbanceRecoveryRemainder = this.recoverySeconds = 0;
  }

  private stampRegion(
    minX: number, minZ: number, maxX: number, maxZ: number,
    depth: number, compaction: number, disturbance: number, recoveryRate: number,
    contains: (x: number, z: number) => boolean,
  ): number {
    const target = Math.floor(clamp(depth, MAX_DEPTH_UNITS / DEFORMATION_DEPTH_SCALE) * DEFORMATION_DEPTH_SCALE);
    const tint = Math.floor(clamp(disturbance, 255));
    const recovery = Math.round(clamp(recoveryRate * 1000, 255));
    const amount = clamp(compaction, 1);
    if (amount === 0 || (target === 0 && tint === 0)) return 0;
    const x0 = Math.max(this.minX, Math.ceil(minX / this.cellSize - 0.5));
    const z0 = Math.max(this.minZ, Math.ceil(minZ / this.cellSize - 0.5));
    const x1 = Math.min(this.minX + this.cellsPerSide - 1, Math.floor(maxX / this.cellSize - 0.5));
    const z1 = Math.min(this.minZ + this.cellsPerSide - 1, Math.floor(maxZ / this.cellSize - 0.5));
    let visited = 0;
    for (let z = z0; z <= z1; z += 1) {
      for (let x = x0; x <= x1; x += 1) {
        visited += 1;
        if (!contains((x + 0.5) * this.cellSize, (z + 0.5) * this.cellSize)) continue;
        const index = this.index(x, z);
        const oldDepth = this.depth[index]!;
        const oldTint = this.disturbance[index]!;
        // Floor quantisation cannot overshoot a target; convergence stops within one quantum / amount.
        const nextDepth = Math.max(oldDepth, Math.floor(oldDepth + (target - oldDepth) * amount));
        const nextTint = Math.max(oldTint, Math.floor(oldTint + (tint - oldTint) * amount));
        if (nextDepth === oldDepth && nextTint === oldTint) continue;
        this.depth[index] = nextDepth;
        this.disturbance[index] = nextTint;
        this.recovery[index] = recovery;
        this.active.add(index);
        this.markDirty(x, z, 1, 1);
      }
    }
    return visited;
  }
}
