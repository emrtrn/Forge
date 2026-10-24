import { landscapeBrushFalloff } from "../scene/landscapeBrush";

export interface TerrainErosionSettings {
  erosionHydraulic: boolean;
  erosionIterations: number;
  erosionTalus: number;
  erosionRainAmount: number;
  erosionSedimentCapacity: number;
  erosionEvaporation: number;
  erosionSeed: number;
}

export const DEFAULT_TERRAIN_EROSION_SETTINGS: Readonly<TerrainErosionSettings> = {
  erosionHydraulic: false, erosionIterations: 24, erosionTalus: 30,
  erosionRainAmount: 0.5, erosionSedimentCapacity: 4, erosionEvaporation: 0.02, erosionSeed: 1,
};

export interface TerrainErosionRegion {
  x0: number; x1: number; z0: number; z1: number;
  originX: number; originZ: number; spacing: number;
  x: number; z: number; radius: number; strength: number; falloff: number;
  settings: TerrainErosionSettings;
  /** Global grid samples in metres; undefined denotes an outer boundary or a hole. */
  sample(x: number, z: number): number | undefined;
}

export function validTerrainErosionSettings(settings: TerrainErosionSettings): boolean {
  return typeof settings.erosionHydraulic === "boolean"
    && Number.isInteger(settings.erosionIterations) && settings.erosionIterations >= 1 && settings.erosionIterations <= 64
    && Number.isFinite(settings.erosionTalus) && settings.erosionTalus >= 0 && settings.erosionTalus <= 89
    && Number.isFinite(settings.erosionRainAmount) && settings.erosionRainAmount >= 0 && settings.erosionRainAmount <= 10
    && Number.isFinite(settings.erosionSedimentCapacity) && settings.erosionSedimentCapacity >= 0 && settings.erosionSedimentCapacity <= 20
    && Number.isFinite(settings.erosionEvaporation) && settings.erosionEvaporation >= 0 && settings.erosionEvaporation <= 1
    && Number.isInteger(settings.erosionSeed) && settings.erosionSeed >= 0 && settings.erosionSeed <= 2147483647;
}

/**
 * A bounded, detached simulation patch shared by single- and multi-tile terrain.
 * All samples are read before simulation; callers commit the result atomically.
 * The mask belongs to the simulation, so neither holes nor protected vertices
 * receive sediment, and Thermal transfers conserve soil rather than averaging it.
 * Hydraulic runoff may carry soil out through the footprint boundary.
 */
export function erodeTerrainRegion(region: TerrainErosionRegion): Float64Array {
  const { x0, x1, z0, z1, spacing, settings } = region;
  const width = x1 - x0 + 1, depth = z1 - z0 + 1;
  if (!validTerrainErosionSettings(settings) || !Number.isFinite(spacing) || spacing <= 0
    || ![x0, x1, z0, z1].every(Number.isInteger) || width <= 0 || depth <= 0
    || ![region.x, region.z, region.originX, region.originZ, region.radius, region.strength, region.falloff].every(Number.isFinite)
    || region.radius <= 0 || region.strength < 0 || region.falloff < 0) throw new Error("Invalid terrain erosion settings");
  if (width * depth > 262144) throw new Error("Erosion brush is too large for this Landscape's spacing; reduce Brush Size");
  const heights = new Float64Array(width * depth);
  const mask = new Float64Array(heights.length);
  const active: number[] = [];
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
    const i = z * width + x;
    const value = region.sample(x0 + x, z0 + z);
    if (value !== undefined && !Number.isFinite(value)) throw new Error("Invalid terrain erosion height");
    heights[i] = value ?? NaN;
    if (value === undefined) continue;
    mask[i] = landscapeBrushFalloff(Math.hypot(region.originX + (x0 + x) * spacing - region.x,
      region.originZ + (z0 + z) * spacing - region.z), region.radius, region.falloff);
    if (mask[i]! > 0) active.push(i);
  }
  const strength = Math.min(1, region.strength);
  if (strength === 0 || active.length === 0) return heights;
  if (!settings.erosionHydraulic) {
    const delta = new Float64Array(heights.length);
    const threshold = Math.tan(settings.erosionTalus * Math.PI / 180) * spacing;
    const neighbours = [-1, 0, 1].flatMap((dz) => [-1, 0, 1].filter((dx) => dx !== 0 || dz !== 0)
      .map((dx) => ({ dx, dz, offset: dz * width + dx, limit: threshold * Math.hypot(dx, dz) })));
    for (let iteration = 0; iteration < settings.erosionIterations; iteration++) {
      delta.fill(0);
      for (const i of active) {
        const x = i % width, z = Math.floor(i / width);
        let total = 0, maximum = 0;
        for (const n of neighbours) {
          if (x + n.dx < 0 || x + n.dx >= width || z + n.dz < 0 || z + n.dz >= depth) continue;
          const j = i + n.offset;
          if (mask[j]! <= 0) continue;
          const excess = heights[i]! - heights[j]! - n.limit;
          if (excess <= 0) continue;
          total += excess;
          maximum = Math.max(maximum, excess);
        }
        if (total <= 0) continue;
        const movable = maximum * 0.25 * strength;
        for (const n of neighbours) {
          if (x + n.dx < 0 || x + n.dx >= width || z + n.dz < 0 || z + n.dz >= depth) continue;
          const j = i + n.offset;
          if (mask[j]! <= 0) continue;
          const excess = heights[i]! - heights[j]! - n.limit;
          if (excess <= 0) continue;
          // Bound incoming transfers too: eight high neighbours must not
          // overfill a low vertex and create a new peak in one iteration.
          const amount = Math.min(movable * excess / total, excess / 16 * strength) * Math.min(mask[i]!, mask[j]!);
          delta[i] = delta[i]! - amount;
          delta[j] = delta[j]! + amount;
        }
      }
      for (const i of active) heights[i] = heights[i]! + delta[i]!;
    }
    if (active.some((i) => !Number.isFinite(heights[i]))) throw new Error("Terrain erosion height overflow");
    return heights;
  }

  if (settings.erosionRainAmount === 0 || settings.erosionSedimentCapacity === 0) return heights;
  // Reproducible rainfall. Global patch coordinates make this independent of
  // tile partition and tile loading/iteration order, including shared corners.
  let state = (settings.erosionSeed ^ Math.imul(x0, 374761393) ^ Math.imul(z0, 668265263)) >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const sample = (x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= width - 1 || iz >= depth - 1) return null;
    const i = iz * width + ix, u = x - ix, v = z - iz;
    const indices = [i, i + 1, i + width, i + width + 1];
    if (indices.some((j) => mask[j]! <= 0 || !Number.isFinite(heights[j]))) return null;
    const a = heights[i]!, b = heights[i + 1]!, c = heights[i + width]!, d = heights[i + width + 1]!;
    return { x, z,
      height: a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v,
      dx: (b - a) * (1 - v) + (d - c) * v, dz: (c - a) * (1 - u) + (d - b) * u };
  };
  type Surface = NonNullable<ReturnType<typeof sample>>;
  const deposit = (surface: Surface, amount: number) => {
    // Spread deposited soil over a small fan rather than four grid vertices.
    // Bilinear-only deposits make isolated spikes on metre-spaced heightfields.
    const ix = Math.floor(surface.x), iz = Math.floor(surface.z);
    const indices: number[] = [], weights: number[] = [];
    let total = 0;
    for (let dz = -2; dz <= 3; dz++) for (let dx = -2; dx <= 3; dx++) {
      const x = ix + dx, z = iz + dz;
      if (x < 0 || x >= width || z < 0 || z >= depth) continue;
      const i = z * width + x;
      const weight = Math.max(0, 2.5 - Math.hypot(x - surface.x, z - surface.z)) * mask[i]!;
      if (weight <= 0 || !Number.isFinite(heights[i])) continue;
      indices.push(i); weights.push(weight); total += weight;
    }
    if (total <= 0) return;
    indices.forEach((i, n) => { heights[i] = heights[i]! + amount * weights[n]! / total; });
  };
  const wear = (x: number, z: number, amount: number) => {
    // A small erosion kernel avoids single-vertex pits and grid-aligned scars.
    const ix = Math.floor(x), iz = Math.floor(z);
    const indices: number[] = [], weights: number[] = [];
    let total = 0, baseTotal = 0;
    for (let dz = -1; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) {
      const sx = ix + dx, sz = iz + dz;
      if (sx < 0 || sx >= width || sz < 0 || sz >= depth) continue;
      const i = sz * width + sx;
      if (!Number.isFinite(heights[i])) continue;
      const base = Math.max(0, 2 - Math.hypot(sx - x, sz - z));
      baseTotal += base;
      const weight = base * mask[i]!;
      if (weight <= 0) continue;
      indices.push(i); weights.push(weight); total += weight;
    }
    if (total <= 0 || baseTotal <= 0) return 0;
    indices.forEach((i, n) => { heights[i] = heights[i]! - amount * weights[n]! / baseTotal; });
    return amount * total / baseTotal;
  };
  const droplets = Math.min(32768, Math.ceil(active.length * settings.erosionIterations / 8));
  for (let drop = 0; drop < droplets; drop++) {
    const i = active[Math.floor(random() * active.length)]!;
    if (random() > mask[i]!) continue;
    let x = i % width + random() - 0.5, z = Math.floor(i / width) + random() - 0.5;
    let surface = sample(x, z);
    if (!surface) continue;
    let dx = 0, dz = 0, speed = 1, water = settings.erosionRainAmount, sediment = 0, runoff = false;
    for (let step = 0; step < 48; step++) {
      dx = dx * 0.15 - surface.dx * 0.85;
      dz = dz * 0.15 - surface.dz * 0.85;
      const length = Math.hypot(dx, dz);
      if (length < 1e-10) break;
      dx /= length; dz /= length;
      const nextX = x + dx, nextZ = z + dz;
      const next = sample(nextX, nextZ);
      if (!next) { runoff = true; break; }
      const difference = next.height - surface.height;
      const capacity = Math.max(0, -difference) * speed * water * settings.erosionSedimentCapacity;
      if (difference > 0 || sediment > capacity) {
        const amount = difference > 0 ? Math.min(difference, sediment) : (sediment - capacity) * 0.3;
        deposit(surface, amount);
        sediment -= amount;
      } else {
        const amount = Math.min((capacity - sediment) * 0.3 * strength, Math.max(0, -difference));
        sediment += wear(x, z, amount);
      }
      speed = Math.min(8, Math.sqrt(Math.max(0, speed * speed - difference * 4)));
      water *= 1 - settings.erosionEvaporation;
      x = nextX; z = nextZ;
      // Heights changed during erosion/deposition: use the updated surface.
      surface = sample(x, z)!;
      if (water < 0.001 || speed < 0.01) break;
    }
    // Dry water deposits locally. Runoff carries sediment out instead of
    // building an artificial circular embankment along the brush boundary.
    if (!runoff) deposit(surface, sediment);
  }
  if (active.some((i) => !Number.isFinite(heights[i]))) throw new Error("Terrain erosion height overflow");
  return heights;
}
