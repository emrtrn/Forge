import type { ForgeLandscapeSpline } from "../scene/landscape";
import { validateLandscapeSplines } from "../scene/landscapeSplineValidation";
import type { Vec3 } from "../scene/layout";
import type { TerrainSpline, WorldTerrainDef, WorldTerrainSpline } from "./terrainTypes";
import { worldTerrainActorPosition } from "./worldTerrainActor";

type TerrainSplineFrame = Pick<WorldTerrainDef, "tileQuads" | "spacing" | "tilesX" | "tilesZ" | "origin">;

/** Shared runtime/save allowlist: never discard an unknown coordinate frame. */
export function normalizeTerrainSplines(value: unknown): TerrainSpline[] {
  const splines = validateLandscapeSplines(value) as unknown as ForgeLandscapeSpline[];
  return splines.map((spline, index) => {
    const frame = (value as Record<string, unknown>[])[index]!.coordinateSpace;
    if (frame !== undefined && frame !== "world") throw new Error(`terrain.splines[${index}].coordinateSpace must be world or absent`);
    return frame === "world" ? { ...spline, coordinateSpace: "world" } : spline;
  });
}

function translatedSpline(spline: ForgeLandscapeSpline, offset: Vec3): ForgeLandscapeSpline {
  const copy = structuredClone(spline);
  for (const point of copy.points) {
    point.position = point.position.map((value, axis) => value + offset[axis]!) as Vec3;
    if (!point.position.every(Number.isFinite)) throw new Error("Terrain spline coordinate conversion overflow");
  }
  return copy;
}

/** Copy legacy centre-local positions into world space; tangents stay vectors. */
export function terrainSplineToWorld(def: TerrainSplineFrame, spline: ForgeLandscapeSpline): WorldTerrainSpline {
  if ("coordinateSpace" in spline) throw new Error("Terrain spline is already in an explicit coordinate frame");
  return { ...translatedSpline(spline, worldTerrainActorPosition(def)), coordinateSpace: "world" };
}

/** Copy back for compatibility consumers. Never persists or mutates the source. */
export function terrainSplineToLocal(def: TerrainSplineFrame, spline: WorldTerrainSpline): ForgeLandscapeSpline {
  if (spline.coordinateSpace !== "world") throw new Error("Terrain spline must use world coordinates");
  const { coordinateSpace: _space, ...local } = spline;
  return translatedSpline(local, worldTerrainActorPosition(def).map((value) => -value) as Vec3);
}

/** Read both schema-1 representations for the still-local 1x1 editor/runtime. */
export function terrainSplineInLocalFrame(def: TerrainSplineFrame, spline: TerrainSpline): ForgeLandscapeSpline {
  if (spline.coordinateSpace !== "world") return structuredClone(spline);
  const local = terrainSplineToLocal(def, { ...spline, coordinateSpace: "world" });
  const centre = worldTerrainActorPosition(def);
  // The legacy save grid is millimetres. Subtracting two stored decimals can
  // turn 0.15 into 0.15000000000000002, dirtying an otherwise unchanged spline.
  // Snap only arithmetic noise near that grid, retaining real fractional-origin
  // offsets rather than quantizing every local point a second time.
  local.points.forEach((point, index) => {
    point.position = point.position.map((value, axis) => {
      const rounded = Number(value.toFixed(3));
      const noise = Number.EPSILON * 4 * Math.max(1, Math.abs(spline.points[index]!.position[axis]!), Math.abs(centre[axis]!));
      return Math.abs(value - rounded) <= noise ? rounded : value;
    }) as Vec3;
  });
  return local;
}

/**
 * Explicit, idempotent copy migration, used by save snapshots. Loaders preserve
 * unmarked data and do not write. IDs, tangents, mesh/effect settings and terrain
 * placement stay unchanged. Supports mixed arrays during incremental migration.
 */
export function migrateTerrainSplineCoordinates(def: WorldTerrainDef): WorldTerrainDef {
  const copy = structuredClone(def);
  if (copy.splines !== undefined) copy.splines = copy.splines.map((spline) => {
    if (spline.coordinateSpace === "world") return spline;
    return terrainSplineToWorld(def, spline);
  });
  return copy;
}
