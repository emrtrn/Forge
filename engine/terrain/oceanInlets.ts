import type { LayoutRiverWater } from "../scene/layout";
import type { OceanWaterBody } from "../scene/oceanWater";
import type { OceanInlet } from "./oceanCoverage";
import type { WorldTerrainDef } from "./terrainTypes";

/** Only live River geometry inputs participate in Ocean's presentation key. */
export function oceanInletRiverInputs(body: OceanWaterBody, rivers?: readonly LayoutRiverWater[]): LayoutRiverWater[] | undefined {
  return rivers?.filter(river => river.landscapeRef === body.terrainRef && body.inlets?.includes(river.splineRef))
    .map(river => ({ id: river.id, landscapeRef: river.landscapeRef, splineRef: river.splineRef, widthScale: river.widthScale ?? 1,
      surfaceLevel: river.surfaceLevel ?? 0, ...(river.coordinateSpace === "world" ? { coordinateSpace: "world" as const } : {}), hidden: river.hidden === true }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** No terrain samples or GPU resources: widths can follow River edits in place.
 * Omitted `rivers` preserves the standalone terrain API's original width=1.
 * With a live layout, an absent/hidden owner releases its exclusion to Ocean. */
export function resolveOceanInlets(def: WorldTerrainDef, body: OceanWaterBody, rivers?: readonly LayoutRiverWater[]): OceanInlet[] {
  return (body.inlets ?? []).map(id => {
    const matches = rivers?.filter(river => river.landscapeRef === body.terrainRef && river.splineRef === id && !river.hidden);
    if (matches && matches.length === 0) return { start: [0, 0], end: [1, 0], width: 1, active: false };
    if (matches && matches.length > 1) throw new Error(`Ocean inlet ${id} has multiple visible River owners`);
    const river = matches?.[0];
    const widthScale = river?.widthScale ?? 1;
    if (!Number.isFinite(widthScale) || widthScale < .05 || widthScale > 10) throw new Error(`Ocean inlet ${id} has an invalid River width scale`);
    const spline = def.splines?.find(entry => entry.id === id);
    if (!spline || spline.coordinateSpace !== "world" || spline.smooth || spline.points.length < 2)
      throw new Error(`Ocean inlet ${id} requires a world-space polyline with a straight terminal reach`);
    const a = spline.points.at(-2)!, b = spline.points.at(-1)!;
    const endpoint = river ? (river.surfaceLevel ?? 0) + b.position[1] - spline.points[0]!.position[1]
      + (river.coordinateSpace === "world" ? 0 : def.origin[1]) : b.position[1];
    if (Math.abs(endpoint - body.surfaceLevel) > .002 || Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]) < 1
      || a.width !== b.width) throw new Error(`Ocean inlet ${id} must end at sea level with a constant-width terminal reach`);
    return { start: [a.position[0], a.position[2]], end: [b.position[0], b.position[2]], width: b.width * widthScale };
  });
}
