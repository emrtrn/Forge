/**
 * Random world (docs/world-builder/RANDOM_WORLD_PLAN.md, step 2): a few choices
 * — size, landform, mountain height, settlements, road network, seed — become a
 * whole world brief, which the `world:brief` builder turns into a finished
 * greybox scene. Same choices and seed, same brief.
 *
 * Game-independent: no player start, no game mode; the level opens with a free
 * camera. The brief it writes is an ordinary `*.worldbrief.json`, so a random
 * world can be kept, read and edited like a planned one.
 *
 * Pure and deterministic; dependency-free. Placement on the ground is the
 * builder's: this module only lays out where things go.
 */
import { DEFAULT_RELIEF_CLEAR, type BriefModel, type BriefRelief } from "./worldBrief";
import type { RoadClass } from "./vocabulary";

/** Tile resolution per size; every size has 8 × 8 tiles 2 m apart (1, 2, 4 km). */
export const WORLD_SIZES = { small: 64, medium: 128, large: 256 } as const;
export type WorldSize = keyof typeof WORLD_SIZES;
export const WORLD_TILES = 8;
export const WORLD_SPACING = 2;

export const LANDFORMS = ["plain", "hills", "mountains", "valley"] as const;
export type Landform = (typeof LANDFORMS)[number];

export const MOUNTAIN_HEIGHTS = ["low", "medium", "high"] as const;
export type MountainHeight = (typeof MOUNTAIN_HEIGHTS)[number];

/** Default population and reach of each settlement type. */
export const SETTLEMENT_TYPES = {
  hamlet: { population: 40, radius: 90 },
  village: { population: 180, radius: 200 },
  town: { population: 600, radius: 320 },
} as const;
export type SettlementType = keyof typeof SETTLEMENT_TYPES;

/** Sections of a valley world's winding floor, north to south. */
const VALLEY_SECTIONS = 9;
/** Side slope of a valley world below its mountains, degrees. */
const VALLEY_SIDE_DEG = 12;

/** `between`: roads join the settlements; `exits`: and two roads leave the map. */
export const ROAD_NETWORKS = ["between", "exits"] as const;
export type RoadNetwork = (typeof ROAD_NETWORKS)[number];

/** Region profile a random world uses unless told otherwise (Forge's pilot profile). */
export const DEFAULT_REGION_PROFILE = "assets/world-pilot/Levels/WbPilotValley.regionprofile.json";

/** Forge's starter nature models: rocks by where they lie, conifers, bushes, grass. */
export const DEFAULT_NATURE_MODELS: readonly BriefModel[] = [
  ...["02", "03", "06", "07"].map((n): BriefModel => ({ role: "prop.rock", source: "ready", file: `assets/starter-content/StaticMeshes/Environment/Forest_Rock_${n}.glb`, variant: "high" })),
  ...["03", "05", "08"].map((n): BriefModel => ({ role: "prop.rock", source: "ready", file: `assets/starter-content/StaticMeshes/Environment/Forest_Rock_${n}.glb`, variant: "slope" })),
  ...["01", "04", "05", "09"].map((n): BriefModel => ({ role: "prop.rock", source: "ready", file: `assets/starter-content/StaticMeshes/Environment/Forest_Rock_${n}.glb`, variant: "river" })),
];

export interface RandomSettlement {
  type: SettlementType;
  population?: number;
  radius?: number;
}

export interface RandomWorldOptions {
  /** Brief and recipe id; letters, digits, `_`, `-`. */
  id: string;
  name: string;
  /** uint32. */
  seed: number;
  size: WorldSize;
  landform: Landform;
  mountainHeight: MountainHeight;
  settlements: RandomSettlement[];
  roads: RoadNetwork;
  regionProfile?: string;
  models?: readonly BriefModel[];
}

export interface RandomWorld {
  /** A `*.worldbrief.json` document, before normalization. */
  brief: Record<string, unknown>;
  /** What could not be done as asked (a settlement with no room), in plain words. */
  notes: string[];
}

type Point = [number, number];

/** Small deterministic generator (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value: number): number => Math.round(value * 10) / 10;
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** World extent of a size, metres. */
export function worldExtent(size: WorldSize): number {
  return WORLD_TILES * WORLD_SIZES[size] * WORLD_SPACING;
}

export function randomWorldBrief(options: RandomWorldOptions): RandomWorld {
  const notes: string[] = [];
  const next = random(options.seed);
  const extent = worldExtent(options.size);
  const half = extent / 2;
  // Smaller worlds get lower, tighter mountains so their slopes stay walkable.
  const scale = extent / 4096;
  const heightScale = 0.45 + 0.55 * scale;
  const mountainHeight = { low: 150, medium: 300, high: 500 }[options.mountainHeight] * heightScale;
  const hillHeight = { low: 18, medium: 32, high: 50 }[options.mountainHeight];

  // Valley: a floor winding north to south across the whole map, falling to the south.
  const valley = options.landform === "valley";
  const valleyHalf = round(0.09 * extent);
  const valleyFall = round(0.06 * mountainHeight + 6);
  const valleySections = valley
    ? Array.from({ length: VALLEY_SECTIONS }, (_, index) => {
      const north = round(half - (index * extent) / (VALLEY_SECTIONS - 1));
      const centre = round((next() * 2 - 1) * 0.06 * extent);
      const width = round(valleyHalf * (0.8 + 0.4 * next()));
      const rock = round(width + 0.12 * extent);
      return { north, floor: [centre - width, centre + width] as Point, rock: [centre - rock, centre + rock] as Point };
    })
    : [];
  /** The valley floor's east edges at `north`, linear between sections. */
  const floorAt = (north: number): Point => {
    const index = Math.min(VALLEY_SECTIONS - 2, Math.max(0, Math.floor((half - north) / (extent / (VALLEY_SECTIONS - 1)))));
    const [a, b] = [valleySections[index]!, valleySections[index + 1]!];
    const t = (a.north - north) / (a.north - b.north);
    return [a.floor[0] + (b.floor[0] - a.floor[0]) * t, a.floor[1] + (b.floor[1] - a.floor[1]) * t];
  };

  // Settlements: random centres inside the map (and on the valley floor), kept apart.
  const placed: Array<{ id: string; at: Point; type: SettlementType; population: number; radius: number }> = [];
  options.settlements.forEach((settlement, index) => {
    const spec = SETTLEMENT_TYPES[settlement.type];
    const radius = settlement.radius ?? spec.radius;
    const margin = Math.max(radius * 0.6 + 40, 0.1 * extent);
    let at: Point | null = null;
    for (let attempt = 0; attempt < 400 && !at; attempt += 1) {
      const north = -half + margin + next() * (extent - 2 * margin);
      const [floorW, floorE] = valley ? floorAt(north) : [0, 0];
      const east = valley
        ? (floorW + floorE) / 2 + (next() * 2 - 1) * (floorE - floorW) * 0.25
        : -half + margin + next() * (extent - 2 * margin);
      const candidate: Point = [round(east), round(north)];
      if (placed.every((other) => distance(other.at, candidate) >= (other.radius + radius) * 0.9 + 60)) at = candidate;
    }
    if (!at) {
      notes.push(`settlement ${index + 1} (${settlement.type}): no room left on this map; left out`);
      return;
    }
    placed.push({ id: `settlement-${index + 1}`, at, type: settlement.type, population: settlement.population ?? spec.population, radius });
  });

  // Roads: the shortest network joining every settlement (Prim), then the exits.
  const nodes: Array<{ id: string; at: Point; kind: "end" | "junction" }> = placed.map((entry) => ({ id: entry.id, at: entry.at, kind: "junction" }));
  const edges: Array<{ id: string; from: string; to: string; roadClass: RoadClass }> = [];
  const classBetween = (a: SettlementType, b: SettlementType): RoadClass => (a === "town" || b === "town" ? "collector" : a === "hamlet" || b === "hamlet" ? "track" : "local");
  if (placed.length > 1) {
    const joined = new Set([0]);
    while (joined.size < placed.length) {
      let best: [number, number, number] | null = null;
      for (const i of joined) {
        for (let j = 0; j < placed.length; j += 1) {
          if (joined.has(j)) continue;
          const length = distance(placed[i]!.at, placed[j]!.at);
          if (!best || length < best[2]) best = [i, j, length];
        }
      }
      const [i, j] = best!;
      joined.add(j);
      edges.push({ id: `${placed[i]!.id}-${placed[j]!.id}`, from: placed[i]!.id, to: placed[j]!.id, roadClass: classBetween(placed[i]!.type, placed[j]!.type) });
    }
  }
  const wantsExits = options.roads === "exits" || (placed.length === 1);
  if (placed.length === 1 && options.roads === "between") notes.push("one settlement: a road leads it off the map so its streets have a way in");
  if (wantsExits && placed.length > 0) {
    const inset = 6;
    // A valley leaves the map in the middle of its floor.
    const edgeEast = (east: number, north: number): number => {
      if (!valley) return round(east);
      const [floorW, floorE] = floorAt(north);
      return round((floorW + floorE) / 2);
    };
    const border = (from: Point, side: number): Point => {
      const [east, north] = from;
      return [[edgeEast(east, half - inset), half - inset], [half - inset, round(north)], [edgeEast(east, -half + inset), -half + inset], [-half + inset, round(north)]][side] as Point;
    };
    const sideNearest = (from: Point): number => {
      const gaps = [half - from[1], half - from[0], from[1] + half, from[0] + half];
      return gaps.indexOf(Math.min(...gaps));
    };
    // The valley's exits run along it, north and south.
    const largest = [...placed].sort((a, b) => b.population - a.population)[0]!;
    const first = valley ? (largest.at[1] >= 0 ? 0 : 2) : sideNearest(largest.at);
    const opposite = (first + 2) % 4;
    const second = [...placed].sort((a, b) => distance(a.at, border(a.at, opposite)) - distance(b.at, border(b.at, opposite)))[0]!;
    const exits: Array<[typeof largest, number]> = placed.length === 1 && options.roads === "between" ? [[largest, first]] : [[largest, first], [second, opposite]];
    exits.forEach(([settlement, side], index) => {
      const id = `exit-${index + 1}`;
      nodes.push({ id, at: border(settlement.at, side), kind: "end" });
      edges.push({ id: `${settlement.id}-${id}`, from: settlement.id, to: id, roadClass: settlement.type === "hamlet" ? "local" : "collector" });
    });
  }

  // Relief: the landform's hills and mountains; the valley keeps its floor.
  const relief: Partial<BriefRelief> = {
    clear: {
      ...structuredClone(DEFAULT_RELIEF_CLEAR),
      settlements: { inner: 40, falloff: round(200 + 200 * scale) },
      roads: { inner: 20, falloff: round(120 + 120 * scale) },
    },
  };
  const mountains = {
    height: round(mountainHeight),
    lift: round(mountainHeight * 0.15),
    wavelength: round(500 + 700 * scale),
    spurStretch: 0.7,
    directionDeg: Math.round(next() * 180),
  };
  if (options.landform === "plain") relief.hills = { height: 3, wavelength: 260 };
  if (options.landform === "hills") relief.hills = { height: hillHeight, wavelength: 320 };
  if (options.landform === "mountains") {
    relief.hills = { height: 8, wavelength: 300 };
    relief.mountains = mountains;
  }
  if (valley) {
    relief.hills = { height: 6, wavelength: 260 };
    // The ridges run along the valley; its sides rise over a long stretch, not as a wall.
    relief.mountains = { ...mountains, height: round(mountains.height * 0.75), lift: round(mountains.lift * 0.75), directionDeg: 0 };
    relief.clear!.valleyFloors = { inner: 10, falloff: round(0.22 * extent) };
  }
  const peak = (relief.mountains ? relief.mountains.height + relief.mountains.lift : 0) + 2.5 * (relief.hills?.height ?? 0)
    + (valley ? valleyFall + half * Math.tan(VALLEY_SIDE_DEG * Math.PI / 180) : 0);

  const brief: Record<string, unknown> = {
    schema: 1,
    type: "worldBrief",
    id: options.id,
    name: options.name,
    seed: options.seed >>> 0,
    frame: { east: 0, north: 0, elevation: 0 },
    area: { west: -half, east: half, south: -half, north: half },
    terrain: {
      id: "terrain",
      name: options.name,
      tileQuads: WORLD_SIZES[options.size],
      spacing: WORLD_SPACING,
      heightRange: [-60, Math.ceil(peak + 60)],
      relief,
    },
    regionProfile: options.regionProfile ?? DEFAULT_REGION_PROFILE,
    valleys: options.landform === "valley" ? [{
      id: "valley",
      axis: "northSouth",
      sections: valleySections,
      floorProfile: [{ north: half, elevation: valleyFall }, { north: -half, elevation: 0 }],
      sideSlopeDeg: VALLEY_SIDE_DEG,
    }] : [],
    regions: [],
    water: [],
    roads: { nodes, edges },
    landmarks: [],
    settlements: placed.map((entry) => ({ id: entry.id, type: entry.type, center: entry.at, radius: entry.radius, population: entry.population })),
    props: [],
    models: structuredClone(options.models ?? DEFAULT_NATURE_MODELS),
  };
  return { brief, notes };
}
