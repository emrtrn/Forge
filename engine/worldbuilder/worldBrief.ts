/**
 * World brief: the general world summary a game design document is reduced to
 * (plan v0.4 decision 20), stored beside its level as `<Level>.worldbrief.json`.
 * The design document itself stays in the game's repository; Forge only reads
 * this schema. `npm run world:brief` builds the level from it
 * (`tools/world/worldBriefBuild.ts`, docs/world-builder/WORLD_BRIEF.md).
 *
 * Coordinates are the design document's: metres east and north (north up), and
 * elevation above the document's datum. `frame` is the brief point that sits on
 * the Forge world origin (`metricFrame.ts`): x = east - frame.east, z = frame.north - north,
 * y = elevation - frame.elevation. Widths, depths and sizes are plain metres.
 *
 * `normalizeWorldBrief` is the single source of field shape. It is strict: any
 * issue means the brief is not built. Dependency-free; no three.js.
 */
import { metricElevationToWorld, metricToWorld, type MetricFrame } from "./metricFrame";
import { ISLAND_RADIAL_SAMPLES } from "./islandShape";
import {
  arrayOf,
  type Ctx,
  idSet,
  isFiniteNumber,
  isOneOf,
  isRecord,
  issue,
  normalizeAssetPath,
  normalizeSeed,
  pointList,
  reject,
  requireId,
  requireNumber,
  requirePoint,
  requireRange,
  requireToken,
  round,
  uniqueEntries,
  WORLD_MAX_COORDINATE,
  type WorldPoint,
} from "./normalize";
import {
  createWorldRecipe,
  PLAN_SOURCES,
  REFERENCE_VIEWS,
  ROAD_NODE_KINDS,
  type PlanProvenance,
  type PlanSource,
  type ReferenceView,
  type RoadNodeKind,
  type WorldRecipe,
} from "./recipe";
import { ROAD_CLASSES, type RoadClass } from "./vocabulary";

export const WORLD_BRIEF_SCHEMA_VERSION = 1;

/** Steps of building a brief (`tools/world/worldBriefBuild.ts`), in the order they start; a progress bar takes its share from the index. */
export const WORLD_BUILD_STEPS = ["terrain", "paint", "settlements", "roads", "ground", "placements", "files"] as const;
export type WorldBuildStep = (typeof WORLD_BUILD_STEPS)[number];
export const WORLD_BRIEF_SUFFIX = ".worldbrief.json";

/** Where a model comes from (decision 21): Claude in Blender, Tripo AI, or a ready-made model. */
export const MODEL_SOURCES = ["blender", "tripo", "ready"] as const;
export type ModelSource = (typeof MODEL_SOURCES)[number];

/** WES seasons and weather presets (`worldEnvironment.ts`); kept here so the schema stays dependency-free. */
export const BRIEF_SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof BRIEF_SEASONS)[number];
export const BRIEF_WEATHER_PRESETS = ["clear", "cloudy", "rain", "snow", "fog"] as const;
export type WeatherPreset = (typeof BRIEF_WEATHER_PRESETS)[number];
const SEASONS = BRIEF_SEASONS;
const WEATHER_PRESETS = BRIEF_WEATHER_PRESETS;

/** Tile sizes a new World Terrain may have (`WORLD_TERRAIN_CREATE_TILE_QUADS`); kept here so the schema stays dependency-free. */
export const BRIEF_TILE_QUADS = [64, 128, 256] as const;
export type BriefTileQuads = (typeof BRIEF_TILE_QUADS)[number];

export const VALLEY_AXES = ["northSouth"] as const;
export type ValleyAxis = (typeof VALLEY_AXES)[number];

/** `[east, north]`, metres. */
export type BriefPoint = [number, number];

/** Where an element came from; `reference` means measured on the reference map. */
export interface BriefProvenance {
  source: PlanSource;
  /** 0..1, only with `source: "reference"`. */
  confidence?: number;
}

export interface BriefArea {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface BriefTerrain {
  /** The Landscape actor id. */
  id: string;
  name: string;
  tileQuads: BriefTileQuads;
  spacing: number;
  /** Lowest and highest elevation the terrain may hold. */
  heightRange: [number, number];
  /** Hills and mountains over the valleys (`engine/worldbuilder/briefTerrain.ts`); absent: none. */
  relief?: BriefRelief;
  /** Star-shaped island; the coast is shared by all generators. */
  island?: { center: BriefPoint; radius: number; shoreWidth: number; landHeight: number; radii?: number[] };
  coast?: { center: BriefPoint; seaSide: "west" | "east" | "north" | "south"; shoreWidth: number; landHeight: number; beachWidth?: number };
}

export interface BriefOcean {
  id: string;
  /** Elevation in the brief's datum, converted once when building. */
  surfaceElevation: number;
  offshoreDepth: number;
  /** Optional baked seabed profile; absent retains the legacy shoreWidth exponential. */
  shoreProfile?: { shallowDistance: number; shallowDepth: number; deepDistance: number };
}

/** Distance band, metres: no mountain within `inner`, full height `falloff` further out. */
export interface BriefReliefBand {
  inner: number;
  falloff: number;
}

/**
 * Relief added to the ground of the whole area. Hills roll everywhere (softer
 * where the mountains stay off); mountains are ridged and stay off the ground
 * listed in `clear`, so settlements, roads, water and valley floors keep a
 * gentle ground and the roads run through passes.
 */
export interface BriefRelief {
  hills?: { height: number; wavelength: number };
  mountains?: {
    /** Height of the ridges above `lift`, metres. */
    height: number;
    /** Ground raised wherever the mountains stand at full height, metres. */
    lift: number;
    /** Size of the largest ridges, metres. */
    wavelength: number;
    /** 1 = round massifs; below 1 lengthens the crests along `directionDeg`. */
    spurStretch: number;
    /** Crest direction, degrees clockwise from north. */
    directionDeg: number;
  };
  clear: { settlements: BriefReliefBand; roads: BriefReliefBand; water: BriefReliefBand; valleyFloors: BriefReliefBand };
}

export const DEFAULT_RELIEF_CLEAR: Readonly<BriefRelief["clear"]> = {
  settlements: { inner: 40, falloff: 260 },
  roads: { inner: 20, falloff: 160 },
  water: { inner: 25, falloff: 200 },
  valleyFloors: { inner: 10, falloff: 200 },
};

/** One cut across a valley: the floor's and the rock line's east coordinates at `north`. */
export interface BriefValleySection {
  north: number;
  floor: [number, number];
  rock: [number, number];
}

/** Valley relief, metres (`engine/worldbuilder/briefTerrain.ts` reads it). */
export interface BriefValleyRelief {
  /** Horizontal distance over which the floor eases into the side slope. */
  slopeFoot: number;
  /** Spurs and gullies running down the slopes. */
  spurs: number;
  /** Broken ground above the rock line. */
  ridges: number;
  /** General roughness of the slopes. */
  noise: number;
}

export const DEFAULT_VALLEY_RELIEF: Readonly<BriefValleyRelief> = { slopeFoot: 18, spurs: 26, ridges: 16, noise: 10 };
const VALLEY_RELIEF_KEYS = ["slopeFoot", "spurs", "ridges", "noise"] as const;
const VALLEY_FIELDS = new Set([
  "id", "axis", "sections", "floorProfile", "sideSlopeDeg", "relief", "ridgeElevation", "slopeCover", "source", "confidence",
]);

export interface BriefValley extends BriefProvenance {
  id: string;
  axis: ValleyAxis;
  /** North to south. */
  sections: BriefValleySection[];
  /** Floor elevation along the valley, north to south; linear between points. */
  floorProfile: Array<{ north: number; elevation: number }>;
  sideSlopeDeg: number;
  /** Relief added over the plain valley shape, metres; omitted keys use `DEFAULT_VALLEY_RELIEF`. */
  relief?: Partial<BriefValleyRelief>;
  ridgeElevation?: [number, number];
  /** Land cover on both sides between the floor and the rock line, such as `forest.conifer`. */
  slopeCover?: string;
}

export interface BriefRegion extends BriefProvenance {
  id: string;
  kind: string;
  polygon: BriefPoint[];
}

export interface BriefWater extends BriefProvenance {
  /** A coastal river ends at the shared Ocean surface. */
  outlet?: "ocean";
  id: string;
  /** Token such as `river`, `stream`, `lake`. */
  kind: string;
  /** Centre line in flow order (rivers); exactly one of `line` / `polygon`. */
  line?: BriefPoint[];
  polygon?: BriefPoint[];
  /** Water surface width, metres. */
  width?: number;
  /** Bed depth below the ground beside it, metres. */
  bedDepth?: number;
  /** Water surface below the ground beside it, metres. */
  surfaceDepth?: number;
}

export interface BriefRoadNode extends BriefProvenance {
  id: string;
  at: BriefPoint;
  kind: RoadNodeKind;
}

export interface BriefRoadEdge extends BriefProvenance {
  id: string;
  from: string;
  to: string;
  roadClass: RoadClass;
  /** Corridor hint for the route solver, not the final line. */
  corridor?: BriefPoint[];
}

export interface BriefLandmark extends BriefProvenance {
  id: string;
  role: string;
  at: BriefPoint;
  /** Level ground under it: east-west and north-south size, and the falloff around it. */
  pad?: { size: [number, number]; falloff: number };
}

export interface BriefSettlement extends BriefProvenance {
  id: string;
  /** Token such as `hamlet`, `village`, `town`. */
  type: string;
  center: BriefPoint;
  radius?: number;
  population?: number;
  protected?: boolean;
}

/** A single object placed by role, such as a woodpile or a signpost. */
export interface BriefProp {
  id: string;
  role: string;
  at: BriefPoint;
  /** Clockwise from north, degrees. */
  rotationDeg: number;
  scale: number;
  collision: boolean;
}

export interface BriefEnvironment {
  season: Season;
  weather: { preset: WeatherPreset; intensity: number };
  /** Fixed hour of day, 0..24; absent leaves the level's clock alone. */
  hour?: number;
}

/** One model a role may use. A role with several rows has variants; `variant` groups them. */
export interface BriefModel {
  role: string;
  source: ModelSource;
  /** Public-root-relative model file. */
  file: string;
  variant?: string;
}

export interface WorldBrief {
  schema: typeof WORLD_BRIEF_SCHEMA_VERSION;
  type: "worldBrief";
  /** The recipe id the brief builds. */
  id: string;
  name?: string;
  seed: number;
  frame: MetricFrame;
  area: BriefArea;
  terrain: BriefTerrain;
  /** Public-root-relative `*.regionprofile.json`. */
  regionProfile?: string;
  /** Ground cover (`groundCover.ts`); without one the pilot's paint and plants are used. */
  cover?: BriefCover;
  /** Public-root-relative image covering `area`. */
  reference?: { image: string; view: ReferenceView };
  playerStart?: BriefPoint;
  valleys: BriefValley[];
  regions: BriefRegion[];
  water: BriefWater[];
  ocean?: BriefOcean;
  roads: { nodes: BriefRoadNode[]; edges: BriefRoadEdge[] };
  landmarks: BriefLandmark[];
  settlements: BriefSettlement[];
  props: BriefProp[];
  environment?: BriefEnvironment;
  models: BriefModel[];
}

/** Density levels of a ground cover (`groundCover.ts`). */
export const COVER_DENSITY_LEVELS = ["low", "medium", "high"] as const;
export type CoverDensityLevel = (typeof COVER_DENSITY_LEVELS)[number];

export interface BriefCover {
  /** Public-root-relative `*.cover.json`. */
  file: string;
  forest?: CoverDensityLevel;
  rocks?: CoverDensityLevel;
  fields?: CoverDensityLevel;
}

export interface WorldBriefNormalization {
  brief: WorldBrief | null;
  issues: string[];
}

const TOP_LEVEL_FIELDS = new Set([
  "schema", "type", "id", "name", "seed", "frame", "area", "terrain", "regionProfile", "cover", "reference", "playerStart",
  "valleys", "regions", "water", "ocean", "roads", "landmarks", "settlements", "props", "environment", "models",
]);

/** `<Level>.worldbrief.json` beside a `.level.json` / `.layout.json` level. */
export function worldBriefPath(levelPath: string): string {
  const normalized = levelPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const base = normalized.replace(/(\.level|\.layout)?\.json$/i, "");
  if (!base || base === normalized) throw new Error("world brief requires a .json level path");
  return `${base}${WORLD_BRIEF_SUFFIX}`;
}

/** The level a brief builds by default: `<Name>.worldbrief.json` → `<Name>.level.json`. */
export function worldBriefLevelPath(briefPath: string): string {
  const normalized = briefPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.endsWith(WORLD_BRIEF_SUFFIX) || normalized.length === WORLD_BRIEF_SUFFIX.length) {
    throw new Error(`world brief path must end with ${WORLD_BRIEF_SUFFIX}`);
  }
  return `${normalized.slice(0, -WORLD_BRIEF_SUFFIX.length)}.level.json`;
}

function metres(ctx: Ctx, path: string, value: unknown): number | null {
  return requireNumber(ctx, path, value, -WORLD_MAX_COORDINATE, WORLD_MAX_COORDINATE);
}

function positive(ctx: Ctx, path: string, value: unknown, max = WORLD_MAX_COORDINATE): number | null {
  if (isFiniteNumber(value) && value > 0 && value <= max) return round(value);
  return reject(ctx, path, `must be a number above 0 and at most ${max}`);
}

function optional<T>(value: unknown, read: () => T | null): T | undefined {
  return value === undefined ? undefined : read() ?? undefined;
}

function insideArea(ctx: Ctx, path: string, point: BriefPoint, area: BriefArea | null): void {
  if (!area) return;
  if (point[0] < area.west || point[0] > area.east || point[1] < area.south || point[1] > area.north) {
    issue(ctx, path, "lies outside the area");
  }
}

function points(ctx: Ctx, path: string, value: unknown, minimum: number, area: BriefArea | null): BriefPoint[] | null {
  const list = pointList(ctx, path, value, minimum);
  list?.forEach((point, index) => insideArea(ctx, `${path}[${index}]`, point, area));
  return list;
}

function point(ctx: Ctx, path: string, value: unknown, area: BriefArea | null): BriefPoint | null {
  const result = requirePoint(ctx, path, value);
  if (result) insideArea(ctx, path, result, area);
  return result;
}

function provenance(ctx: Ctx, path: string, entry: Record<string, unknown>): BriefProvenance {
  const source = entry.source === undefined ? "manual" : entry.source;
  if (!isOneOf(PLAN_SOURCES, source)) {
    issue(ctx, `${path}.source`, `must be one of ${PLAN_SOURCES.join(", ")}`);
    return { source: "manual" };
  }
  if (entry.confidence === undefined) return { source };
  if (source !== "reference") {
    issue(ctx, `${path}.confidence`, "is only kept for source \"reference\"");
    return { source };
  }
  const confidence = requireNumber(ctx, `${path}.confidence`, entry.confidence, 0, 1);
  return confidence === null ? { source } : { source, confidence };
}

function eastPair(ctx: Ctx, path: string, value: unknown): [number, number] | null {
  return requireRange(ctx, path, value, -WORLD_MAX_COORDINATE, WORLD_MAX_COORDINATE);
}

function normalizeArea(ctx: Ctx, value: unknown): BriefArea | null {
  if (!isRecord(value)) return reject(ctx, "area", "must be an object");
  const [west, east, south, north] = (["west", "east", "south", "north"] as const)
    .map((side) => metres(ctx, `area.${side}`, value[side]));
  if (west === null || east === null || south === null || north === null) return null;
  if (west! >= east! || south! >= north!) return reject(ctx, "area", "must have west < east and south < north");
  return { west: west!, east: east!, south: south!, north: north! };
}

function normalizeFrame(ctx: Ctx, value: unknown): MetricFrame | null {
  if (value === undefined) return { east: 0, north: 0, elevation: 0 };
  if (!isRecord(value)) return reject(ctx, "frame", "must be an object");
  const east = metres(ctx, "frame.east", value.east ?? 0);
  const north = metres(ctx, "frame.north", value.north ?? 0);
  const elevation = metres(ctx, "frame.elevation", value.elevation ?? 0);
  return east === null || north === null || elevation === null ? null : { east, north, elevation };
}

function normalizeTerrain(ctx: Ctx, value: unknown): BriefTerrain | null {
  if (!isRecord(value)) return reject(ctx, "terrain", "must be an object");
  const id = requireId(ctx, "terrain", value.id);
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : reject(ctx, "terrain.name", "must be a non-empty string");
  const tileQuads = (BRIEF_TILE_QUADS as readonly unknown[]).includes(value.tileQuads)
    ? value.tileQuads as BriefTileQuads
    : reject(ctx, "terrain.tileQuads", `must be one of ${BRIEF_TILE_QUADS.join(", ")}`);
  const spacing = positive(ctx, "terrain.spacing", value.spacing, 64);
  const heightRange = eastPair(ctx, "terrain.heightRange", value.heightRange);
  if (heightRange && heightRange[0] === heightRange[1]) issue(ctx, "terrain.heightRange", "must span some height");
  for (const key of Object.keys(value)) {
    if (!["id", "name", "tileQuads", "spacing", "heightRange", "relief", "island", "coast"].includes(key)) issue(ctx, `terrain.${key}`, "is not a terrain field");
  }
  const relief = value.relief === undefined ? undefined : normalizeRelief(ctx, value.relief);
  let island: BriefTerrain["island"];
  if (value.island !== undefined) {
    if (!isRecord(value.island)) return reject(ctx, "terrain.island", "must be an object");
    const raw = value.island;
    for (const key of Object.keys(raw)) if (!["center", "radius", "shoreWidth", "landHeight", "radii"].includes(key)) issue(ctx, `terrain.island.${key}`, "is not an island field");
    const center = requirePoint(ctx, "terrain.island.center", raw.center);
    const radius = positive(ctx, "terrain.island.radius", raw.radius, 10000);
    const shoreWidth = positive(ctx, "terrain.island.shoreWidth", raw.shoreWidth, 1000);
    const landHeight = positive(ctx, "terrain.island.landHeight", raw.landHeight, 1000);
    if (!center || radius === null || shoreWidth === null || landHeight === null) return null;
    if (shoreWidth >= radius) issue(ctx, "terrain.island.shoreWidth", "must be smaller than radius");
    let radii: number[] | undefined;
    if (raw.radii !== undefined) {
      if (!Array.isArray(raw.radii) || raw.radii.length !== ISLAND_RADIAL_SAMPLES) issue(ctx, "terrain.island.radii", `must contain ${ISLAND_RADIAL_SAMPLES} radial samples`);
      else {
        const values = raw.radii.map((r, i) => requireNumber(ctx, `terrain.island.radii[${i}]`, r, shoreWidth + spacing! * 4, 10000));
        if (values.every(r => r !== null)) radii = values as number[];
      }
    }
    island = { center, radius, shoreWidth, landHeight, ...(radii ? { radii } : {}) };
  }
  let coast: BriefTerrain["coast"];
  if (value.coast !== undefined) {
    if (!isRecord(value.coast)) return reject(ctx, "terrain.coast", "must be an object");
    const raw = value.coast;
    for (const key of Object.keys(raw)) if (!["center", "seaSide", "shoreWidth", "landHeight", "beachWidth"].includes(key)) issue(ctx, `terrain.coast.${key}`, "is not a coast field");
    const center = requirePoint(ctx, "terrain.coast.center", raw.center);
    const seaSide = isOneOf(["west", "east", "north", "south"] as const, raw.seaSide) ? raw.seaSide : reject(ctx, "terrain.coast.seaSide", "must be west, east, north or south");
    const shoreWidth = positive(ctx, "terrain.coast.shoreWidth", raw.shoreWidth, 1000);
    const landHeight = positive(ctx, "terrain.coast.landHeight", raw.landHeight, 1000);
    if (!center || !seaSide || shoreWidth === null || landHeight === null) return null;
    const beachWidth = raw.beachWidth === undefined ? undefined : positive(ctx, "terrain.coast.beachWidth", raw.beachWidth, 1000);
    if (beachWidth === null) return null;
    coast = { center, seaSide, shoreWidth, landHeight, ...(beachWidth !== undefined ? { beachWidth } : {}) };
  }
  if (island && coast) issue(ctx, "terrain", "choose island or coast, not both");
  if (id === null || name === null || tileQuads === null || spacing === null || heightRange === null || relief === null) return null;
  return { id, name, tileQuads, spacing, heightRange, ...(relief ? { relief } : {}), ...(island ? { island } : {}), ...(coast ? { coast } : {}) };
}

function normalizeRelief(ctx: Ctx, value: unknown): BriefRelief | null {
  const path = "terrain.relief";
  if (!isRecord(value)) return reject(ctx, path, "must be an object");
  const known = (entry: Record<string, unknown>, at: string, keys: readonly string[]): void => {
    for (const key of Object.keys(entry)) if (!keys.includes(key)) issue(ctx, `${at}.${key}`, "is not a relief field");
  };
  known(value, path, ["hills", "mountains", "clear"]);
  let failed = false;
  const number = (at: string, raw: unknown, min: number, max: number): number => {
    const result = requireNumber(ctx, at, raw, min, max);
    if (result === null) failed = true;
    return result ?? 0;
  };
  const relief: BriefRelief = { clear: structuredClone(DEFAULT_RELIEF_CLEAR) as BriefRelief["clear"] };
  if (value.hills !== undefined) {
    if (!isRecord(value.hills)) return reject(ctx, `${path}.hills`, "must be an object");
    known(value.hills, `${path}.hills`, ["height", "wavelength"]);
    relief.hills = { height: number(`${path}.hills.height`, value.hills.height, 0, 1000), wavelength: number(`${path}.hills.wavelength`, value.hills.wavelength, 20, 20000) };
  }
  if (value.mountains !== undefined) {
    const raw = value.mountains;
    if (!isRecord(raw)) return reject(ctx, `${path}.mountains`, "must be an object");
    known(raw, `${path}.mountains`, ["height", "lift", "wavelength", "spurStretch", "directionDeg"]);
    relief.mountains = {
      height: number(`${path}.mountains.height`, raw.height, 0, 5000),
      lift: raw.lift === undefined ? 0 : number(`${path}.mountains.lift`, raw.lift, 0, 2000),
      wavelength: number(`${path}.mountains.wavelength`, raw.wavelength, 20, 20000),
      spurStretch: raw.spurStretch === undefined ? 1 : number(`${path}.mountains.spurStretch`, raw.spurStretch, 0.05, 1),
      directionDeg: raw.directionDeg === undefined ? 0 : number(`${path}.mountains.directionDeg`, raw.directionDeg, -360, 360),
    };
  }
  if (value.clear !== undefined) {
    if (!isRecord(value.clear)) return reject(ctx, `${path}.clear`, "must be an object");
    known(value.clear, `${path}.clear`, Object.keys(DEFAULT_RELIEF_CLEAR));
    for (const kind of Object.keys(DEFAULT_RELIEF_CLEAR) as Array<keyof BriefRelief["clear"]>) {
      const raw = value.clear[kind];
      if (raw === undefined) continue;
      if (!isRecord(raw)) { issue(ctx, `${path}.clear.${kind}`, "must be an object"); failed = true; continue; }
      known(raw, `${path}.clear.${kind}`, ["inner", "falloff"]);
      relief.clear[kind] = {
        inner: raw.inner === undefined ? DEFAULT_RELIEF_CLEAR[kind].inner : number(`${path}.clear.${kind}.inner`, raw.inner, 0, 5000),
        falloff: raw.falloff === undefined ? DEFAULT_RELIEF_CLEAR[kind].falloff : number(`${path}.clear.${kind}.falloff`, raw.falloff, 1, 10000),
      };
    }
  }
  return failed ? null : relief;
}

function normalizeValley(ctx: Ctx, path: string, entry: Record<string, unknown>): BriefValley | null {
  for (const key of Object.keys(entry)) if (!VALLEY_FIELDS.has(key)) issue(ctx, `${path}.${key}`, "is not a valley field");
  const id = requireId(ctx, path, entry.id);
  const axis = isOneOf(VALLEY_AXES, entry.axis) ? entry.axis : reject(ctx, `${path}.axis`, `must be one of ${VALLEY_AXES.join(", ")}`);
  const sections = arrayOf(ctx, `${path}.sections`, entry.sections, (c, p, raw): BriefValleySection | null => {
    if (!isRecord(raw)) return reject(c, p, "must be an object");
    const north = metres(c, `${p}.north`, raw.north);
    const floor = eastPair(c, `${p}.floor`, raw.floor);
    const rock = eastPair(c, `${p}.rock`, raw.rock);
    if (north === null || !floor || !rock) return null;
    if (floor[0] === floor[1]) return reject(c, `${p}.floor`, "must have some width");
    if (rock[0] >= floor[0] || rock[1] <= floor[1]) return reject(c, `${p}.rock`, "must lie outside the floor on both sides");
    return { north, floor, rock };
  }).sort((a, b) => b.north - a.north);
  if (sections.length < 2) issue(ctx, `${path}.sections`, "must list at least 2 sections");
  sections.forEach((section, index) => {
    if (index > 0 && section.north === sections[index - 1]!.north) issue(ctx, `${path}.sections`, `repeats north ${section.north}`);
  });
  const floorProfile = arrayOf(ctx, `${path}.floorProfile`, entry.floorProfile, (c, p, raw) => {
    if (!isRecord(raw)) return reject(c, p, "must be an object");
    const north = metres(c, `${p}.north`, raw.north);
    const elevation = metres(c, `${p}.elevation`, raw.elevation);
    return north === null || elevation === null ? null : { north, elevation };
  }).sort((a, b) => b.north - a.north);
  if (floorProfile.length < 1) issue(ctx, `${path}.floorProfile`, "must list at least 1 point");
  floorProfile.forEach((at, index) => {
    if (index > 0 && at.north === floorProfile[index - 1]!.north) issue(ctx, `${path}.floorProfile`, `repeats north ${at.north}`);
  });
  const sideSlopeDeg = requireNumber(ctx, `${path}.sideSlopeDeg`, entry.sideSlopeDeg, 0, 80);
  const relief = optional(entry.relief, (): Partial<BriefValleyRelief> | null => {
    const raw = entry.relief;
    if (!isRecord(raw)) return reject(ctx, `${path}.relief`, "must be an object");
    const result: Partial<BriefValleyRelief> = {};
    for (const key of Object.keys(raw)) {
      if (!(VALLEY_RELIEF_KEYS as readonly string[]).includes(key)) issue(ctx, `${path}.relief.${key}`, "is not a relief field");
    }
    for (const key of VALLEY_RELIEF_KEYS) {
      if (raw[key] === undefined) continue;
      const value = requireNumber(ctx, `${path}.relief.${key}`, raw[key], 0, 1_000);
      if (value !== null) result[key] = value;
    }
    return result;
  });
  const ridgeElevation = optional(entry.ridgeElevation, () => eastPair(ctx, `${path}.ridgeElevation`, entry.ridgeElevation));
  const slopeCover = optional(entry.slopeCover, () => requireToken(ctx, `${path}.slopeCover`, entry.slopeCover));
  if (id === null || axis === null || sideSlopeDeg === null) return null;
  return {
    id, axis, sections, floorProfile, sideSlopeDeg,
    ...(relief && Object.keys(relief).length ? { relief } : {}),
    ...(ridgeElevation ? { ridgeElevation } : {}),
    ...(slopeCover ? { slopeCover } : {}),
    ...provenance(ctx, path, entry),
  };
}

function normalizeEnvironment(ctx: Ctx, value: unknown): BriefEnvironment | null {
  if (!isRecord(value)) return reject(ctx, "environment", "must be an object");
  const season = isOneOf(SEASONS, value.season) ? value.season : reject(ctx, "environment.season", `must be one of ${SEASONS.join(", ")}`);
  const weatherInput = value.weather === undefined ? {} : value.weather;
  if (!isRecord(weatherInput)) return reject(ctx, "environment.weather", "must be an object");
  const preset = weatherInput.preset === undefined ? "clear" : weatherInput.preset;
  const weatherPreset = isOneOf(WEATHER_PRESETS, preset) ? preset : reject(ctx, "environment.weather.preset", `must be one of ${WEATHER_PRESETS.join(", ")}`);
  const intensity = requireNumber(ctx, "environment.weather.intensity", weatherInput.intensity ?? 1, 0, 1);
  const hour = optional(value.hour, () => requireNumber(ctx, "environment.hour", value.hour, 0, 24));
  if (season === null || weatherPreset === null || intensity === null) return null;
  return { season, weather: { preset: weatherPreset, intensity }, ...(hour === undefined ? {} : { hour }) };
}

export function normalizeWorldBrief(value: unknown): WorldBriefNormalization {
  if (!isRecord(value)) return { brief: null, issues: ["brief must be an object"] };
  if (value.schema !== WORLD_BRIEF_SCHEMA_VERSION) return { brief: null, issues: [`schema must be ${WORLD_BRIEF_SCHEMA_VERSION}`] };
  if (value.type !== "worldBrief") return { brief: null, issues: ['type must be "worldBrief"'] };
  const ctx: Ctx = { issues: [] };
  for (const key of Object.keys(value)) if (!TOP_LEVEL_FIELDS.has(key)) issue(ctx, key, "is not a world brief field");

  const id = requireId(ctx, "brief", value.id);
  const name = optional(value.name, () => typeof value.name === "string" && value.name.trim() ? value.name.trim() : reject(ctx, "name", "must be a non-empty string"));
  const seed = normalizeSeed(value.seed ?? 0) ?? reject(ctx, "seed", "must be an integer 0..4294967295");
  const frame = normalizeFrame(ctx, value.frame);
  const area = normalizeArea(ctx, value.area);
  const terrain = normalizeTerrain(ctx, value.terrain);
  let ocean: BriefOcean | undefined;
  if (value.ocean !== undefined) {
    if (!isRecord(value.ocean)) issue(ctx, "ocean", "must be an object");
    else {
      for (const key of Object.keys(value.ocean)) if (!["id", "surfaceElevation", "offshoreDepth", "shoreProfile"].includes(key)) issue(ctx, `ocean.${key}`, "is not an ocean field");
      const oceanId = requireId(ctx, "ocean", value.ocean.id);
      const surfaceElevation = requireNumber(ctx, "ocean.surfaceElevation", value.ocean.surfaceElevation, -100000, 100000);
      const offshoreDepth = requireNumber(ctx, "ocean.offshoreDepth", value.ocean.offshoreDepth, 1, 10000);
      let shoreProfile: BriefOcean["shoreProfile"];
      if (value.ocean.shoreProfile !== undefined) {
        const raw = value.ocean.shoreProfile;
        if (!isRecord(raw)) issue(ctx, "ocean.shoreProfile", "must be an object");
        else {
          for (const key of Object.keys(raw)) if (!["shallowDistance", "shallowDepth", "deepDistance"].includes(key)) issue(ctx, `ocean.shoreProfile.${key}`, "is not a shore profile field");
          const shallowDistance = requireNumber(ctx, "ocean.shoreProfile.shallowDistance", raw.shallowDistance, .01, 10000);
          const shallowDepth = requireNumber(ctx, "ocean.shoreProfile.shallowDepth", raw.shallowDepth, .01, 10000);
          const deepDistance = requireNumber(ctx, "ocean.shoreProfile.deepDistance", raw.deepDistance, .01, 10000);
          if (shallowDistance !== null && shallowDepth !== null && deepDistance !== null) {
            if (deepDistance <= shallowDistance) issue(ctx, "ocean.shoreProfile.deepDistance", "must exceed shallowDistance");
            if (offshoreDepth !== null && shallowDepth >= offshoreDepth) issue(ctx, "ocean.shoreProfile.shallowDepth", "must be below offshoreDepth");
            shoreProfile = { shallowDistance, shallowDepth, deepDistance };
          }
        }
      }
      if (oceanId !== null && surfaceElevation !== null && offshoreDepth !== null) ocean = { id: oceanId, surfaceElevation, offshoreDepth, ...(shoreProfile ? { shoreProfile } : {}) };
    }
  }
  if (Boolean(terrain?.island || terrain?.coast) !== Boolean(ocean)) issue(ctx, "ocean", "requires ocean together with terrain.island or terrain.coast");
  if (terrain?.island && area) {
    const { center, radius, radii } = terrain.island;
    const margin = terrain.spacing * 2;
    const outside = radii ? radii.some((r, i) => {
      const a = i * 2 * Math.PI / radii.length, x = center[0] + r * Math.cos(a), north = center[1] + r * Math.sin(a);
      return x - margin <= area.west || x + margin >= area.east || north - margin <= area.south || north + margin >= area.north;
    }) : center[0] - radius * 1.11 - margin <= area.west || center[0] + radius * 1.11 + margin >= area.east
      || center[1] - radius * 1.11 - margin <= area.south || center[1] + radius * 1.11 + margin >= area.north;
    if (outside)
      issue(ctx, "terrain.island", "must leave an offshore band on every terrain edge");
  }
  const regionProfile = optional(value.regionProfile, () =>
    normalizeAssetPath(value.regionProfile, ".regionprofile.json") ?? reject(ctx, "regionProfile", "must be a public-root-relative *.regionprofile.json"));
  const cover = optional(value.cover, (): BriefCover | null => {
    if (!isRecord(value.cover)) return reject(ctx, "cover", "must be an object");
    for (const key of Object.keys(value.cover)) if (!["file", "forest", "rocks", "fields"].includes(key)) issue(ctx, `cover.${key}`, "is not a cover field");
    const file = normalizeAssetPath(value.cover.file, ".cover.json") ?? reject(ctx, "cover.file", "must be a public-root-relative *.cover.json");
    const levels: Partial<Record<"forest" | "rocks" | "fields", CoverDensityLevel>> = {};
    for (const key of ["forest", "rocks", "fields"] as const) {
      const level = value.cover[key];
      if (level === undefined) continue;
      if (isOneOf(COVER_DENSITY_LEVELS, level)) levels[key] = level;
      else issue(ctx, `cover.${key}`, `must be one of ${COVER_DENSITY_LEVELS.join(", ")}`);
    }
    return file === null ? null : { file, ...levels };
  });
  const reference = optional(value.reference, () => {
    if (!isRecord(value.reference)) return reject(ctx, "reference", "must be an object");
    const image = normalizeAssetPath(value.reference.image, null) ?? reject(ctx, "reference.image", "must be a public-root-relative path");
    const view = value.reference.view === undefined ? "topDown" : value.reference.view;
    if (!isOneOf(REFERENCE_VIEWS, view)) return reject(ctx, "reference.view", `must be one of ${REFERENCE_VIEWS.join(", ")}`);
    return image === null ? null : { image, view };
  });
  const playerStart = optional(value.playerStart, () => point(ctx, "playerStart", value.playerStart, area));

  const valleys = uniqueEntries(ctx, "valleys", value.valleys, normalizeValley);
  const regions = uniqueEntries(ctx, "regions", value.regions, (c, p, entry): BriefRegion | null => {
    const regionId = requireId(c, p, entry.id);
    const kind = requireToken(c, `${p}.kind`, entry.kind);
    const polygon = points(c, `${p}.polygon`, entry.polygon, 3, area);
    return regionId === null || kind === null || !polygon ? null : { id: regionId, kind, polygon, ...provenance(c, p, entry) };
  });
  const water = uniqueEntries(ctx, "water", value.water, (c, p, entry): BriefWater | null => {
    const waterId = requireId(c, p, entry.id);
    const kind = requireToken(c, `${p}.kind`, entry.kind);
    if ((entry.line === undefined) === (entry.polygon === undefined)) return reject(c, p, "needs exactly one of line / polygon");
    const line = optional(entry.line, () => points(c, `${p}.line`, entry.line, 2, area));
    const polygon = optional(entry.polygon, () => points(c, `${p}.polygon`, entry.polygon, 3, area));
    const width = optional(entry.width, () => positive(c, `${p}.width`, entry.width, 10_000));
    const bedDepth = optional(entry.bedDepth, () => positive(c, `${p}.bedDepth`, entry.bedDepth, 1_000));
    const surfaceDepth = optional(entry.surfaceDepth, () => requireNumber(c, `${p}.surfaceDepth`, entry.surfaceDepth, 0, 1_000));
    const outlet = entry.outlet === undefined ? undefined : entry.outlet === "ocean" ? "ocean" as const : reject(c, `${p}.outlet`, "must be ocean");
    if (bedDepth !== undefined && surfaceDepth !== undefined && surfaceDepth >= bedDepth) {
      issue(c, `${p}.surfaceDepth`, "must be less than bedDepth");
    }
    if (waterId === null || kind === null || (!line && !polygon)) return null;
    return {
      id: waterId, kind, ...(line ? { line } : {}), ...(polygon ? { polygon } : {}),
      ...(width === undefined ? {} : { width }), ...(bedDepth === undefined ? {} : { bedDepth }),
      ...(surfaceDepth === undefined ? {} : { surfaceDepth }), ...provenance(c, p, entry),
      ...(outlet ? { outlet } : {}),
    };
  });
  if (terrain?.island && water.some(entry => entry.line)) issue(ctx, "water", "island rivers require the river-mouth integration; only inland lakes are supported");
  if (water.some(entry => entry.outlet && (!entry.line || !terrain?.coast || !ocean))) issue(ctx, "water.outlet", "Ocean outlets require a river line in a Coast world");
  if (ocean && valleys.length) issue(ctx, "valleys", "island terrain cannot also define valleys");

  const roadsInput = value.roads === undefined ? {} : value.roads;
  if (!isRecord(roadsInput)) issue(ctx, "roads", "must be an object");
  const roadsRecord = isRecord(roadsInput) ? roadsInput : {};
  const nodes = uniqueEntries(ctx, "roads.nodes", roadsRecord.nodes, (c, p, entry): BriefRoadNode | null => {
    const nodeId = requireId(c, p, entry.id);
    const at = point(c, `${p}.at`, entry.at, area);
    const kind = entry.kind === undefined ? "end" : entry.kind;
    if (!isOneOf(ROAD_NODE_KINDS, kind)) return reject(c, `${p}.kind`, `must be one of ${ROAD_NODE_KINDS.join(", ")}`);
    return nodeId === null || !at ? null : { id: nodeId, at, kind, ...provenance(c, p, entry) };
  });
  const nodeIds = idSet(nodes);
  const edges = uniqueEntries(ctx, "roads.edges", roadsRecord.edges, (c, p, entry): BriefRoadEdge | null => {
    const edgeId = requireId(c, p, entry.id);
    const from = typeof entry.from === "string" && nodeIds.has(entry.from) ? entry.from : reject(c, `${p}.from`, "must name a road node");
    const to = typeof entry.to === "string" && nodeIds.has(entry.to) ? entry.to : reject(c, `${p}.to`, "must name a road node");
    if (from !== null && from === to) return reject(c, p, "must join two different nodes");
    const roadClass = isOneOf(ROAD_CLASSES, entry.roadClass) ? entry.roadClass : reject(c, `${p}.roadClass`, `must be one of ${ROAD_CLASSES.join(", ")}`);
    const corridor = optional(entry.corridor, () => points(c, `${p}.corridor`, entry.corridor, 1, area));
    if (edgeId === null || from === null || to === null || roadClass === null) return null;
    return { id: edgeId, from, to, roadClass, ...(corridor ? { corridor } : {}), ...provenance(c, p, entry) };
  });

  const landmarks = uniqueEntries(ctx, "landmarks", value.landmarks, (c, p, entry): BriefLandmark | null => {
    const landmarkId = requireId(c, p, entry.id);
    const role = requireToken(c, `${p}.role`, entry.role);
    const at = point(c, `${p}.at`, entry.at, area);
    const pad = optional(entry.pad, () => {
      if (!isRecord(entry.pad)) return reject(c, `${p}.pad`, "must be an object");
      const size = entry.pad.size;
      const pair = Array.isArray(size) && size.length === 2
        ? [positive(c, `${p}.pad.size[0]`, size[0], 10_000), positive(c, `${p}.pad.size[1]`, size[1], 10_000)]
        : [reject(c, `${p}.pad.size`, "must be [eastWest, northSouth] metres"), null];
      const falloff = requireNumber(c, `${p}.pad.falloff`, entry.pad.falloff ?? 0, 0, 10_000);
      return pair[0] === null || pair[1] === null || falloff === null ? null : { size: [pair[0], pair[1]] as [number, number], falloff };
    });
    return landmarkId === null || role === null || !at ? null : { id: landmarkId, role, at, ...(pad ? { pad } : {}), ...provenance(c, p, entry) };
  });
  const settlements = uniqueEntries(ctx, "settlements", value.settlements, (c, p, entry): BriefSettlement | null => {
    const settlementId = requireId(c, p, entry.id);
    const type = requireToken(c, `${p}.type`, entry.type);
    const center = point(c, `${p}.center`, entry.center, area);
    const radius = optional(entry.radius, () => positive(c, `${p}.radius`, entry.radius, 100_000));
    const population = optional(entry.population, () =>
      Number.isInteger(entry.population) && (entry.population as number) >= 0 ? entry.population as number : reject(c, `${p}.population`, "must be a whole number"));
    const protectedFlag = optional(entry.protected, () => typeof entry.protected === "boolean" ? entry.protected : reject(c, `${p}.protected`, "must be a boolean"));
    if (settlementId === null || type === null || !center) return null;
    return {
      id: settlementId, type, center,
      ...(radius === undefined ? {} : { radius }), ...(population === undefined ? {} : { population }),
      ...(protectedFlag === undefined ? {} : { protected: protectedFlag }), ...provenance(c, p, entry),
    };
  });
  const props = uniqueEntries(ctx, "props", value.props, (c, p, entry): BriefProp | null => {
    const propId = requireId(c, p, entry.id);
    const role = requireToken(c, `${p}.role`, entry.role);
    const at = point(c, `${p}.at`, entry.at, area);
    const rotationDeg = requireNumber(c, `${p}.rotationDeg`, entry.rotationDeg ?? 0, -360, 360);
    const scale = positive(c, `${p}.scale`, entry.scale ?? 1, 1_000);
    const collision = entry.collision === undefined ? true : typeof entry.collision === "boolean" ? entry.collision : reject(c, `${p}.collision`, "must be a boolean");
    if (propId === null || role === null || !at || rotationDeg === null || scale === null || collision === null) return null;
    return { id: propId, role, at, rotationDeg, scale, collision };
  });
  const environment = optional(value.environment, () => normalizeEnvironment(ctx, value.environment));
  const models = arrayOf(ctx, "models", value.models, (c, p, entry): BriefModel | null => {
    if (!isRecord(entry)) return reject(c, p, "must be an object");
    const role = requireToken(c, `${p}.role`, entry.role);
    const source = isOneOf(MODEL_SOURCES, entry.source) ? entry.source : reject(c, `${p}.source`, `must be one of ${MODEL_SOURCES.join(", ")}`);
    const file = normalizeAssetPath(entry.file, null) ?? reject(c, `${p}.file`, "must be a public-root-relative path");
    const variant = optional(entry.variant, () => requireToken(c, `${p}.variant`, entry.variant));
    if (role === null || source === null || file === null) return null;
    return { role, source, file, ...(variant ? { variant } : {}) };
  });
  const modelKeys = new Set<string>();
  models.forEach((model, index) => {
    const key = `${model.role}|${model.variant ?? ""}|${model.file}`;
    if (modelKeys.has(key)) issue(ctx, `models[${index}]`, "repeats a role, variant and file");
    modelKeys.add(key);
  });

  if (ctx.issues.length > 0 || id === null || seed === null || !frame || !area || !terrain) {
    return { brief: null, issues: ctx.issues.length > 0 ? ctx.issues : ["brief is incomplete"] };
  }
  return {
    brief: {
      schema: WORLD_BRIEF_SCHEMA_VERSION, type: "worldBrief", id, ...(name ? { name } : {}), seed, frame, area, terrain,
      ...(regionProfile ? { regionProfile } : {}), ...(cover ? { cover } : {}), ...(reference ? { reference } : {}), ...(playerStart ? { playerStart } : {}),
      valleys, regions, water, ...(ocean ? { ocean } : {}), roads: { nodes, edges }, landmarks, settlements, props,
      ...(environment ? { environment } : {}), models,
    },
    issues: [],
  };
}

/** A brief point in Forge world `[x, z]`. */
export function briefToWorld(brief: Pick<WorldBrief, "frame">, at: readonly [number, number]): WorldPoint {
  return metricToWorld(at, brief.frame);
}

export function briefElevationToWorld(brief: Pick<WorldBrief, "frame">, elevation: number): number {
  return metricElevationToWorld(elevation, brief.frame);
}

/** The area as a world XZ box. */
export function briefWorldBounds(brief: Pick<WorldBrief, "frame" | "area">): { min: WorldPoint; max: WorldPoint } {
  const [x0, z0] = briefToWorld(brief, [brief.area.west, brief.area.north]);
  const [x1, z1] = briefToWorld(brief, [brief.area.east, brief.area.south]);
  return { min: [x0, z0], max: [x1, z1] };
}

function planProvenance(entry: BriefProvenance): PlanProvenance {
  return entry.source === "reference"
    ? { source: "reference", observed: true, ...(entry.confidence === undefined ? {} : { confidence: entry.confidence }) }
    : { source: entry.source };
}

/** A valley's floor and its two slope bands as world polygons, north to south then back. */
export function briefValleyRegions(brief: Pick<WorldBrief, "frame">, valley: BriefValley): {
  floor: WorldPoint[];
  west: WorldPoint[];
  east: WorldPoint[];
} {
  const band = (west: (section: BriefValleySection) => number, east: (section: BriefValleySection) => number): WorldPoint[] => [
    ...valley.sections.map((section) => briefToWorld(brief, [west(section), section.north])),
    ...[...valley.sections].reverse().map((section) => briefToWorld(brief, [east(section), section.north])),
  ];
  return {
    floor: band((section) => section.floor[0], (section) => section.floor[1]),
    west: band((section) => section.rock[0], (section) => section.floor[0]),
    east: band((section) => section.floor[1], (section) => section.rock[1]),
  };
}

/** The recipe plan a brief describes; stages turn it into geometry. */
export function worldBriefRecipe(brief: WorldBrief): WorldRecipe {
  const recipe = createWorldRecipe(brief.id, brief.seed);
  if (brief.regionProfile) recipe.regionProfile = brief.regionProfile;
  if (brief.reference) {
    const { min, max } = briefWorldBounds(brief);
    recipe.reference = { image: brief.reference.image, origin: min, size: [round(max[0] - min[0]), round(max[1] - min[1])], view: brief.reference.view };
  }
  const world = (at: BriefPoint): WorldPoint => briefToWorld(brief, at);
  for (const water of brief.water) {
    recipe.plan.water.push({
      id: water.id, kind: water.kind,
      ...(water.line ? { path: water.line.map(world) } : {}),
      ...(water.polygon ? { polygon: water.polygon.map(world) } : {}),
      ...(water.line && water.width !== undefined ? { width: water.width } : {}),
      ...planProvenance(water),
    });
  }
  for (const valley of brief.valleys) {
    const bands = briefValleyRegions(brief, valley);
    const seen = planProvenance(valley);
    recipe.plan.regions.push({ id: `${valley.id}-floor`, kind: "valley", polygon: bands.floor, ...seen });
    if (valley.slopeCover) {
      recipe.plan.regions.push(
        { id: `${valley.id}-west`, kind: valley.slopeCover, polygon: bands.west, ...seen },
        { id: `${valley.id}-east`, kind: valley.slopeCover, polygon: bands.east, ...seen },
      );
    }
  }
  for (const region of brief.regions) {
    recipe.plan.regions.push({ id: region.id, kind: region.kind, polygon: region.polygon.map(world), ...planProvenance(region) });
  }
  for (const landmark of brief.landmarks) {
    recipe.plan.landmarks.push({ id: landmark.id, kind: landmark.role, position: world(landmark.at), ...planProvenance(landmark) });
  }
  for (const settlement of brief.settlements) {
    recipe.plan.settlements.push({
      id: settlement.id, type: settlement.type, center: world(settlement.center),
      ...(settlement.radius === undefined ? {} : { radius: settlement.radius }),
      ...(settlement.population === undefined ? {} : { population: settlement.population }),
      ...(settlement.protected === undefined ? {} : { protected: settlement.protected }),
      ...planProvenance(settlement),
    });
  }
  for (const node of brief.roads.nodes) {
    recipe.plan.roadGraph.nodes.push({ id: node.id, position: world(node.at), kind: node.kind, ...planProvenance(node) });
  }
  for (const edge of brief.roads.edges) {
    recipe.plan.roadGraph.edges.push({
      id: edge.id, from: edge.from, to: edge.to, roadClass: edge.roadClass,
      ...(edge.corridor ? { guide: edge.corridor.map(world) } : {}),
      ...planProvenance(edge),
    });
  }
  return recipe;
}
