import { splineToPolyline, type ForgeLandscapeSpline } from "../scene/landscape";
import type { Vec3 } from "../scene/layout";
import type { ResolvedRiverWater } from "../scene/riverWater";
import { terrainHeightAt } from "./terrainHeightQuery";
import type { WorldTerrainDocument } from "./terrainLoader";
import { terrainSplineInLocalFrame } from "./terrainSplineData";
import { terrainTileWorldBounds, tileKey, type TerrainTileData } from "./terrainTypes";
import { worldTerrainActorPosition } from "./worldTerrainActor";

export interface TerrainRiverWaterSource {
  spline: ForgeLandscapeSpline;
  surfaceLevel: number;
  foamStamps: ResolvedRiverWater["foamStamps"];
  position: Vec3;
  rotation: Vec3;
  sampleSpacing: number;
  heightAt: (x: number, z: number) => number | null;
}

/**
 * A temporary exact bed snapshot, restricted to the ribbon corridor. Reads never
 * activate streaming/colliders, pin undo tiles, dirty the document or migrate it.
 * Defined but unreadable tiles fail the whole body; real holes clip triangles.
 */
export async function prepareTerrainRiverWaterSource(
  document: WorldTerrainDocument,
  water: ResolvedRiverWater,
  load?: (key: string) => Promise<TerrainTileData>,
): Promise<TerrainRiverWaterSource> {
  const def = structuredClone(document.def);
  const stored = def.splines?.find((spline) => spline.id === water.splineRef);
  if (!stored) throw new Error(`River Water requires terrain spline ${water.splineRef}`);
  const spline = terrainSplineInLocalFrame(def, stored);
  const position = worldTerrainActorPosition(def);
  const boxes = splineToPolyline(spline, 24).map(({ start, end }) => {
    const radius = Math.max(start.width, end.width) * water.widthScale + def.spacing;
    return { minX: Math.min(start.position[0], end.position[0]) + position[0] - radius,
      maxX: Math.max(start.position[0], end.position[0]) + position[0] + radius,
      minZ: Math.min(start.position[2], end.position[2]) + position[2] - radius,
      maxZ: Math.max(start.position[2], end.position[2]) + position[2] + radius };
  });
  const keys = def.tiles.filter(({ key }) => {
    const [x, z] = key.split("_").map(Number) as [number, number];
    const tile = terrainTileWorldBounds(def, x, z);
    return boxes.some((box) => box.maxX >= tile.minX && box.minX <= tile.maxX && box.maxZ >= tile.minZ && box.minZ <= tile.maxZ);
  }).map(({ key }) => key);
  const tiles = new Map<string, TerrainTileData>();
  let cursor = 0;
  // Each build reads at most four files concurrently, and settles all reads on failure.
  const reads = await Promise.allSettled(Array.from({ length: Math.min(4, keys.length) }, async () => {
    while (cursor < keys.length) {
      const key = keys[cursor++]!;
      const tile = document.tiles.get(key) ?? (load ? await load(key) : undefined);
      if (!tile) throw new Error(`River Water requires terrain tile ${key}`);
      tiles.set(key, tile);
    }
  }));
  const failure = reads.find((read) => read.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  const local = (point: Vec3): Vec3 => point.map((value, axis) => value - position[axis]!) as Vec3;
  return {
    spline, position, rotation: [0, 0, 0],
    sampleSpacing: Math.min(1.25, def.spacing),
    surfaceLevel: water.surfaceLevel - (water.coordinateSpace === "world" ? position[1] : 0),
    foamStamps: water.foamStamps.map((stamp) => water.coordinateSpace === "world" ? {
      ...stamp, position: local(stamp.position), ...(stamp.endPosition ? { endPosition: local(stamp.endPosition) } : {}),
    } : structuredClone(stamp)),
    heightAt: (x, z) => {
      const height = terrainHeightAt(def, { tile: (tx, tz) => tiles.get(tileKey(tx, tz)) }, x + position[0], z + position[2]);
      return height === null ? null : height - position[1];
    },
  };
}
