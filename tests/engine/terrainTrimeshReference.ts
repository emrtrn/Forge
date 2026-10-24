/**
 * Terrain as indexed trimeshes: the colliders the editor and runtime used
 * before heightfields (OPEN_WORLD_PLAN Faz 3). Kept test-side only, as the
 * independent reference the heightfield's triangles, frames and physics
 * queries are checked against, and as a ready-made static trimesh fixture.
 */
import type { ColliderPrimitive } from "../../engine/scene/components";
import type { ForgeLandscapeData } from "../../engine/scene/landscape";
import type { Vec3 } from "../../engine/scene/layout";
import type { TerrainTileData, WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { terrainTileWorldBounds } from "../../engine/terrain/terrainTypes";

export interface TerrainTrimeshPrimitive extends ColliderPrimitive {
  shape: "trimesh";
  vertices: Vec3[];
  indices: number[];
}

/** Rows of Z, then X; each quad split along the b–c diagonal, up-facing on flat ground (K3a). */
function gridIndices(verticesX: number, verticesZ: number): number[] {
  const indices: number[] = [];
  for (let z = 0; z < verticesZ - 1; z += 1) {
    for (let x = 0; x < verticesX - 1; x += 1) {
      const a = z * verticesX + x;
      const b = a + 1;
      const c = a + verticesX;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return indices;
}

function pointAabb(points: readonly Vec3[]): { size: Vec3; center: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, point[axis]!);
      max[axis] = Math.max(max[axis]!, point[axis]!);
    }
  }
  return {
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  };
}

/** A 1x1 Landscape in its actor-centred body frame, with `heightScale` folded in. */
export function landscapeTrimesh(data: ForgeLandscapeData): TerrainTrimeshPrimitive {
  const { spacing, heightScale, verticesX, verticesZ } = data.size;
  const originX = ((verticesX - 1) * spacing) / 2;
  const originZ = ((verticesZ - 1) * spacing) / 2;
  const vertices: Vec3[] = [];
  for (let z = 0; z < verticesZ; z += 1) {
    for (let x = 0; x < verticesX; x += 1) {
      vertices.push([x * spacing - originX, (data.heights[z * verticesX + x] ?? 0) * heightScale, z * spacing - originZ]);
    }
  }
  return { shape: "trimesh", ...pointAabb(vertices), vertices, indices: gridIndices(verticesX, verticesZ) };
}

/** One World Terrain tile, centred on the tile at the height datum: the frame of `terrainTileHeightfield`. */
export function terrainTileTrimesh(
  def: Pick<WorldTerrainDef, "tileQuads" | "spacing" | "origin">,
  tile: TerrainTileData,
): { translation: Vec3; primitive: TerrainTrimeshPrimitive } {
  const size = tile.size;
  const half = ((size - 1) * def.spacing) / 2;
  const vertices: Vec3[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const y = tile.heights[z * size + x]!;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      vertices.push([x * def.spacing - half, y, z * def.spacing - half]);
    }
  }
  const bounds = terrainTileWorldBounds(def, tile.x, tile.z);
  return {
    translation: [(bounds.minX + bounds.maxX) / 2, def.origin[1], (bounds.minZ + bounds.maxZ) / 2],
    primitive: {
      shape: "trimesh",
      size: [2 * half, maxY - minY, 2 * half],
      center: [0, (minY + maxY) / 2, 0],
      vertices,
      indices: gridIndices(size, size),
    },
  };
}
