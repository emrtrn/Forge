/**
 * Bird's-eye preview of a random world (RANDOM_WORLD_PLAN step 5): the same
 * brief the builder gets (`randomWorldBrief`) and the same ground and paint it
 * writes (`createBriefTerrain`, `coverPaint`), sampled on a small grid — not a
 * build. Mountains, settlements, rivers and lakes sit where the built level
 * will have them; roads are straight lines between the settlements (the builder
 * routes them over the ground), and streets, buildings and plants are left out.
 *
 * North is up: row 0 is the north edge. Vector positions are `[u, v]` in 0..1
 * across the map, `u` east and `v` south.
 *
 * Pure and deterministic; dependency-free.
 */
import { createBriefTerrain } from "./briefTerrain";
import { coverPaint, coverSnowLine, coverDensity, type GroundCover } from "./groundCover";
import { randomWorldBrief, worldExtent, type RandomWorldOptions } from "./randomWorld";
import { briefToWorld, briefWorldBounds, normalizeWorldBrief, type WorldBrief } from "./worldBrief";

/** Default pixels along each side. */
export const RANDOM_PREVIEW_RESOLUTION = 160;
/** Lake fill colour. */
export const PREVIEW_WATER_COLOR: readonly [number, number, number] = [62, 112, 158];
/** Finite-difference step for the slope, metres (as the builder's two-vertex span). */
const SLOPE_STEP = 4;

export type PreviewPoint = [number, number];

export interface RandomWorldPreview {
  /** Pixels along each side. */
  resolution: number;
  /** RGBA, `resolution`² pixels, row 0 north. */
  pixels: Uint8ClampedArray;
  /** World side length, metres. */
  extent: number;
  settlements: Array<{ id: string; type: string; at: PreviewPoint; radius: number }>;
  roads: Array<{ id: string; roadClass: string; from: PreviewPoint; to: PreviewPoint }>;
  rivers: Array<{ id: string; points: PreviewPoint[]; width: number }>;
  lakes: Array<{ id: string; polygon: PreviewPoint[] }>;
  /** Lowest and highest sampled ground, metres. */
  heightRange: [number, number];
  /** What could not be done as asked, from the generator. */
  notes: string[];
}

function hexColor(value: string): [number, number, number] {
  const hex = /^#?([0-9a-f]{6})$/i.exec(value)?.[1];
  if (!hex) return [128, 128, 128];
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The preview of `options` painted with `cover`; the cover must be the one
 * `options.cover` names (the caller loads it, as the builder's caller does).
 */
export function randomWorldPreview(
  options: RandomWorldOptions,
  cover: GroundCover,
  resolution = RANDOM_PREVIEW_RESOLUTION,
): RandomWorldPreview {
  const { brief: raw, notes } = randomWorldBrief(options);
  const { brief: normalized, issues } = normalizeWorldBrief(structuredClone(raw));
  if (!normalized || issues.length) throw new Error(`random world brief is invalid: ${issues.join("; ")}`);
  const brief = normalized as WorldBrief;
  const terrain = createBriefTerrain(brief);
  const { min, max } = briefWorldBounds(brief);
  const [width, depth] = [max[0] - min[0], max[1] - min[1]];
  const n = resolution;
  const worldAt = (i: number, j: number): [number, number] => [min[0] + ((i + 0.5) / n) * width, min[1] + ((j + 0.5) / n) * depth];
  const toUv = ([x, z]: readonly [number, number]): PreviewPoint => [(x - min[0]) / width, (z - min[1]) / depth];

  const heights = new Float64Array(n * n);
  const slopes = new Float64Array(n * n);
  const gradients = new Float64Array(n * n * 2);
  let [low, high] = [Infinity, -Infinity];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const [x, z] = worldAt(i, j);
      const h = terrain.height(x, z);
      const dx = (terrain.height(x + SLOPE_STEP, z) - h) / SLOPE_STEP;
      const dz = (terrain.height(x, z + SLOPE_STEP) - h) / SLOPE_STEP;
      const k = j * n + i;
      heights[k] = h;
      gradients[2 * k] = dx;
      gradients[2 * k + 1] = dz;
      slopes[k] = (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
  }

  const densities = { forest: coverDensity(brief.cover?.forest), rocks: coverDensity(brief.cover?.rocks), fields: coverDensity(brief.cover?.fields) };
  // Random worlds have no landmarks, so nothing keeps the ground open but the settlements.
  const paint = coverPaint(cover, brief, terrain, densities, { clearings: [], snowLine: coverSnowLine(cover, heights) });
  const colors = cover.layers.map((layer) => hexColor(layer.color));
  const pixels = new Uint8ClampedArray(n * n * 4);
  // Light from the north-west, a little above the horizon.
  const light = [-0.55, 0.62, -0.55];
  const lightLength = Math.hypot(light[0]!, light[1]!, light[2]!);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i;
      const [x, z] = worldAt(i, j);
      let rgb: [number, number, number];
      const lake = terrain.lake(x, z);
      if ((terrain.ocean && terrain.ocean.distance(x, z) < 0) || (lake && lake.inside > 0)) {
        rgb = [...PREVIEW_WATER_COLOR];
      } else {
        const weights = paint(x, z, slopes[k]!, heights[k]!);
        const total = weights.reduce((sum, w) => sum + w, 0) || 1;
        rgb = [0, 0, 0];
        weights.forEach((w, layer) => {
          const c = colors[layer]!;
          rgb[0] += (c[0] * w) / total;
          rgb[1] += (c[1] * w) / total;
          rgb[2] += (c[2] * w) / total;
        });
        // Hillshade: the ground's normal against the light, exaggerated so gentle hills read.
        const [dx, dz] = [gradients[2 * k]! * 2.5, gradients[2 * k + 1]! * 2.5];
        const normalLength = Math.hypot(dx, 1, dz);
        const lit = (-dx * light[0]! + light[1]! - dz * light[2]!) / (normalLength * lightLength);
        const shade = 0.55 + 0.6 * Math.max(0, lit);
        rgb = [rgb[0] * shade, rgb[1] * shade, rgb[2] * shade];
      }
      pixels[4 * k] = rgb[0];
      pixels[4 * k + 1] = rgb[1];
      pixels[4 * k + 2] = rgb[2];
      pixels[4 * k + 3] = 255;
    }
  }

  const nodes = new Map(brief.roads.nodes.map((node) => [node.id, toUv(briefToWorld(brief, node.at))]));
  const extent = worldExtent(options.size);
  return {
    resolution: n,
    pixels,
    extent,
    settlements: brief.settlements.map((settlement) => ({
      id: settlement.id,
      type: settlement.type,
      at: toUv(briefToWorld(brief, settlement.center)),
      radius: (settlement.radius ?? 150) / width,
    })),
    roads: brief.roads.edges.flatMap((edge) => {
      const [from, to] = [nodes.get(edge.from), nodes.get(edge.to)];
      return from && to ? [{ id: edge.id, roadClass: edge.roadClass, from, to }] : [];
    }),
    rivers: terrain.courses.map((course) => ({ id: course.id, points: course.points.map(toUv), width: course.width / width })),
    lakes: terrain.lakes.map((lake) => ({ id: lake.id, polygon: lake.polygon.map(toUv) })),
    heightRange: [low, high],
    notes,
  };
}
