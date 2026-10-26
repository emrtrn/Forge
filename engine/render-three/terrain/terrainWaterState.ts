/** Bounded, world-anchored presentation state. Never writes soil/vehicle state. */
export interface TerrainWaterContact {
  id: string;
  x: number;
  y: number;
  z: number;
  width: number;
  rotation: number;
  radius: number;
  wetness: number;
  /** Physics traction demand (0..1); authoritative when supplied by a vehicle. */
  tractionSlip?: number | undefined;
}

export interface TerrainWaterImpulse { x: number; z: number; radius: number; strength: number }
export interface TerrainWaterSite { x: number; z: number; y: number }
export interface TerrainWaterGroup {
  level: number;
  minX: number; minZ: number; maxX: number; maxZ: number;
  distance: number;
}

const mod = (n: number, size: number) => ((n % size) + size) % size;
export const TERRAIN_WATER_SIZE = 32;
export const TERRAIN_WATER_MASK_SIZE = 256;
export const TERRAIN_WATER_STEP = 1 / 60;
export const TERRAIN_WATER_MAX_IMPULSES = 64;

/** Bilinear RG8 depth lookup at world cell centres, matching the uploaded,
 * render-filtered field rather than the authoritative physics depth. */
export function terrainWaterRenderDepth(data: ArrayLike<number>, side: number, cell: number, range: number, x: number, z: number): number {
  const gx = x / cell - 0.5, gz = z / cell - 0.5;
  const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  const at = (cx: number, cz: number) => data[(mod(cz, side) * side + mod(cx, side)) * 2]!;
  return ((at(ix, iz) * (1 - fx) + at(ix + 1, iz) * fx) * (1 - fz)
    + (at(ix, iz + 1) * (1 - fx) + at(ix + 1, iz + 1) * fx) * fz) * range / 255;
}

export class TerrainWaterState {
  /** RGBA: wetness, undeformed world ground Y, reserved, reserved. */
  readonly mask = new Float32Array(TERRAIN_WATER_MASK_SIZE ** 2 * 4);
  readonly impulses: TerrainWaterImpulse[] = [];
  readonly sites = new Map<string, TerrainWaterSite>();
  readonly previous = new Map<string, TerrainWaterContact>();
  minX = -16;
  minZ = -16;
  revision = 0;
  seconds = 0;
  private time = 0;
  private readonly cell = TERRAIN_WATER_SIZE / TERRAIN_WATER_MASK_SIZE;

  advance(dt: number, contacts: readonly TerrainWaterContact[], centre: readonly [number, number]): void {
    if (!Number.isFinite(dt) || dt <= 0 || !centre.every(Number.isFinite)) return;
    this.seconds = Math.min(4 * TERRAIN_WATER_STEP, this.seconds + dt);
    this.time += dt;
    this.recenter(centre[0], centre[1]);
    const seen = new Set<string>();
    for (const contact of contacts) {
      if (![contact.x, contact.y, contact.z, contact.width, contact.rotation, contact.radius, contact.wetness].every(Number.isFinite)
        || (contact.tractionSlip !== undefined && !Number.isFinite(contact.tractionSlip))
        || contact.width <= 0 || contact.radius <= 0) continue;
      if (contact.x < this.minX || contact.x >= this.minX + 32 || contact.z < this.minZ || contact.z >= this.minZ + 32) continue;
      seen.add(contact.id);
      const old = this.previous.get(contact.id);
      this.previous.set(contact.id, { ...contact });
      const distance = old ? Math.hypot(contact.x - old.x, contact.z - old.z) : 0;
      const continuous = old && distance <= 2;
      const from = continuous ? old : contact;
      const steps = Math.max(1, Math.ceil((continuous ? distance : 0) / Math.max(0.06, contact.width * 0.4)));
      // Rapier's rotation can follow ground speed even while a tyre spins in
      // place. Match the surface FX's standstill agitation from physics slip;
      // retain angular travel only for providers without that signal. An
      // authoritative zero also suppresses rotation resets on a parked tyre.
      const slip = contact.tractionSlip === undefined ? undefined : Math.max(0, Math.min(1, contact.tractionSlip));
      const spin = continuous && slip === undefined ? Math.abs(contact.rotation - old.rotation) * contact.radius : 0;
      const energy = continuous ? Math.min(1, Math.max(Math.max(distance, spin) / dt / 6, (slip ?? 0) * 0.6)) : 0;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + (contact.x - from.x) * t;
        const z = from.z + (contact.z - from.z) * t;
        this.stamp(x, z, contact.width / 2 + this.cell, contact.wetness, contact.y);
        if (contact.wetness > 0.4 && energy > 0.005) {
          // A long stalled frame must not queue more energy than the four
          // fixed steps the GPU is allowed to catch up on.
          this.impulses.push({ x, z, radius: Math.max(0.15, contact.width * 0.7), strength: energy * Math.min(dt, 4 * TERRAIN_WATER_STEP) / steps * 0.12 });
        }
      }
      if (contact.wetness > 0.4) {
        const key = `${Math.floor(contact.x * 2)},${Math.floor(contact.z * 2)}`;
        this.sites.delete(key);
        this.sites.set(key, { x: contact.x, z: contact.z, y: contact.y });
      }
    }
    for (const id of this.previous.keys()) if (!seen.has(id)) this.previous.delete(id);
    if (this.impulses.length > TERRAIN_WATER_MAX_IMPULSES) this.impulses.splice(0, this.impulses.length - TERRAIN_WATER_MAX_IMPULSES);
    for (const [id, site] of this.sites) {
      if (site.x < this.minX || site.x >= this.minX + 32 || site.z < this.minZ || site.z >= this.minZ + 32) this.sites.delete(id);
    }
    while (this.sites.size > 256) this.sites.delete(this.sites.keys().next().value!);
  }

  /** Nearest horizontal films, grouped to 5 cm; never one capture per wheel. */
  groups(depthAt: (x: number, z: number) => number, x: number, z: number): TerrainWaterGroup[] {
    const groups = new Map<number, TerrainWaterGroup>();
    for (const site of this.sites.values()) {
      const depth = depthAt(site.x, site.z);
      if (depth < 0.03) continue;
      const level = Math.round((site.y - depth) / 0.05) * 0.05;
      const distance = (site.x - x) ** 2 + (site.z - z) ** 2;
      const group = groups.get(level);
      if (group) {
        group.minX = Math.min(group.minX, site.x - 0.5); group.maxX = Math.max(group.maxX, site.x + 0.5);
        group.minZ = Math.min(group.minZ, site.z - 0.5); group.maxZ = Math.max(group.maxZ, site.z + 0.5);
        group.distance = Math.min(group.distance, distance);
      } else groups.set(level, { level, minX: site.x - 0.5, maxX: site.x + 0.5, minZ: site.z - 0.5, maxZ: site.z + 0.5, distance });
    }
    return [...groups.values()].sort((a, b) => a.distance - b.distance || a.level - b.level).slice(0, 2);
  }

  clear(): void {
    this.mask.fill(0); this.impulses.length = 0; this.sites.clear(); this.previous.clear();
    this.seconds = 0; this.revision++; this.time = 0;
  }

  private recenter(x: number, z: number): void {
    const nextX = Math.floor(x / this.cell) - TERRAIN_WATER_MASK_SIZE / 2;
    const nextZ = Math.floor(z / this.cell) - TERRAIN_WATER_MASK_SIZE / 2;
    const oldX = Math.round(this.minX / this.cell), oldZ = Math.round(this.minZ / this.cell);
    if (nextX === oldX && nextZ === oldZ) return;
    const n = TERRAIN_WATER_MASK_SIZE;
    if (Math.abs(nextX - oldX) >= n || Math.abs(nextZ - oldZ) >= n) this.mask.fill(0);
    else {
      for (let cz = nextZ; cz < nextZ + n; cz++) {
        if (cz < oldZ || cz >= oldZ + n) {
          const row = mod(cz, n) * n * 4;
          this.mask.fill(0, row, row + n * 4);
        } else {
          const start = nextX < oldX ? nextX : oldX + n;
          const end = nextX < oldX ? oldX : nextX + n;
          for (let cx = start; cx < end; cx++) {
            const index = (mod(cz, n) * n + mod(cx, n)) * 4;
            this.mask.fill(0, index, index + 4);
          }
        }
      }
    }
    this.minX = nextX * this.cell; this.minZ = nextZ * this.cell; this.revision++;
  }

  private stamp(x: number, z: number, radius: number, wetness: number, y: number): void {
    const n = TERRAIN_WATER_MASK_SIZE;
    const minX = Math.max(Math.floor((x - radius) / this.cell), Math.round(this.minX / this.cell));
    const minZ = Math.max(Math.floor((z - radius) / this.cell), Math.round(this.minZ / this.cell));
    const maxX = Math.min(Math.floor((x + radius) / this.cell), Math.round(this.minX / this.cell) + n - 1);
    const maxZ = Math.min(Math.floor((z + radius) / this.cell), Math.round(this.minZ / this.cell) + n - 1);
    for (let cz = minZ; cz <= maxZ; cz++) for (let cx = minX; cx <= maxX; cx++) {
      if (((cx + 0.5) * this.cell - x) ** 2 + ((cz + 0.5) * this.cell - z) ** 2 > radius ** 2) continue;
      const index = (mod(cz, n) * n + mod(cx, n)) * 4;
      this.mask[index] = Math.max(0, Math.min(1, wetness)); this.mask[index + 1] = y;
    }
    this.revision++;
  }
}
