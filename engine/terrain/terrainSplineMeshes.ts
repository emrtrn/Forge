import { splineToPolyline, type ForgeLandscapeSpline } from "../scene/landscape";
import type { Vec3 } from "../scene/layout";
import { terrainFaceNormalAt } from "./terrainHeightQuery";
import type { WorldTerrainDocument } from "./terrainLoader";
import { terrainSplineInLocalFrame, terrainSplineToWorld } from "./terrainSplineData";
import { terrainTileWorldBounds, tileKey, type TerrainTileData, type WorldTerrainDef } from "./terrainTypes";
import { worldTerrainActorPosition } from "./worldTerrainActor";

/** Render/collision coordinates stay near the terrain centre, even in large worlds. */
export interface TerrainSplineMeshSource {
  splines: ForgeLandscapeSpline[];
  normalAt: (localX: number, localZ: number) => Vec3;
}

/** Only terrain-aligned mesh paths need resident height data; never the whole grid. */
export function terrainSplineMeshTileKeys(def: WorldTerrainDef): string[] {
  const boxes = (def.splines ?? []).flatMap((stored) => {
    if (stored.hidden) return [];
    const spline = stored.coordinateSpace === "world" ? stored : terrainSplineToWorld(def, stored);
    // Rigid placement uses the default curve sampling; bent chains use 32.
    // Include both polylines so long curved segments cannot miss a normal tile.
    return [...splineToPolyline(spline), ...splineToPolyline(spline, spline.smooth ? 32 : 1)]
      .filter(({ segment }) => segment.mesh?.enabled && segment.mesh.assetId && segment.mesh.alignToTerrain)
      .map(({ start, end }) => ({
        minX: Math.min(start.position[0], end.position[0]) - def.spacing,
        maxX: Math.max(start.position[0], end.position[0]) + def.spacing,
        minZ: Math.min(start.position[2], end.position[2]) - def.spacing,
        maxZ: Math.max(start.position[2], end.position[2]) + def.spacing,
      }));
  });
  return def.tiles.filter(({ key }) => {
    const [x, z] = key.split("_").map(Number) as [number, number];
    const tile = terrainTileWorldBounds(def, x, z);
    return boxes.some((box) => box.maxX >= tile.minX && box.minX <= tile.maxX && box.maxZ >= tile.minZ && box.minZ <= tile.maxZ);
  }).map(({ key }) => key);
}

/**
 * Capture a build's definition and exact normal data without touching live
 * residency, dirty revisions or files. Missing required tiles fail the build.
 * A runtime may fetch these temporary tiles without activating terrain/colliders.
 */
export async function prepareTerrainSplineMeshSource(
  document: WorldTerrainDocument,
  load?: (key: string) => Promise<TerrainTileData>,
): Promise<TerrainSplineMeshSource> {
  const def = structuredClone(document.def);
  const keys = terrainSplineMeshTileKeys(def);
  const tiles = new Map<string, TerrainTileData>();
  let cursor = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(4, keys.length) }, async () => {
    while (!failed && cursor < keys.length) {
      const key = keys[cursor++]!;
      try {
        const tile = document.tiles.get(key) ?? (load ? await load(key) : undefined);
        if (!tile) throw new Error(`Spline mesh requires terrain tile ${key}`);
        tiles.set(key, tile);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }));
  const centre = worldTerrainActorPosition(def);
  return {
    splines: (def.splines ?? []).map((spline) => terrainSplineInLocalFrame(def, spline)),
    normalAt: (x, z) => {
      const normal = terrainFaceNormalAt(def, { tile: (tx, tz) => tiles.get(tileKey(tx, tz)) }, x + centre[0], z + centre[2]);
      if (!normal) throw new Error(`Spline mesh terrain normal unavailable at ${x + centre[0]}, ${z + centre[2]}`);
      return normal;
    },
  };
}
