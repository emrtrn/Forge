import { createTerrainRegionPatches, terrainRegionGridBounds, type TerrainEditWorld, type TerrainUndoPatch } from "./terrainEdit";
import { terrainTileWorldBounds, type TerrainWorldBounds, type WorldTerrainDef } from "./terrainTypes";

/**
 * A level area: the ground inside `polygon` goes to `height` (world metres) and
 * blends back into the terrain over `falloff` metres outside it. World Builder
 * writes one under every building (plan v0.4 §13.5 L6, T21); the editor bakes
 * them on request as one undo step (decision 19), like a spline deform.
 */
export interface TerrainPad {
  /** Outline on the XZ plane, world metres. */
  polygon: ReadonlyArray<readonly [number, number]>;
  height: number;
  falloff: number;
}

/**
 * A falloff narrower than this many grid spacings aliases on a rotated edge: the
 * step lands between grid rows at a different place in every column and the edge
 * reads as a saw. Two spacings keep the edge within about a sixth of a metre of a
 * straight line on a 1 m grid (one spacing wanders more than half a metre).
 */
export const PAD_MIN_FALLOFF_SPACINGS = 2;

/** The falloff a pad bakes with on this terrain: at least `PAD_MIN_FALLOFF_SPACINGS` grid spacings. */
export function padBakeFalloff(pad: TerrainPad, spacing: number): number {
  return Math.max(pad.falloff, PAD_MIN_FALLOFF_SPACINGS * spacing);
}

/** Tiles under the pads and their falloff, plus seam neighbours, without requiring residency. */
export function terrainPadTileKeys(def: WorldTerrainDef, pads: readonly TerrainPad[]): string[] {
  const boxes = pads.map((pad) => padBounds({ ...pad, falloff: padBakeFalloff(pad, def.spacing) }, def.spacing));
  if (boxes.length === 0) return [];
  // Reject an oversized synchronous transaction before it fetches a whole world.
  terrainRegionGridBounds(def, union(boxes));
  return def.tiles.filter(({ key }) => {
    const [x, z] = key.split("_").map(Number) as [number, number];
    const tile = terrainTileWorldBounds(def, x, z);
    return boxes.some((box) => box.maxX >= tile.minX && box.minX <= tile.maxX && box.maxZ >= tile.minZ && box.minZ <= tile.maxZ);
  }).map(({ key }) => key);
}

/**
 * Prepare one bake of every pad. Inside a pad the height is its level; within
 * its falloff (at least `PAD_MIN_FALLOFF_SPACINGS` grid spacings) the height
 * eases from that level to the ground (smoothstep). Where falloffs overlap, each
 * pad's share is its weight times what the others leave free (`1 - w`), and the
 * ground's share is what all of them leave free, normalised. One pad alone eases
 * exactly as before; a pad's level holds right up to its edge (its weight there
 * is one, so the others' shares vanish); the result is symmetric and continuous
 * everywhere, so neighbouring pads meet in a smooth ramp, not a step that lands
 * wherever the stronger pull changes. Apply the returned patches as one terrain
 * undo command; nothing is written here.
 */
export function createTerrainPadPatches(world: TerrainEditWorld, pads: readonly TerrainPad[]): TerrainUndoPatch[] {
  const spacing = world.def.spacing;
  const indexed = pads.map((pad) => {
    const baked = { ...pad, falloff: padBakeFalloff(pad, spacing) };
    return { pad: baked, box: padBounds(baked, 0) };
  });
  if (indexed.length === 0) return [];
  /** World target height at (x, z) given the current height, or null where no pad reaches. */
  const target = (x: number, z: number, ground: number): number | null => {
    const pulls: Array<{ height: number; weight: number }> = [];
    for (const { pad, box } of indexed) {
      if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
      if (insidePolygon(x, z, pad.polygon)) return pad.height;
      const weight = padWeight(pad, x, z);
      if (weight > 0) pulls.push({ height: pad.height, weight });
    }
    if (pulls.length === 0) return null;
    // Pads touching here at full weight (a shared edge): their mean.
    const full = pulls.filter((pull) => pull.weight >= 1);
    if (full.length > 0) return full.reduce((sum, pull) => sum + pull.height, 0) / full.length;
    let free = 1, level = 0, total = 0;
    for (const pull of pulls) free *= 1 - pull.weight;
    for (const pull of pulls) {
      const share = (pull.weight * free) / (1 - pull.weight);
      level += share * pull.height;
      total += share;
    }
    return (level + free * ground) / (total + free);
  };
  return createTerrainRegionPatches(world, union(indexed.map((entry) => padBounds(entry.pad, spacing))), {
    affects: (x, z) => target(x, z, 0) !== null,
    sample: (x, z, height) => {
      const origin = world.def.origin[1];
      const level = target(x, z, height + origin);
      if (level === null) return {};
      const next = Number((level - origin).toFixed(4));
      return next === height ? {} : { height: next };
    },
  });
}

/** 1 inside, easing to 0 at `falloff` outside. */
export function padWeight(pad: TerrainPad, x: number, z: number): number {
  if (insidePolygon(x, z, pad.polygon)) return 1;
  if (pad.falloff <= 0) return 0;
  const distance = edgeDistance(x, z, pad.polygon);
  if (distance >= pad.falloff) return 0;
  const t = 1 - distance / pad.falloff;
  return t * t * (3 - 2 * t);
}

function padBounds(pad: TerrainPad, extra: number): TerrainWorldBounds {
  const reach = Math.max(0, pad.falloff) + extra;
  const xs = pad.polygon.map(([x]) => x);
  const zs = pad.polygon.map(([, z]) => z);
  return { minX: Math.min(...xs) - reach, maxX: Math.max(...xs) + reach, minZ: Math.min(...zs) - reach, maxZ: Math.max(...zs) + reach };
}

function union(boxes: readonly TerrainWorldBounds[]): TerrainWorldBounds {
  return {
    minX: Math.min(...boxes.map((box) => box.minX)), maxX: Math.max(...boxes.map((box) => box.maxX)),
    minZ: Math.min(...boxes.map((box) => box.minZ)), maxZ: Math.max(...boxes.map((box) => box.maxZ)),
  };
}

function insidePolygon(x: number, z: number, polygon: TerrainPad["polygon"]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i]!;
    const [xj, zj] = polygon[j]!;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function edgeDistance(x: number, z: number, polygon: TerrainPad["polygon"]): number {
  let best = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    const [ax, az] = polygon[index]!;
    const [bx, bz] = polygon[(index + 1) % polygon.length]!;
    const dx = bx - ax;
    const dz = bz - az;
    const length = dx * dx + dz * dz;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}
