import type { Vec3 } from "../scene/layout";

/** The rendered mean ribbon, in a fixed local frame. Dry bed and real holes stay excluded. */
export interface RiverSurfaceData {
  positions: ArrayLike<number>; indices: ArrayLike<number>; bedDepths: ArrayLike<number>;
  flowDirections: ArrayLike<number>; flowSpeedMultipliers: ArrayLike<number>;
}
export class RiverSurfaceQuery {
  readonly min: [number, number] = [Infinity, Infinity];
  readonly max: [number, number] = [-Infinity, -Infinity];
  readonly levels: [number, number] = [Infinity, -Infinity];
  readonly spacing: number;
  readonly nx: number;
  readonly nz: number;
  readonly offsets: Uint32Array;
  readonly triangles: Uint32Array;
  constructor(readonly data: RiverSurfaceData, readonly origin: Vec3 = [0, 0, 0]) {
    const p = data.positions;
    if (data.indices.length / 3 > 131072) throw new Error("over-budget: River effects exceed 131072 surface triangles");
    for (let i = 0; i < p.length; i += 3) {
      this.min[0] = Math.min(this.min[0], p[i]!); this.min[1] = Math.min(this.min[1], p[i + 2]!);
      this.max[0] = Math.max(this.max[0], p[i]!); this.max[1] = Math.max(this.max[1], p[i + 2]!);
      this.levels[0] = Math.min(this.levels[0], p[i + 1]!); this.levels[1] = Math.max(this.levels[1], p[i + 1]!);
    }
    if (!p.length || ![...this.min, ...this.max, ...this.levels].every(Number.isFinite)) throw new Error("River effects require a finite surface");
    this.spacing = Math.max(.25, Math.sqrt((this.max[0] - this.min[0]) * (this.max[1] - this.min[1]) / 16384));
    this.nx = Math.max(1, Math.ceil((this.max[0] - this.min[0]) / this.spacing));
    this.nz = Math.max(1, Math.ceil((this.max[1] - this.min[1]) / this.spacing));
    if (this.nx * this.nz > 65536) throw new Error("over-budget: River effects spatial grid exceeds 65536 cells");
    const counts = new Uint32Array(this.nx * this.nz);
    const visit = (fn: (cell: number, triangle: number) => void) => {
      for (let t = 0; t < data.indices.length / 3; t++) {
        const ids = [data.indices[t * 3]!, data.indices[t * 3 + 1]!, data.indices[t * 3 + 2]!];
        if (ids.every(i => data.bedDepths[i]! <= 0)) continue;
        const xs = ids.map(i => p[i * 3]!), zs = ids.map(i => p[i * 3 + 2]!);
        const x0 = Math.max(0, Math.floor((Math.min(...xs) - this.min[0]) / this.spacing));
        const x1 = Math.min(this.nx - 1, Math.floor((Math.max(...xs) - this.min[0]) / this.spacing));
        const z0 = Math.max(0, Math.floor((Math.min(...zs) - this.min[1]) / this.spacing));
        const z1 = Math.min(this.nz - 1, Math.floor((Math.max(...zs) - this.min[1]) / this.spacing));
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) fn(z * this.nx + x, t);
      }
    };
    let references = 0;
    visit(cell => { if (++counts[cell]! > 64 || ++references > 524288) throw new Error("over-budget: River effects spatial references exceeded"); });
    this.offsets = new Uint32Array(counts.length + 1);
    for (let i = 0; i < counts.length; i++) this.offsets[i + 1] = this.offsets[i]! + counts[i]!;
    this.triangles = new Uint32Array(references); counts.fill(0);
    visit((cell, triangle) => { this.triangles[this.offsets[cell]! + counts[cell]!] = triangle; counts[cell] = counts[cell]! + 1; });
  }
  barycentric(t: number, x: number, z: number): [number, number, number] | null {
    const { positions: p, indices } = this.data;
    const a = indices[t * 3]! * 3, b = indices[t * 3 + 1]! * 3, c = indices[t * 3 + 2]! * 3;
    const bx = p[b]! - p[a]!, bz = p[b + 2]! - p[a + 2]!, cx = p[c]! - p[a]!, cz = p[c + 2]! - p[a + 2]!;
    const det = bx * cz - bz * cx; if (Math.abs(det) < 1e-12) return null;
    const u = ((x - p[a]!) * cz - (z - p[a + 2]!) * cx) / det;
    const v = (bx * (z - p[a + 2]!) - bz * (x - p[a]!)) / det;
    return [1 - u - v, u, v];
  }
  candidates(minX: number, minZ: number, maxX: number, maxZ: number): number[] {
    const result = new Set<number>();
    const x0 = Math.max(0, Math.floor((minX - this.min[0]) / this.spacing)), x1 = Math.min(this.nx - 1, Math.floor((maxX - this.min[0]) / this.spacing));
    const z0 = Math.max(0, Math.floor((minZ - this.min[1]) / this.spacing)), z1 = Math.min(this.nz - 1, Math.floor((maxZ - this.min[1]) / this.spacing));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const cell = z * this.nx + x;
      for (let i = this.offsets[cell]!; i < this.offsets[cell + 1]!; i++) result.add(this.triangles[i]!);
    }
    return [...result];
  }
  sampleAt(x: number, z: number) {
    x -= this.origin[0]; z -= this.origin[2];
    const { data } = this;
    for (const t of this.candidates(x, z, x, z)) {
      const weights = this.barycentric(t, x, z); if (!weights || weights.some(w => w < -1e-7)) continue;
      let depth = 0, level = this.origin[1], flowX = 0, flowZ = 0, multiplier = 0;
      for (let k = 0; k < 3; k++) {
        const i = data.indices[t * 3 + k]!, w = weights[k]!;
        depth += data.bedDepths[i]! * w; level += data.positions[i * 3 + 1]! * w;
        flowX += data.flowDirections[i * 2]! * w; flowZ += data.flowDirections[i * 2 + 1]! * w;
        multiplier += data.flowSpeedMultipliers[i]! * w;
      }
      if (depth > 1e-5) return { depth, level, flowX, flowZ, multiplier };
    }
    return null;
  }
  depthAt(x: number, z: number): number | null { return this.sampleAt(x, z)?.depth ?? null; }
}
