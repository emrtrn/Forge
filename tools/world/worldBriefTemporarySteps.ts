/**
 * Temporary steps of `world:brief` (docs/world-builder/WORLD_BRIEF.md): the
 * pilot's paint, plant rules, rock scatter and yard fence. Pilot step 3 turns
 * each into a World Builder step; the terrain and the water beds already moved
 * to `engine/worldbuilder/briefTerrain.ts` (step 3a). They read any brief, but
 * their numbers (`PILOT_TUNING`: paint layers, plant rules, rock counts, the
 * fence) are the pilot's until they move to the region profile (steps 3c–3e).
 * Pure and deterministic.
 */
import type { WorldTerrainLayerDef, WorldTerrainSpline } from "../../engine/terrain/terrainTypes";
import { WATER_BED_MARGIN, type BriefTerrain, type WaterCourse } from "../../engine/worldbuilder/briefTerrain";
import { fbm } from "../../engine/worldbuilder/noise";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { briefToWorld, type WorldBrief } from "../../engine/worldbuilder/worldBrief";

export const PILOT_TUNING = {
  /** Terrain spline falloff of a water line, metres. */
  waterFalloff: 2,
  meadowFade: [6, 30] as const,
  rockFade: 30,
  /** Open ground around a landmark with level ground. */
  clearingRadius: 38,
  rocksOnHighGround: 90,
  rocksOnSlopes: 24,
  rocksByWater: 18,
  /** Smaller rocks are walked over: no collider. */
  rockCollisionScale: 1.4,
  rockScale: { high: [1.5, 4], slope: [1, 2.5], river: [1, 2] } as const,
  /** World XZ boxes kept free of slope rocks: the climb to the cabin. */
  rockFreeBoxes: [{ min: [-240, -240] as WorldPoint, max: [-30, -90] as WorldPoint }],
  /** A yard fence on the north and west of every `building.cabin` landmark. */
  fence: { role: "building.cabin", module: 3 },
  layers: [
    { id: "meadow", name: "Meadow", color: "#6f9a4a", material: "lt-meadow", physicalMaterial: "default" },
    { id: "forest", name: "Forest Floor", color: "#3f4f2c", material: "starter-mat-grass", physicalMaterial: "default" },
    { id: "rock", name: "Rock", color: "#8b8a84", material: "lt-rock", physicalMaterial: "default" },
    { id: "dirt", name: "Dirt", color: "#8a6441", material: "lt-earth", physicalMaterial: "default" },
    { id: "riverbed", name: "River Bed", color: "#6f6a5c", material: "m-gravel-material", physicalMaterial: "default" },
    // Paint of the region profile's collector and arterial roads; no asphalt material yet, the tint stands in.
    { id: "asphalt", name: "Asphalt", color: "#3d3d3f", physicalMaterial: "stone" },
  ] satisfies WorldTerrainLayerDef[],
  /** Settlement ground painted under every building pad, so no plant grows there; metres of easing beyond the pad. */
  padPaint: { layerId: "dirt", fade: 1.5 },
  /** Plants grow from the paint, so the road, the river and the clearing stay free of them. */
  plantRules: [
    { id: "forest-conifer-a", layerId: "forest", foliageTypeId: "wp-conifer-a-type", density: 0.0025, minWeight: 0.6, seed: 101 },
    { id: "forest-conifer-b", layerId: "forest", foliageTypeId: "wp-conifer-b-type", density: 0.002, minWeight: 0.45, seed: 102 },
    { id: "forest-conifer-c", layerId: "forest", foliageTypeId: "wp-conifer-c-type", density: 0.0015, minWeight: 0.35, seed: 106 },
    { id: "forest-bush", layerId: "forest", foliageTypeId: "wp-bush-a-type", density: 0.0015, minWeight: 0.5, seed: 103 },
    { id: "forest-bush-b", layerId: "forest", foliageTypeId: "wp-bush-b-type", density: 0.001, minWeight: 0.5, seed: 107 },
    { id: "meadow-bush", layerId: "meadow", foliageTypeId: "wp-bush-a-type", density: 0.0006, minWeight: 0.6, seed: 104 },
    { id: "meadow-grass", layerId: "meadow", foliageTypeId: "wp-grass-a-type", density: 0.02, minWeight: 0.5, seed: 105 },
  ],
};

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** Landmarks with level ground, world XZ. */
export function briefClearings(brief: WorldBrief): WorldPoint[] {
  return brief.landmarks.filter((landmark) => landmark.pad).map((landmark) => briefToWorld(brief, landmark.at));
}

/** Paint weights in `PILOT_TUNING.layers` order. */
export function paintWeights(brief: WorldBrief, terrain: BriefTerrain): (x: number, z: number) => number[] {
  const tuning = PILOT_TUNING;
  const clearings = briefClearings(brief);
  return (x, z) => {
    const wobble = 10 * fbm(x / 35, z / 35, 3, brief.seed + 13);
    const position = terrain.valleyAt(x, z);
    const out = (position?.slopeDistance ?? 0) + wobble;
    const rock = position ? smoothstep((position.rockEdge + wobble) / tuning.rockFade) : 0;
    const clearing = clearings.reduce((most, [cx, cz]) =>
      Math.max(most, 1 - smoothstep((Math.hypot(x - cx, z - cz) + wobble - tuning.clearingRadius) / 12)), 0);
    const forest = smoothstep((out - tuning.meadowFade[0]) / (tuning.meadowFade[1] - tuning.meadowFade[0])) * (1 - clearing);
    const hit = terrain.water(x, z);
    const riverbed = hit ? 1 - smoothstep((hit.distance - (hit.course.width / 2 + WATER_BED_MARGIN)) / 3) : 0;
    const open = (1 - rock) * (1 - riverbed);
    return [open * (1 - forest), open * forest, rock * (1 - riverbed), 0, riverbed, 0];
  };
}

/** A water line as a terrain spline at the water surface; its river actor reads it. */
export function waterSpline(course: WaterCourse): WorldTerrainSpline {
  const points = course.anchors.map((anchor, index) => ({
    id: `p${index}`,
    position: [course.points[anchor]![0], Number(course.surface[anchor]!.toFixed(3)), course.points[anchor]![1]] as [number, number, number],
    width: course.width,
    falloff: PILOT_TUNING.waterFalloff,
  }));
  return {
    id: course.id,
    name: course.id.charAt(0).toUpperCase() + course.id.slice(1),
    smooth: true,
    coordinateSpace: "world",
    points,
    segments: points.slice(1).map((point, index) => ({ id: `s${index}`, startPointId: points[index]!.id, endPointId: point.id })),
  };
}

/** A small deterministic generator, so a run rebuilds the same scatter. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ScatterPlacement {
  /** Model row variant to pick from, or null for the role's only model. */
  role: string;
  variant: string | null;
  id: string;
  name: string;
  at: WorldPoint;
  rotationYDeg: number;
  scale: number;
  collision: boolean;
  /** Which of the variant's models, 0..1. */
  pick: number;
}

/** The yard fence: modules along the north and west of each cabin. */
export function yardFences(brief: WorldBrief): ScatterPlacement[] {
  const fences: ScatterPlacement[] = [];
  const { role, module } = PILOT_TUNING.fence;
  for (const landmark of brief.landmarks.filter((entry) => entry.role === role)) {
    const [cx, cz] = briefToWorld(brief, landmark.at);
    const prefix = brief.landmarks.filter((entry) => entry.role === role).length > 1 ? `${landmark.id}-` : "";
    for (let index = 0; index < 8; index += 1) {
      fences.push({
        role: "prop.fence", variant: null, id: `${prefix}fence-north-${index}`, name: `Fence North ${index}`,
        at: [cx - 10.5 + index * module, cz - 13], rotationYDeg: 0, scale: 1, collision: false, pick: 0,
      });
    }
    for (let index = 0; index < 7; index += 1) {
      fences.push({
        role: "prop.fence", variant: null, id: `${prefix}fence-west-${index}`, name: `Fence West ${index}`,
        at: [cx - 12, cz - 11.5 + index * module], rotationYDeg: 90, scale: 1, collision: false, pick: 0,
      });
    }
  }
  return fences;
}

/** Rocks on the high ground, the slopes and the water banks. `pick` chooses among the variant's models. */
export function scatterRocks(
  brief: WorldBrief,
  terrain: BriefTerrain,
  bounds: { min: WorldPoint; max: WorldPoint },
): ScatterPlacement[] {
  const tuning = PILOT_TUNING;
  const random = seededRandom(brief.seed);
  const clearings = briefClearings(brief);
  const rocks: ScatterPlacement[] = [];
  const rock = (id: string, at: WorldPoint, variant: keyof typeof tuning.rockScale): void => {
    const pick = random();
    const [low, high] = tuning.rockScale[variant];
    const scale = Number((low + random() * (high - low)).toFixed(2));
    rocks.push({
      role: "prop.rock", variant, id, name: id, at, scale, collision: scale >= tuning.rockCollisionScale,
      rotationYDeg: Math.round(random() * 360), pick,
    });
  };
  const center: WorldPoint = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2];
  const half: WorldPoint = [(bounds.max[0] - bounds.min[0]) / 2, (bounds.max[1] - bounds.min[1]) / 2];
  /** Within `margin` metres of the area's edge at most. */
  const span = (axis: 0 | 1, margin: number): number => center[axis] + (random() * 2 - 1) * (half[axis] - margin);
  const inside = ([x, z]: WorldPoint, margin: number): boolean =>
    x >= bounds.min[0] + margin && x <= bounds.max[0] - margin && z >= bounds.min[1] + margin && z <= bounds.max[1] - margin;
  const offRoad = (at: WorldPoint): boolean =>
    clearings.every(([cx, cz]) => Math.hypot(at[0] - cx, at[1] - cz) >= tuning.clearingRadius + 6)
    && !tuning.rockFreeBoxes.some(({ min, max }) => at[0] > min[0] && at[0] < max[0] && at[1] > min[1] && at[1] < max[1]);
  for (let index = 0, tries = 0; index < tuning.rocksOnHighGround && tries < 5000; tries += 1) {
    const at: WorldPoint = [span(0, 5), span(1, 5)];
    const position = terrain.valleyAt(at[0], at[1]);
    if (position && position.rockEdge > 6) rock(`rock-high-${index++}`, at, "high");
  }
  for (let index = 0, tries = 0; index < tuning.rocksOnSlopes && tries < 5000; tries += 1) {
    const at: WorldPoint = [span(0, 5), span(1, 5)];
    const position = terrain.valleyAt(at[0], at[1]);
    if (position && position.slopeDistance > 40 && position.rockEdge < 0 && offRoad(at)) rock(`rock-slope-${index++}`, at, "slope");
  }
  const { courses } = terrain;
  for (let index = 0, tries = 0; courses.length && index < tuning.rocksByWater && tries < 5000; tries += 1) {
    const course = courses[Math.floor(random() * courses.length)]!;
    const at = Math.min(course.points.length - 2, Math.floor(random() * (course.points.length - 1)));
    const [a, b] = [course.points[at]!, course.points[at + 1]!];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const offset = (random() < 0.5 ? -1 : 1) * (course.width / 2 + 0.5 + random() * 4);
    const spot: WorldPoint = [a[0] - (b[1] - a[1]) / length * offset, a[1] + (b[0] - a[0]) / length * offset];
    if (inside(spot, 10)) rock(`rock-river-${index++}`, spot, "river");
  }
  return rocks;
}

/** Plant rules on the terrain's paint layers. */
export function plantRules(terrainId: string): Array<Record<string, unknown>> {
  return PILOT_TUNING.plantRules.map((rule) => ({
    id: rule.id, landscapeId: terrainId, layerId: rule.layerId, foliageTypeId: rule.foliageTypeId,
    density: rule.density, minWeight: rule.minWeight, seed: rule.seed,
  }));
}
