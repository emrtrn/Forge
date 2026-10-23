import type { PhysicsAabb, PhysicsSurfaceTriangle } from "../behavior/behaviorSubsystem";
import type { NavigationRole } from "../scene/collision";
import type { ColliderHeightfield } from "../scene/components";
import type { Vec3 } from "../scene/layout";
import { rotatePointAboutOrigin } from "./rotatedBox";
import { STATIC_INDEX_CELL_SIZE, staticCellRange, type StaticSpatialEntry } from "./staticSpatialIndex";
import { classifyStaticTriangle } from "./staticTriangles";

/**
 * Static triangles of a heightfield collider, produced on demand (OPEN_WORLD_PLAN
 * Faz 3). A 257² terrain tile is ~131 k triangles; as a trimesh every one of
 * them was classified, boxed and filed into the static index at load. A
 * heightfield body instead answers the same index queries from its grid: the
 * triangles of one 4 m index cell are built when first asked for (and cached),
 * and the full lists only when a consumer asks for every static triangle
 * (navigation). Each triangle carries the same world vertices, classification,
 * cell membership and relative order as the trimesh it replaces, so movement
 * and navigation see identical results (engine parity test).
 */

/** Body-local position of sample (x, z): the grid is centred on the body in X/Z. */
export function heightfieldLocalVertex(field: ColliderHeightfield, x: number, z: number): Vec3 {
  return [
    x * field.spacing - (field.quadsX * field.spacing) / 2,
    field.heights[z * (field.quadsX + 1) + x]!,
    z * field.spacing - (field.quadsZ * field.spacing) / 2,
  ];
}

/**
 * Visits the triangles of quads `[qx0, qx1] × [qz0, qz1]` (inclusive, clamped)
 * in trimesh index order: rows of Z, then X, two triangles per quad —
 * (x,z)(x,z+1)(x+1,z) then (x+1,z)(x,z+1)(x+1,z+1). `index` is the triangle's
 * position in that order over the whole grid.
 */
export function forEachHeightfieldTriangle(
  field: ColliderHeightfield,
  qx0: number,
  qx1: number,
  qz0: number,
  qz1: number,
  visit: (a: Vec3, b: Vec3, c: Vec3, index: number) => void,
): void {
  const x0 = Math.max(0, qx0);
  const x1 = Math.min(field.quadsX - 1, qx1);
  const z0 = Math.max(0, qz0);
  const z1 = Math.min(field.quadsZ - 1, qz1);
  for (let z = z0; z <= z1; z += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const a = heightfieldLocalVertex(field, x, z);
      const b = heightfieldLocalVertex(field, x + 1, z);
      const c = heightfieldLocalVertex(field, x, z + 1);
      const d = heightfieldLocalVertex(field, x + 1, z + 1);
      const index = 2 * (z * field.quadsX + x);
      visit(a, c, b, index);
      visit(b, c, d, index + 1);
    }
  }
}

/**
 * A heightfield answers queries on demand only when its triangles map onto
 * index cells the cheap way: unrotated body (world quads stay axis-aligned) and
 * quads small enough that no triangle lands in the index's overflow list.
 * Anything else is expanded into ordinary index entries at load.
 */
export function heightfieldSupportsOnDemand(field: ColliderHeightfield, rotation: Vec3): boolean {
  return rotation.every((value) => value === 0) && field.spacing <= 8 * STATIC_INDEX_CELL_SIZE;
}

type Entry<T> = StaticSpatialEntry<T>;

export interface HeightfieldCellEntries {
  blockers: Entry<PhysicsAabb>[];
  surfaces: Entry<PhysicsSurfaceTriangle>[];
  /** `surfaces` values, ready to hand out when this cell is a query's only source. */
  surfaceValues: readonly PhysicsSurfaceTriangle[];
}

/** Cells kept per source before the cache starts over; ~72 triangles each at 1 m spacing. */
const MAX_CACHED_CELLS = 4096;

export class HeightfieldStaticSource {
  /** World X/Z bounds of the whole field. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  private readonly cells = new Map<string, HeightfieldCellEntries>();
  private everything: { blockers: PhysicsAabb[]; surfaces: PhysicsSurfaceTriangle[] } | null = null;

  /**
   * `itemOffset` places this field after the body's other primitives in the
   * index's item order (blockers and surfaces are counted separately).
   */
  constructor(
    private readonly origin: Vec3,
    private readonly field: ColliderHeightfield,
    private readonly navigationRole: NavigationRole | undefined,
    readonly bodyOrder: number,
    private readonly itemOffset: { blockers: number; surfaces: number },
  ) {
    const halfX = (field.quadsX * field.spacing) / 2;
    const halfZ = (field.quadsZ * field.spacing) / 2;
    this.minX = origin[0] - halfX;
    this.maxX = origin[0] + halfX;
    this.minZ = origin[2] - halfZ;
    this.maxZ = origin[2] + halfZ;
  }

  /** Whether the inclusive X/Z square can touch this field at all. */
  overlapsSquare(x: number, z: number, radius: number): boolean {
    return this.minX <= x + radius && this.maxX >= x - radius && this.minZ <= z + radius && this.maxZ >= z - radius;
  }

  /** Whether index cell (cx, cz) can hold any of this field's triangles. */
  touchesCell(cx: number, cz: number): boolean {
    const size = STATIC_INDEX_CELL_SIZE;
    return this.minX <= (cx + 1) * size && this.maxX >= cx * size && this.minZ <= (cz + 1) * size && this.maxZ >= cz * size;
  }

  /** Entries the static index would file under cell (cx, cz), in item order. */
  cellEntries(cx: number, cz: number): HeightfieldCellEntries {
    const key = `${cx},${cz}`;
    const cached = this.cells.get(key);
    if (cached) return cached;
    const entries = { blockers: [] as Entry<PhysicsAabb>[], surfaces: [] as Entry<PhysicsSurfaceTriangle>[] };
    if (this.touchesCell(cx, cz)) {
      const size = STATIC_INDEX_CELL_SIZE;
      const { spacing } = this.field;
      // One quad of margin; the exact membership test below decides.
      const qx0 = Math.floor((cx * size - this.minX) / spacing) - 1;
      const qx1 = Math.floor(((cx + 1) * size - this.minX) / spacing) + 1;
      const qz0 = Math.floor((cz * size - this.minZ) / spacing) - 1;
      const qz1 = Math.floor(((cz + 1) * size - this.minZ) / spacing) + 1;
      this.visit(qx0, qx1, qz0, qz1, (entry, kind) => {
        const range = staticCellRange(entry);
        if (!range || range.minX > cx || range.maxX < cx || range.minZ > cz || range.maxZ < cz) return;
        if (kind === "surface") entries.surfaces.push(entry as Entry<PhysicsSurfaceTriangle>);
        else entries.blockers.push(entry as Entry<PhysicsAabb>);
      });
    }
    const cell: HeightfieldCellEntries = { ...entries, surfaceValues: entries.surfaces.map((entry) => entry.value) };
    if (this.cells.size >= MAX_CACHED_CELLS) this.cells.clear();
    this.cells.set(key, cell);
    return cell;
  }

  /** Every triangle, classified, in item order — for consumers that read all static geometry. */
  all(): { blockers: PhysicsAabb[]; surfaces: PhysicsSurfaceTriangle[] } {
    if (this.everything) return this.everything;
    const everything = { blockers: [] as PhysicsAabb[], surfaces: [] as PhysicsSurfaceTriangle[] };
    this.visit(0, this.field.quadsX - 1, 0, this.field.quadsZ - 1, (entry, kind) => {
      if (kind === "surface") everything.surfaces.push(entry.value as PhysicsSurfaceTriangle);
      else everything.blockers.push(entry.value as PhysicsAabb);
    });
    this.everything = everything;
    return everything;
  }

  private visit(
    qx0: number,
    qx1: number,
    qz0: number,
    qz1: number,
    emit: (entry: Entry<PhysicsAabb | PhysicsSurfaceTriangle>, kind: "surface" | "blocker") => void,
  ): void {
    const rotation: Vec3 = [0, 0, 0];
    forEachHeightfieldTriangle(this.field, qx0, qx1, qz0, qz1, (la, lb, lc, index) => {
      const wa = rotatePointAboutOrigin(this.origin, la, rotation);
      const wb = rotatePointAboutOrigin(this.origin, lb, rotation);
      const wc = rotatePointAboutOrigin(this.origin, lc, rotation);
      const classified = classifyStaticTriangle(wa, wb, wc, this.navigationRole);
      if ("surface" in classified) {
        const { a, b, c } = classified.surface;
        emit({
          value: classified.surface, bodyOrder: this.bodyOrder, itemOrder: this.itemOffset.surfaces + index,
          minX: Math.min(a[0], b[0], c[0]), maxX: Math.max(a[0], b[0], c[0]),
          minZ: Math.min(a[2], b[2], c[2]), maxZ: Math.max(a[2], b[2], c[2]),
        }, "surface");
      } else {
        const { min, max } = classified.blocker;
        emit({
          value: classified.blocker, bodyOrder: this.bodyOrder, itemOrder: this.itemOffset.blockers + index,
          minX: min[0], maxX: max[0], minZ: min[2], maxZ: max[2],
        }, "blocker");
      }
    });
  }
}
