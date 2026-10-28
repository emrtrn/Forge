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

/** Tiles under the pads and their falloff, plus seam neighbours, without requiring residency. */
export function terrainPadTileKeys(def: WorldTerrainDef, pads: readonly TerrainPad[]): string[] {
  const boxes = pads.map((pad) => padBounds(pad, def.spacing));
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
 * its falloff the height eases from that level to the ground (smoothstep).
 * Where pads' falloffs overlap, the pad with the stronger pull wins. Apply the
 * returned patches as one terrain undo command; nothing is written here.
 */
export function createTerrainPadPatches(world: TerrainEditWorld, pads: readonly TerrainPad[]): TerrainUndoPatch[] {
  const indexed = pads.map((pad) => ({ pad, box: padBounds(pad, 0) }));
  if (indexed.length === 0) return [];
  const pull = (x: number, z: number): { pad: TerrainPad; weight: number } | null => {
    let best: { pad: TerrainPad; weight: number } | null = null;
    for (const { pad, box } of indexed) {
      if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
      const weight = padWeight(pad, x, z);
      if (weight > 0 && (!best || weight > best.weight)) best = { pad, weight };
    }
    return best;
  };
  return createTerrainRegionPatches(world, union(indexed.map((entry) => padBounds(entry.pad, world.def.spacing))), {
    affects: (x, z) => pull(x, z) !== null,
    sample: (x, z, height) => {
      const found = pull(x, z);
      if (!found) return {};
      const target = found.pad.height - world.def.origin[1];
      const next = Number((height + (target - height) * found.weight).toFixed(4));
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
