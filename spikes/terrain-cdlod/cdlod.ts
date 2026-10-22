import type { MinMaxPyramid } from "./worldGen";

/**
 * CDLOD quadtree selection (Strugar 2009), spike version of the planned
 * `engine/terrain/terrainLod.ts`. Coordinates are terrain-local: X/Z from the
 * terrain's min corner, Y absolute.
 *
 * Level 0 is the finest node (one patch over `leafSize`). A node at level `k`
 * is drawn when its box is inside `ranges[k]` but not inside `ranges[k - 1]`;
 * a child outside its own range is drawn at its size but fully morphed, i.e.
 * at the parent's resolution. Neighbour LODs then differ by at most one as
 * long as `range0` comfortably exceeds the leaf diagonal (default 4 × leaf).
 */

export interface CdlodBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface CdlodSettings {
  leafSize: number;
  levels: number;
  range0: number;
  /** Where morphing starts inside `[ranges[k-1], ranges[k]]`, 0..1. */
  morphStartRatio: number;
}

export interface CdlodVisit {
  level: number;
  ix: number;
  iz: number;
  box: CdlodBox;
  /** False when the node is drawn fully morphed (outside its own range). */
  inRange: boolean;
}

export function cdlodRanges(settings: CdlodSettings): number[] {
  const ranges: number[] = [];
  for (let k = 0; k < settings.levels; k += 1) {
    ranges.push(k === settings.levels - 1 ? Number.POSITIVE_INFINITY : settings.range0 * 2 ** k);
  }
  return ranges;
}

/** Per-level `[morphStart, morphEnd]` for the vertex shader. */
export function cdlodMorphRanges(settings: CdlodSettings): Array<[number, number]> {
  const ranges = cdlodRanges(settings);
  return ranges.map((range, k) => {
    if (!Number.isFinite(range)) return [1e9, 1e9 + 1];
    const prev = k > 0 ? ranges[k - 1]! : 0;
    // A hair inside the range so boundary vertices are fully morphed despite
    // float noise in the shader's distance.
    const end = range * 0.99;
    return [prev + (end - prev) * settings.morphStartRatio, end];
  });
}

function boxInSphere(box: CdlodBox, cx: number, cy: number, cz: number, radius: number): boolean {
  if (!Number.isFinite(radius)) return true;
  const dx = Math.max(box.minX - cx, 0, cx - box.maxX);
  const dy = Math.max(box.minY - cy, 0, cy - box.maxY);
  const dz = Math.max(box.minZ - cz, 0, cz - box.maxZ);
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

export class CdlodSelector {
  readonly ranges: number[];

  constructor(
    readonly settings: CdlodSettings,
    private readonly pyramid: MinMaxPyramid,
  ) {
    if (pyramid.levels.length < settings.levels) {
      throw new Error(`min/max pyramid has ${pyramid.levels.length} levels, need ${settings.levels}`);
    }
    this.ranges = cdlodRanges(settings);
  }

  nodeBox(level: number, ix: number, iz: number): CdlodBox {
    const size = this.settings.leafSize * 2 ** level;
    const grid = this.pyramid.levels[level]!;
    const i = iz * grid.n + ix;
    return {
      minX: ix * size,
      minZ: iz * size,
      maxX: (ix + 1) * size,
      maxZ: (iz + 1) * size,
      minY: grid.min[i]!,
      maxY: grid.max[i]!,
    };
  }

  /**
   * Walks the tree from the root and calls `emit` for every node to draw.
   * `visible` is the frustum test (main camera ∪ shadow camera).
   */
  select(
    camX: number,
    camY: number,
    camZ: number,
    visible: (box: CdlodBox) => boolean,
    emit: (visit: CdlodVisit) => void,
  ): void {
    const top = this.settings.levels - 1;
    const rootN = this.pyramid.levels[top]!.n;
    for (let iz = 0; iz < rootN; iz += 1) {
      for (let ix = 0; ix < rootN; ix += 1) {
        if (!this.visit(top, ix, iz, camX, camY, camZ, visible, emit)) {
          const box = this.nodeBox(top, ix, iz);
          if (visible(box)) emit({ level: top, ix, iz, box, inRange: false });
        }
      }
    }
  }

  private visit(
    level: number,
    ix: number,
    iz: number,
    cx: number,
    cy: number,
    cz: number,
    visible: (box: CdlodBox) => boolean,
    emit: (visit: CdlodVisit) => void,
  ): boolean {
    const box = this.nodeBox(level, ix, iz);
    if (!boxInSphere(box, cx, cy, cz, this.ranges[level]!)) return false;
    if (!visible(box)) return true;
    if (level === 0 || !boxInSphere(box, cx, cy, cz, this.ranges[level - 1]!)) {
      emit({ level, ix, iz, box, inRange: true });
      return true;
    }
    for (let c = 0; c < 4; c += 1) {
      const cix = ix * 2 + (c & 1);
      const ciz = iz * 2 + (c >> 1);
      if (!this.visit(level - 1, cix, ciz, cx, cy, cz, visible, emit)) {
        const childBox = this.nodeBox(level - 1, cix, ciz);
        if (visible(childBox)) emit({ level: level - 1, ix: cix, iz: ciz, box: childBox, inRange: false });
      }
    }
    return true;
  }
}
