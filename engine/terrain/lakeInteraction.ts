import type { VehicleWheelState } from "../physics/vehicle/vehicleTypes";
import type { LakeGeometry } from "./terrainLakeWater";
import { LAKE_WHEEL_RIPPLE_DEFAULTS } from "../scene/waterBody";
import { lakeWaveOffset, type LakeWaveParameters } from "./lakeWaves";

export const LAKE_MAX_RIPPLES = 24;
export const LAKE_RIPPLE_LIFETIME = LAKE_WHEEL_RIPPLE_DEFAULTS.wheelRippleLifetime;
const MAX_CONTACTS = 128;

/** Grid buckets reference the actual clipped mesh, not merely the wet source
 * face flags (a partially wet face also contains dry land). No terrain IO. */
export class LakeSurfaceQuery {
  private readonly heads: Int32Array;
  private readonly next: Int32Array;
  constructor(private readonly geometry: LakeGeometry) {
    const grid = geometry.coverage;
    this.heads = new Int32Array(grid ? grid.nx * grid.nz : 0).fill(-1);
    this.next = new Int32Array(geometry.indices.length / 3).fill(-1);
    if (!grid || geometry.status !== "ready") return;
    const { positions: p, indices, position } = geometry;
    for (let t = 0; t < this.next.length; t++) {
      const a = indices[t * 3]! * 3, b = indices[t * 3 + 1]! * 3, c = indices[t * 3 + 2]! * 3;
      const x = Math.floor(((p[a]! + p[b]! + p[c]!) / 3 + position[0] - grid.min[0]) / grid.spacing);
      const z = Math.floor(((p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3 + position[2] - grid.min[1]) / grid.spacing);
      if (x < 0 || z < 0 || x >= grid.nx || z >= grid.nz) continue;
      const cell = z * grid.nx + x;
      this.next[t] = this.heads[cell]!; this.heads[cell] = t;
    }
  }
  /** Returns vertical depth only inside the connected, clipped wet surface. */
  depthAt(x: number, z: number): number | null {
    return this.sampleAt(x, z)?.depth ?? null;
  }
  /** Match GPU vertex displacement followed by triangle interpolation exactly;
   * evaluating the continuous wave at the wheel would disagree on coarse grids. */
  offsetAt(x: number, z: number, time: number, parameters: LakeWaveParameters): number | null {
    const sample = this.sampleAt(x, z); if (!sample) return null;
    const g = this.geometry;
    const offset = (i: number) => lakeWaveOffset(g.positions[i * 3]!, g.positions[i * 3 + 2]!, g.depths[i]!, time, parameters);
    return offset(sample.ia) * (1 - sample.u - sample.v) + offset(sample.ib) * sample.u + offset(sample.ic) * sample.v;
  }
  private sampleAt(x: number, z: number): { depth: number; ia: number; ib: number; ic: number; u: number; v: number } | null {
    const g = this.geometry, grid = g.coverage;
    if (!grid || g.status !== "ready" || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    const cx = Math.floor((x - grid.min[0]) / grid.spacing), cz = Math.floor((z - grid.min[1]) / grid.spacing);
    if (cx < 0 || cz < 0 || cx >= grid.nx || cz >= grid.nz) return null;
    x -= g.position[0]; z -= g.position[2];
    const p = g.positions;
    for (let t = this.heads[cz * grid.nx + cx]!; t >= 0; t = this.next[t]!) {
      const ia = g.indices[t * 3]!, ib = g.indices[t * 3 + 1]!, ic = g.indices[t * 3 + 2]!;
      const a = ia * 3, b = ib * 3, c = ic * 3;
      const bx = p[b]! - p[a]!, bz = p[b + 2]! - p[a + 2]!;
      const cx = p[c]! - p[a]!, cz = p[c + 2]! - p[a + 2]!;
      const dx = x - p[a]!, dz = z - p[a + 2]!, det = bx * cz - bz * cx;
      const u = (dx * cz - dz * cx) / det, v = (bx * dz - bz * dx) / det;
      if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) continue;
      const depth = g.depths[ia]! * (1 - u - v) + g.depths[ib]! * u + g.depths[ic]! * v;
      if (depth > 1e-5) return { depth, ia, ib, ic, u, v };
    }
    return null;
  }
}

export interface LakeWheelContact { id: string; x: number; y: number; z: number; rotation: number; radius: number; tractionSlip?: number }
export interface LakeRipple { x: number; z: number; age: number; strength: number }

/** World-space tyre volume versus the water plane. Ground contact is optional:
 * a hanging wheel can cut water; a submerged wheel cannot agitate its surface. */
export function lakeWheelContact(id: string, wheel: VehicleWheelState, width: number,
  level: number, query: LakeSurfaceQuery, waves?: { time: number; parameters: LakeWaveParameters }): LakeWheelContact | null {
  const centre = wheel.worldCenter, axle = wheel.worldAxle;
  if (!centre || !axle || ![...centre, ...axle, width, level, wheel.radius, wheel.rotation, wheel.tractionSlip ?? 0].every(Number.isFinite)
    || wheel.radius <= 0 || width <= 0) return null;
  if (Math.abs(Math.hypot(...axle) - 1) > 1e-4) return null;
  const ay = axle[1], vertical = Math.sqrt(Math.max(0, 1 - ay * ay));
  let waterLevel = level;
  if (waves) {
    const offset = query.offsetAt(centre[0], centre[2], waves.time, waves.parameters);
    if (offset === null) return null;
    waterLevel += offset;
  }
  const extent = wheel.radius * vertical + width * .5 * Math.abs(ay);
  let x = centre[0], z = centre[2];
  // A tilted tyre's plane intersection can shift horizontally. Re-sample the
  // local water height there, with a bounded refinement rather than a flat mean plane.
  for (let iteration = 0; iteration < (waves ? 4 : 1); iteration++) {
    const height = waterLevel - centre[1];
    if (Math.abs(height) >= extent - 1e-5) return null;
    // Find a point in the cylinder/plane intersection, including rolled tyres.
    // Projecting the centre onto the plane alone can lie outside a tilted tyre.
    let along = Math.max(-width * .5, Math.min(width * .5, height * ay));
    let radial = vertical > 1e-6 ? (height - ay * along) / vertical : 0;
    if (Math.abs(radial) > wheel.radius) {
      radial = Math.max(-wheel.radius, Math.min(wheel.radius, radial));
      along = (height - vertical * radial) / ay;
    }
    const offset = along - (vertical > 1e-6 ? ay * radial / vertical : 0);
    x = centre[0] + axle[0] * offset; z = centre[2] + axle[2] * offset;
    if (query.depthAt(x, z) === null) return null;
    if (!waves) break;
    const next = query.offsetAt(x, z, waves.time, waves.parameters);
    if (next === null) return null;
    const nextLevel = level + next;
    if (Math.abs(nextLevel - waterLevel) < 1e-6) break;
    waterLevel = nextLevel;
  }
  return { id, x, y: centre[1], z, rotation: wheel.rotation, radius: wheel.radius,
    ...(wheel.tractionSlip === undefined ? {} : { tractionSlip: wheel.tractionSlip }) };
}

/** Per-Lake transient presentation. Stable ids, fixed-step energy, bounded
 * history/cooldown and no soil, mud-mask, physics or persistence writes. */
export class LakeRippleState {
  readonly ripples: LakeRipple[] = [];
  private previous = new Map<string, { contact: LakeWheelContact; cooldown: number }>();
  private limit = LAKE_MAX_RIPPLES;
  constructor(private readonly settings: typeof LAKE_WHEEL_RIPPLE_DEFAULTS = LAKE_WHEEL_RIPPLE_DEFAULTS) {}
  setLimit(limit: number): void {
    this.limit = Number.isFinite(limit) ? Math.max(0, Math.min(LAKE_MAX_RIPPLES, Math.floor(limit))) : LAKE_MAX_RIPPLES;
    if (this.ripples.length > this.limit) this.ripples.splice(0, this.ripples.length - this.limit);
  }
  advance(dt: number, contacts: readonly LakeWheelContact[]): void {
    if (!this.settings.wheelRipplesEnabled || this.settings.wheelRippleStrength <= 0) { this.clear(); return; }
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]!; r.age += dt;
      if (r.age >= this.settings.wheelRippleLifetime) this.ripples.splice(i, 1);
    }
    const next = new Map<string, { contact: LakeWheelContact; cooldown: number }>();
    for (const c of contacts.slice(0, MAX_CONTACTS)) {
      if (next.has(c.id) || ![c.x, c.y, c.z, c.rotation, c.radius, c.tractionSlip ?? 0].every(Number.isFinite) || c.radius <= 0) continue;
      const old = this.previous.get(c.id), p = old?.contact;
      const distance = p ? Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z) : 0;
      const continuous = !!p && distance <= 2 && dt <= .1;
      const spin = continuous && c.tractionSlip === undefined ? Math.abs(c.rotation - p!.rotation) * c.radius : 0;
      const energy = continuous ? Math.min(1, Math.max(distance / dt / 6, spin / dt / 6,
        Math.max(0, Math.min(1, c.tractionSlip ?? 0)) * .6)) : 0;
      let cooldown = Math.max(0, (old?.cooldown ?? 0) - dt);
      if (energy > .02 && cooldown <= 1e-8) {
        this.ripples.push({ x: c.x, z: c.z, age: 0, strength: energy }); cooldown = this.settings.wheelRippleInterval;
      }
      next.set(c.id, { contact: { ...c }, cooldown });
    }
    this.previous = next;
    if (this.ripples.length > this.limit) this.ripples.splice(0, this.ripples.length - this.limit);
  }
  clear(): void { this.ripples.length = 0; this.previous.clear(); }
}
