/**
 * Region profile: a region's settlement culture as data (World Builder plan
 * v0.4 §13.3 L0, §13.4). Road sizes, traffic side, street pattern mix, parcel
 * sizes, zoning style, the facility program derived from population, the
 * building roles with their footprints, and street furniture. The generators
 * read only this; nothing cultural lives in the engine, so the same algorithm
 * builds a Japanese or an American village from a different profile.
 *
 * Profiles are fork data (`public/…/<id>.regionprofile.json`). Forge itself
 * ships only a neutral test profile. `normalizeRegionProfile` is the single
 * source of field shape; it is tolerant (bad entries are dropped with a path in
 * `issues`) because there is no editor save surface yet: profiles are written
 * outside the editor and only read. Dependency-free; no three.js.
 */
import { isPlacementId, isSemanticRole } from "../scene/placementIdentity";
import {
  arrayOf,
  type Ctx,
  isOneOf,
  isRecord,
  issue,
  keyedEntries,
  reject,
  requireNumber,
  requireRange,
} from "./normalize";
import {
  LAND_USES,
  type LandUse,
  PROGRAM_SITINGS,
  type ProgramSiting,
  ROAD_CLASSES,
  type RoadClass,
} from "./vocabulary";

export const REGION_PROFILE_SCHEMA_VERSION = 1;
export const REGION_PROFILE_SUFFIX = ".regionprofile.json";

export const TRAFFIC_SIDES = ["left", "right"] as const;
export type TrafficSide = (typeof TRAFFIC_SIDES)[number];

export const STREET_PATTERNS = ["linear", "grid", "organic", "radial", "contourFollow"] as const;
export type StreetPattern = (typeof STREET_PATTERNS)[number];

export const ZONING_MODES = ["separated", "mixed"] as const;
export type ZoningMode = (typeof ZONING_MODES)[number];

export const ENTRANCE_RULES = ["street", "any"] as const;
export type EntranceRule = (typeof ENTRANCE_RULES)[number];

export const FURNITURE_PLACEMENTS = ["gate", "junction", "interval"] as const;
export type FurniturePlacement = (typeof FURNITURE_PLACEMENTS)[number];

/** Cross-section and drivability limits of one road class, metres/degrees. */
export interface RoadSpec {
  width: number;
  shoulder: number;
  sidewalk?: number;
  maxSlopeDeg: number;
  minTurnRadius: number;
  /** Terrain paint layer name hint; its physical material drives wheels (T27). */
  surfaceLayer?: string;
  /** Asset id of the road surface mesh a road spline sweeps (with collision). */
  meshAsset?: string;
}

/** Relative weights of the street patterns a generator mixes, plus block size. */
export type StreetPatternSpec = Record<StreetPattern, number> & {
  /** Block edge length range, metres. */
  blockSize: [number, number];
};

export interface ParcelSpec {
  frontage: [number, number];
  depth: [number, number];
  /** Building setback from the street edge, metres. */
  setback: number;
  /** Footprint / parcel area, 0..1. */
  coverage: number;
}

export interface ZoningSpec {
  mode: ZoningMode;
  /** -1 forbidden … 1 preferred neighbours; read through `landUseCompatibility`. */
  compatibility: Partial<Record<LandUse, Partial<Record<LandUse, number>>>>;
}

/** One facility the program derives from population: `perResidents` or a fixed `count`. */
export interface ProgramRule {
  role: string;
  /** One per this many residents (rounded up). */
  perResidents?: number;
  /** A fixed number regardless of size. */
  count?: number;
  /** Below this population the rule yields nothing. */
  minPopulation?: number;
  siting: ProgramSiting;
}

/** A structure that stands on a parcel. */
export interface BuildingRoleSpec {
  landUse: LandUse;
  footprint: { width: [number, number]; depth: [number, number] };
  /** Integer range; `[0, 0]` is an open space with no structure (square, field). */
  storeys: [number, number];
  storeyHeight: number;
  entrance: EntranceRule;
  /** Manifest asset ids that show this role; none means a placeholder. */
  assetIds?: string[];
  /** `#rrggbb`; absent uses the land-use colour. */
  placeholderColor?: string;
  /** A fence round the role's lot (the `fences` stage). */
  fence?: FenceSpec;
}

/** A placeholder fence along a lot's boundary. */
export interface FenceSpec {
  /** Role of the fence pieces, e.g. `prop.fence.picket`. */
  role: string;
  height: number;
  /** Default `DEFAULT_FENCE_THICKNESS`. */
  thickness?: number;
  /** Fence the street front too, open at the entrance. Default true. */
  front?: boolean;
  /** Opening in the front fence at the entrance, metres. Default `DEFAULT_FENCE_GAP`. */
  gap?: number;
  placeholderColor?: string;
}

export const DEFAULT_FENCE_THICKNESS = 0.1;
export const DEFAULT_FENCE_GAP = 3;

/** A prop placed along roads of the listed classes. */
export interface StreetFurnitureRule {
  role: string;
  roadClasses: RoadClass[];
  placement: FurniturePlacement;
  /** Metres between props; required for `interval`. */
  spacing?: number;
  /** Placeholder box `[width, height, depth]`, metres. */
  size: [number, number, number];
  assetIds?: string[];
  placeholderColor?: string;
}

export interface RegionProfile {
  schemaVersion: typeof REGION_PROFILE_SCHEMA_VERSION;
  id: string;
  label: string;
  traffic: { side: TrafficSide };
  roads: Partial<Record<RoadClass, RoadSpec>>;
  streetPattern: StreetPatternSpec;
  parcels: Partial<Record<LandUse, ParcelSpec>>;
  zoning: ZoningSpec;
  household: { personsPerDwelling: number };
  program: ProgramRule[];
  roles: Record<string, BuildingRoleSpec>;
  streetFurniture: StreetFurnitureRule[];
}

export interface RegionProfileNormalization {
  /** null when the document is not a profile at all (wrong schema, no id/label). */
  profile: RegionProfile | null;
  issues: string[];
}

const LABEL_MAX_LENGTH = 120;
const ASSET_ID_MAX_LENGTH = 256;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeRegionProfile(value: unknown): RegionProfileNormalization {
  if (!isRecord(value)) return { profile: null, issues: ["region profile must be an object"] };
  if (value.schemaVersion !== REGION_PROFILE_SCHEMA_VERSION) {
    return { profile: null, issues: [`schemaVersion must be ${REGION_PROFILE_SCHEMA_VERSION}`] };
  }
  if (!isPlacementId(value.id)) return { profile: null, issues: ["id must be an id"] };
  if (typeof value.label !== "string" || !value.label.trim() || value.label.length > LABEL_MAX_LENGTH) {
    return { profile: null, issues: [`label must be a non-empty string of at most ${LABEL_MAX_LENGTH} characters`] };
  }

  const ctx: Ctx = { issues: [] };
  const roads = normalizeRoads(ctx, value.roads);
  const parcels = keyedEntries(ctx, "parcels", value.parcels, isLandUse, "a land use", normalizeParcel);
  const roles = normalizeRoles(ctx, value.roles, parcels);
  const profile: RegionProfile = {
    schemaVersion: REGION_PROFILE_SCHEMA_VERSION,
    id: value.id,
    label: value.label.trim(),
    traffic: { side: normalizeTraffic(ctx, value.traffic) },
    roads,
    streetPattern: normalizeStreetPattern(ctx, value.streetPattern),
    parcels,
    zoning: normalizeZoning(ctx, value.zoning),
    household: normalizeHousehold(ctx, value.household),
    program: normalizeProgram(ctx, value.program, roles),
    roles,
    streetFurniture: normalizeFurniture(ctx, value.streetFurniture, roads),
  };
  return { profile, issues: ctx.issues };
}

/**
 * How well two land uses sit next to each other, -1..1. Reads `[a][b]`, then
 * `[b][a]`; an unlisted pair of equal uses is 1, of different uses 0.
 */
export function landUseCompatibility(profile: RegionProfile, a: LandUse, b: LandUse): number {
  const table = profile.zoning.compatibility;
  return table[a]?.[b] ?? table[b]?.[a] ?? (a === b ? 1 : 0);
}

// ─── Sections ───────────────────────────────────────────────────────────────

function normalizeTraffic(ctx: Ctx, value: unknown): TrafficSide {
  if (isRecord(value) && isOneOf(TRAFFIC_SIDES, value.side)) return value.side;
  issue(ctx, "traffic.side", `must be one of ${TRAFFIC_SIDES.join(", ")}`);
  return "right";
}

function normalizeRoads(ctx: Ctx, value: unknown): Partial<Record<RoadClass, RoadSpec>> {
  const roads = keyedEntries(ctx, "roads", value, isRoadClass, "a road class", (c, p, spec) => {
    if (!isRecord(spec)) return reject(c, p, "must be an object");
    const width = requireNumber(c, `${p}.width`, spec.width, 0.5, 100);
    const shoulder = requireNumber(c, `${p}.shoulder`, spec.shoulder, 0, 50);
    const maxSlopeDeg = requireNumber(c, `${p}.maxSlopeDeg`, spec.maxSlopeDeg, 1, 60);
    const minTurnRadius = requireNumber(c, `${p}.minTurnRadius`, spec.minTurnRadius, 0.5, 10_000);
    if (width === null || shoulder === null || maxSlopeDeg === null || minTurnRadius === null) return null;
    const road: RoadSpec = { width, shoulder, maxSlopeDeg, minTurnRadius };
    if (spec.sidewalk !== undefined) {
      const sidewalk = requireNumber(c, `${p}.sidewalk`, spec.sidewalk, 0, 20);
      if (sidewalk !== null) road.sidewalk = sidewalk;
    }
    if (spec.surfaceLayer !== undefined) {
      if (typeof spec.surfaceLayer === "string" && spec.surfaceLayer.trim()) road.surfaceLayer = spec.surfaceLayer;
      else issue(c, `${p}.surfaceLayer`, "must be a non-empty layer name");
    }
    if (spec.meshAsset !== undefined) {
      if (typeof spec.meshAsset === "string" && spec.meshAsset.trim()) road.meshAsset = spec.meshAsset;
      else issue(c, `${p}.meshAsset`, "must be a non-empty asset id");
    }
    return road;
  });
  if (Object.keys(roads).length === 0) issue(ctx, "roads", "must define at least one road class");
  return roads;
}

function normalizeStreetPattern(ctx: Ctx, value: unknown): StreetPatternSpec {
  const pattern: StreetPatternSpec = {
    linear: 0, grid: 0, organic: 0, radial: 0, contourFollow: 0, blockSize: [40, 120],
  };
  if (!isRecord(value)) {
    issue(ctx, "streetPattern", "must be an object");
    pattern.linear = 1;
    return pattern;
  }
  for (const name of STREET_PATTERNS) {
    if (value[name] === undefined) continue;
    const weight = requireNumber(ctx, `streetPattern.${name}`, value[name], 0, 1_000);
    if (weight !== null) pattern[name] = weight;
  }
  if (STREET_PATTERNS.every((name) => pattern[name] === 0)) {
    issue(ctx, "streetPattern", "needs at least one positive pattern weight; using linear");
    pattern.linear = 1;
  }
  const blockSize = requireRange(ctx, "streetPattern.blockSize", value.blockSize, 1, 5_000);
  if (blockSize) pattern.blockSize = blockSize;
  return pattern;
}

function normalizeParcel(ctx: Ctx, path: string, value: unknown): ParcelSpec | null {
  if (!isRecord(value)) return reject(ctx, path, "must be an object");
  const frontage = requireRange(ctx, `${path}.frontage`, value.frontage, 1, 1_000);
  const depth = requireRange(ctx, `${path}.depth`, value.depth, 1, 1_000);
  const setback = requireNumber(ctx, `${path}.setback`, value.setback, 0, 100);
  const coverage = requireNumber(ctx, `${path}.coverage`, value.coverage, 0.01, 1);
  if (frontage === null || depth === null || setback === null || coverage === null) return null;
  return { frontage, depth, setback, coverage };
}

function normalizeZoning(ctx: Ctx, value: unknown): ZoningSpec {
  const zoning: ZoningSpec = { mode: "separated", compatibility: {} };
  if (!isRecord(value)) {
    issue(ctx, "zoning", "must be an object");
    return zoning;
  }
  if (isOneOf(ZONING_MODES, value.mode)) zoning.mode = value.mode;
  else issue(ctx, "zoning.mode", `must be one of ${ZONING_MODES.join(", ")}`);
  zoning.compatibility = keyedEntries(ctx, "zoning.compatibility", value.compatibility, isLandUse, "a land use",
    (c, p, row) => {
      const entries = keyedEntries(c, p, row, isLandUse, "a land use", (cc, pp, score) =>
        requireNumber(cc, pp, score, -1, 1));
      return Object.keys(entries).length > 0 ? entries : null;
    });
  for (const a of LAND_USES) {
    for (const b of LAND_USES) {
      const forward = zoning.compatibility[a]?.[b];
      const backward = zoning.compatibility[b]?.[a];
      if (a < b && forward !== undefined && backward !== undefined && forward !== backward) {
        issue(ctx, `zoning.compatibility.${a}.${b}`, `disagrees with ${b}.${a}; ${a}.${b} wins`);
      }
    }
  }
  return zoning;
}

function normalizeHousehold(ctx: Ctx, value: unknown): RegionProfile["household"] {
  const persons = isRecord(value)
    ? requireNumber(ctx, "household.personsPerDwelling", value.personsPerDwelling, 0.1, 100)
    : reject(ctx, "household", "must be an object");
  return { personsPerDwelling: persons ?? 3 };
}

function normalizeRoles(
  ctx: Ctx, value: unknown, parcels: Partial<Record<LandUse, ParcelSpec>>,
): Record<string, BuildingRoleSpec> {
  const roles = keyedEntries(ctx, "roles", value, isRoleKey, "a semantic role", (c, p, spec) => {
    if (!isRecord(spec)) return reject(c, p, "must be an object");
    if (!isOneOf(LAND_USES, spec.landUse)) return reject(c, `${p}.landUse`, `must be one of ${LAND_USES.join(", ")}`);
    if (!parcels[spec.landUse]) return reject(c, `${p}.landUse`, `has no parcels.${spec.landUse} spec`);
    const footprint = isRecord(spec.footprint) ? spec.footprint : {};
    const width = requireRange(c, `${p}.footprint.width`, footprint.width, 0.5, 1_000);
    const depth = requireRange(c, `${p}.footprint.depth`, footprint.depth, 0.5, 1_000);
    const storeys = requireRange(c, `${p}.storeys`, spec.storeys, 0, 200, true);
    const storeyHeight = requireNumber(c, `${p}.storeyHeight`, spec.storeyHeight, 1, 20);
    if (!isOneOf(ENTRANCE_RULES, spec.entrance)) {
      return reject(c, `${p}.entrance`, `must be one of ${ENTRANCE_RULES.join(", ")}`);
    }
    if (width === null || depth === null || storeys === null || storeyHeight === null) return null;
    const role: BuildingRoleSpec = {
      landUse: spec.landUse, footprint: { width, depth }, storeys, storeyHeight, entrance: spec.entrance,
    };
    applyLook(c, p, spec, role);
    if (spec.fence !== undefined) {
      const fence = normalizeFence(c, `${p}.fence`, spec.fence);
      if (fence) role.fence = fence;
    }
    return role;
  });
  return roles as Record<string, BuildingRoleSpec>;
}

/** A bad fence is dropped with an issue; its role stays. */
function normalizeFence(ctx: Ctx, path: string, value: unknown): FenceSpec | null {
  if (!isRecord(value)) return reject(ctx, path, "must be an object");
  if (!isSemanticRole(value.role)) return reject(ctx, `${path}.role`, "must be a semantic role");
  const height = requireNumber(ctx, `${path}.height`, value.height, 0.1, 10);
  if (height === null) return null;
  const fence: FenceSpec = { role: value.role, height };
  if (value.thickness !== undefined) {
    const thickness = requireNumber(ctx, `${path}.thickness`, value.thickness, 0.01, 2);
    if (thickness === null) return null;
    fence.thickness = thickness;
  }
  if (value.front !== undefined) {
    if (typeof value.front !== "boolean") return reject(ctx, `${path}.front`, "must be true or false");
    fence.front = value.front;
  }
  if (value.gap !== undefined) {
    const gap = requireNumber(ctx, `${path}.gap`, value.gap, 0.5, 50);
    if (gap === null) return null;
    fence.gap = gap;
  }
  if (value.placeholderColor !== undefined) {
    if (typeof value.placeholderColor === "string" && HEX_COLOR.test(value.placeholderColor)) {
      fence.placeholderColor = value.placeholderColor.toLowerCase();
    } else {
      return reject(ctx, `${path}.placeholderColor`, "must be #rrggbb");
    }
  }
  return fence;
}

function normalizeProgram(ctx: Ctx, value: unknown, roles: Record<string, BuildingRoleSpec>): ProgramRule[] {
  return arrayOf(ctx, "program", value, (c, p, rule) => {
    if (!isRecord(rule)) return reject(c, p, "must be an object");
    if (typeof rule.role !== "string" || !roles[rule.role]) return reject(c, `${p}.role`, "must name a profile role");
    if ((rule.perResidents === undefined) === (rule.count === undefined)) {
      return reject(c, p, "needs exactly one of perResidents or count");
    }
    const result: ProgramRule = { role: rule.role, siting: "any" };
    if (rule.perResidents !== undefined) {
      if (!Number.isInteger(rule.perResidents) || (rule.perResidents as number) < 1 || (rule.perResidents as number) > 1_000_000) {
        return reject(c, `${p}.perResidents`, "must be an integer 1..1000000");
      }
      result.perResidents = rule.perResidents as number;
    } else {
      if (!Number.isInteger(rule.count) || (rule.count as number) < 1 || (rule.count as number) > 1_000) {
        return reject(c, `${p}.count`, "must be an integer 1..1000");
      }
      result.count = rule.count as number;
    }
    if (rule.minPopulation !== undefined) {
      if (Number.isInteger(rule.minPopulation) && (rule.minPopulation as number) >= 0) {
        result.minPopulation = rule.minPopulation as number;
      } else {
        issue(c, `${p}.minPopulation`, "must be a non-negative integer");
      }
    }
    if (rule.siting !== undefined) {
      if (isOneOf(PROGRAM_SITINGS, rule.siting)) result.siting = rule.siting;
      else issue(c, `${p}.siting`, `must be one of ${PROGRAM_SITINGS.join(", ")}`);
    }
    return result;
  });
}

function normalizeFurniture(
  ctx: Ctx, value: unknown, roads: Partial<Record<RoadClass, RoadSpec>>,
): StreetFurnitureRule[] {
  return arrayOf(ctx, "streetFurniture", value, (c, p, rule) => {
    if (!isRecord(rule)) return reject(c, p, "must be an object");
    if (!isSemanticRole(rule.role)) return reject(c, `${p}.role`, "must be a semantic role");
    if (!isOneOf(FURNITURE_PLACEMENTS, rule.placement)) {
      return reject(c, `${p}.placement`, `must be one of ${FURNITURE_PLACEMENTS.join(", ")}`);
    }
    const roadClasses = arrayOf(c, `${p}.roadClasses`, rule.roadClasses, (cc, pp, roadClass) => {
      if (!isOneOf(ROAD_CLASSES, roadClass)) return reject(cc, pp, `must be one of ${ROAD_CLASSES.join(", ")}`);
      if (!roads[roadClass]) return reject(cc, pp, `has no roads.${roadClass} spec`);
      return roadClass;
    });
    if (roadClasses.length === 0) return reject(c, `${p}.roadClasses`, "must list at least one defined road class");
    const size = Array.isArray(rule.size) && rule.size.length === 3
      ? rule.size.map((axis, index) => requireNumber(c, `${p}.size[${index}]`, axis, 0.01, 100))
      : [reject(c, `${p}.size`, "must be [width, height, depth]")];
    if (size.some((axis) => axis === null)) return null;
    const result: StreetFurnitureRule = {
      role: rule.role, roadClasses: [...new Set(roadClasses)], placement: rule.placement,
      size: size as [number, number, number],
    };
    if (rule.placement === "interval" || rule.spacing !== undefined) {
      const spacing = requireNumber(c, `${p}.spacing`, rule.spacing, 1, 10_000);
      if (spacing === null) return null;
      result.spacing = spacing;
    }
    applyLook(c, p, rule, result);
    return result;
  });
}

/** `assetIds` and `placeholderColor`, shared by building roles and furniture. */
function applyLook(
  ctx: Ctx,
  path: string,
  spec: Record<string, unknown>,
  target: { assetIds?: string[]; placeholderColor?: string },
): void {
  if (spec.assetIds !== undefined) {
    const ids = arrayOf(ctx, `${path}.assetIds`, spec.assetIds, (c, p, id) =>
      typeof id === "string" && id.length > 0 && id.length <= ASSET_ID_MAX_LENGTH
        ? id
        : reject(c, p, "must be a non-empty asset id"));
    if (ids.length > 0) target.assetIds = [...new Set(ids)];
  }
  if (spec.placeholderColor !== undefined) {
    if (typeof spec.placeholderColor === "string" && HEX_COLOR.test(spec.placeholderColor)) {
      target.placeholderColor = spec.placeholderColor.toLowerCase();
    } else {
      issue(ctx, `${path}.placeholderColor`, "must be #rrggbb");
    }
  }
}

function isLandUse(key: string): key is LandUse {
  return isOneOf(LAND_USES, key);
}

function isRoadClass(key: string): key is RoadClass {
  return isOneOf(ROAD_CLASSES, key);
}

function isRoleKey(key: string): key is string {
  return isSemanticRole(key);
}
