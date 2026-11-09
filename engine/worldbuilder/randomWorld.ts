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
 * Rivers and lakes (`randomWater.ts`) come last, on their own random stream,
 * so asking for water leaves the rest of a seed's world as it was.
 *
 * Pure and deterministic; dependency-free. Placement on the ground is the
 * builder's: this module only lays out where things go.
 */
import { DEFAULT_RELIEF_CLEAR, type BriefModel, type BriefRelief, type CoverDensityLevel } from "./worldBrief";
import { islandOcean, oceanLandDistance, type SeaSide } from "./island";
import type { RoadClass } from "./vocabulary";
import { randomWater } from "./randomWater";
import { OCEAN_LIMITS } from "../scene/oceanBudget";

/** Tile resolution per size; every size has 8 × 8 tiles 2 m apart (1, 2, 4 km). */
export const WORLD_SIZES = { small: 64, medium: 128, large: 256 } as const;
export type WorldSize = keyof typeof WORLD_SIZES;
export const WORLD_TILES = 8;
export const WORLD_SPACING = 2;

export const LANDFORMS = ["plain", "hills", "mountains", "valley", "island", "coast"] as const;
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

/** Ground covers Forge ships (`groundCover.ts`), by name. */
export const COVERS = {
  forest: "assets/world-builder/covers/forest.cover.json",
  meadow: "assets/world-builder/covers/meadow.cover.json",
  farmland: "assets/world-builder/covers/farmland.cover.json",
  steppe: "assets/world-builder/covers/steppe.cover.json",
  desert: "assets/world-builder/covers/desert.cover.json",
  alpine: "assets/world-builder/covers/alpine.cover.json",
} as const;
export type CoverName = keyof typeof COVERS;

/** Region profile a random world uses unless told otherwise (Forge's pilot profile). */
export const DEFAULT_REGION_PROFILE = "assets/world-builder/Levels/WbPilotValley.regionprofile.json";

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
  /** Ground cover; without one the brief names none and the pilot's paint is used (the same look as `forest`). */
  cover?: CoverName;
  /** Forest, rock and field density of the cover; medium by default. */
  densities?: Partial<Record<"forest" | "rocks" | "fields", CoverDensityLevel>>;
  /** Rivers and lakes, 0–3 each (`randomWater.ts`); none by default. */
  rivers?: number;
  lakes?: number;
  /** Which side of a Coast world faces the open sea. */
  seaSide?: SeaSide;
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

/** The UI, request boundary and generator share the native Ocean cell cap. */
export function oceanWorldSizeSupported(size: unknown): size is WorldSize {
  if (typeof size !== "string" || !Object.hasOwn(WORLD_SIZES, size)) return false;
  const axis = WORLD_TILES * WORLD_SIZES[size as WorldSize];
  return axis <= OCEAN_LIMITS.axisCells && axis * axis <= OCEAN_LIMITS.cells;
}

export function randomWorldBrief(options: RandomWorldOptions): RandomWorld {
  if ((options.landform === "island" || options.landform === "coast") && !oceanWorldSizeSupported(options.size)) throw new Error("Island/Coast supports Small/Medium worlds only (Ocean terrain budget)");
  if (options.landform === "island" && (options.rivers ?? 0) > 0) throw new Error("Island rivers require the river-mouth integration; choose 0 rivers");
  const notes: string[] = [];
  const next = random(options.seed);
  const extent = worldExtent(options.size);
  const half = extent / 2;
  const island = options.landform === "island" ? { center: [0, 0] as Point, radius: round(extent * .37), shoreWidth: 60, landHeight: 12 } : undefined;
  const coastal = options.landform === "coast" ? { center: [0, 0] as Point, seaSide: options.seaSide ?? "west", shoreWidth: 60, landHeight: 12, beachWidth: 62.5 } : undefined;
  const ocean = island || coastal ? { id: "ocean", surfaceElevation: 0, offshoreDepth: 40 } : undefined;
  if (coastal) {
    const reference = islandOcean({ terrain: { coast: coastal }, ocean: ocean!, frame: { east: 0, north: 0, elevation: 0 }, seed: options.seed })!;
    const axis = coastal.seaSide === "west" ? [1, 0] : coastal.seaSide === "east" ? [-1, 0] : coastal.seaSide === "north" ? [0, 1] : [0, -1];
    // Preserve every bay/cape; compensate the seed's mean oscillation within the map.
    // The 50% beach boundary, not the waterline, leaves 70% interior land.
    let mean = 0;
    for (let i = 0; i < 1024; i++) {
      const along = -half + (i + .5) * extent / 1024;
      mean += reference.distance(-axis[1]! * along, axis[0]! * along) / 1024;
    }
    const shift = -.2 * extent - coastal.beachWidth + mean;
    coastal.center = [round(axis[0]! * shift), round(-axis[1]! * shift)];
  }
  const coast = ocean ? islandOcean({ terrain: { ...(island ? { island } : {}), ...(coastal ? { coast: coastal } : {}) }, ocean, frame: { east: 0, north: 0, elevation: 0 }, seed: options.seed }) : undefined;
  if (island && options.roads === "exits") notes.push("island: roads stay on the island; no off-map exits");
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

  // A valley with a river: the side of the floor its settlements take, from the water's own stream.
  const settlementSide = valley && (options.rivers ?? 0) > 0 ? (random((options.seed ^ 0x2545f491) >>> 0)() < 0.5 ? -1 : 1) : 0;
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
      // With a river, a valley's settlements keep to one side of its floor and leave the other to the water.
      const across = valley ? next() * 2 - 1 : 0;
      const east = valley
        ? (floorW + floorE) / 2 + (settlementSide === 0 ? across * 0.25 : settlementSide * (0.3 + 0.12 * Math.abs(across))) * (floorE - floorW)
        : -half + margin + next() * (extent - 2 * margin);
      const candidate: Point = [round(east), round(north)];
      if (coast && oceanLandDistance(coast, candidate[0], -candidate[1]) < Math.max(90, radius * .6 + 30)) continue;
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
  if (island && placed.length === 1) {
    // A lone island village still needs a street to grow from, without an off-map exit.
    const settlement = placed[0]!;
    const length = Math.hypot(...settlement.at);
    const heading: Point = length > 1 ? [-settlement.at[0] / length, -settlement.at[1] / length] : [1, 0];
    const at: Point = [round(settlement.at[0] + heading[0] * 120), round(settlement.at[1] + heading[1] * 120)];
    nodes.push({ id: "island-access", at, kind: "end" });
    edges.push({ id: `${settlement.id}-island-access`, from: settlement.id, to: "island-access", roadClass: "local" });
  }
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
  const wantsExits = !island && (options.roads === "exits" || (placed.length === 1));
  if (!island && placed.length === 1 && options.roads === "between") notes.push("one settlement: a road leads it off the map so its streets have a way in");
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
    const drySides = [0, 1, 2, 3].filter(side => !coast || oceanLandDistance(coast, border(largest.at, side)[0], -border(largest.at, side)[1]) > 80);
    const nearest = sideNearest(largest.at);
    const first = valley ? (largest.at[1] >= 0 ? 0 : 2) : drySides.includes(nearest) ? nearest : drySides[0]!;
    const opposite = drySides.includes((first + 2) % 4) ? (first + 2) % 4 : drySides.find(side => side !== first) ?? first;
    const second = placed.filter(entry => !coast || oceanLandDistance(coast, border(entry.at, opposite)[0], -border(entry.at, opposite)[1]) > 80)
      .sort((a, b) => distance(a.at, border(a.at, opposite)) - distance(b.at, border(b.at, opposite)))[0]!;
    const exits: Array<[typeof largest, number]> = (placed.length === 1 && options.roads === "between") || opposite === first ? [[largest, first]] : [[largest, first], [second, opposite]];
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
  if (island || coastal) {
    relief.hills = { height: hillHeight * .5, wavelength: 260 };
    relief.mountains = { ...mountains, height: round(mountains.height * .55), lift: round(mountains.lift * .55) };
  }
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
      ...(island ? { island } : {}),
      ...(coastal ? { coast: coastal } : {}),
    },
    regionProfile: options.regionProfile ?? DEFAULT_REGION_PROFILE,
    ...(options.cover ? {
      cover: {
        file: COVERS[options.cover],
        ...Object.fromEntries(Object.entries(options.densities ?? {}).filter(([, level]) => level && level !== "medium")),
      },
    } : {}),
    valleys: options.landform === "valley" ? [{
      id: "valley",
      axis: "northSouth",
      sections: valleySections,
      floorProfile: [{ north: half, elevation: valleyFall }, { north: -half, elevation: 0 }],
      sideSlopeDeg: VALLEY_SIDE_DEG,
    }] : [],
    regions: [],
    water: [],
    ...(ocean ? { ocean } : {}),
    roads: { nodes, edges },
    landmarks: [],
    settlements: placed.map((entry) => ({ id: entry.id, type: entry.type, center: entry.at, radius: entry.radius, population: entry.population })),
    props: [],
    models: structuredClone(options.models ?? DEFAULT_NATURE_MODELS),
  };
  // Water last, on its own random stream: the same seed with water is the same world plus water.
  if ((options.rivers ?? 0) > 0 || (options.lakes ?? 0) > 0) {
    brief.water = randomWater(brief, { rivers: options.rivers ?? 0, lakes: options.lakes ?? 0, seed: options.seed, size: options.size }, notes);
  }
  return { brief, notes };
}
