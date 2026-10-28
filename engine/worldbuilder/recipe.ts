/**
 * World Recipe: the one data file World Builder owns (plan v0.4 §1.2, §6.3,
 * §13.4), stored beside its level as `<Level>.worldrecipe.json`.
 *
 * - `plan` is the semantic intent: regions, water, landmarks, settlements and
 *   the road graph. AI (from a reference image), an OSM import or the user
 *   write it; every element records where it came from (`source`, `observed`,
 *   `confidence`) so a re-analysis never overwrites a manual edit.
 * - `generated` is stage output that must persist to be regenerated locally
 *   (settlement sites with their programs, parcels). Geometry itself stays in
 *   the standard level formats.
 * - `ownership` maps level objects (placement ids, spline ids, foliage rules)
 *   to the stage that produced them. Anything not listed is manual and is never
 *   moved or deleted by a stage.
 *
 * Coordinates are world metres on the XZ plane, rounded like layout positions.
 * `normalizeWorldRecipe` is the single source of field shape: the editor reads
 * through it and `/__save-worldrecipe` validates through it (stricter: any issue
 * rejects the save). Dependency-free; no three.js.
 */
import { isPlacementId, isSemanticRole } from "../scene/placementIdentity";
import {
  arrayOf,
  type Ctx,
  idSet,
  isFiniteNumber,
  isNonNegativeInteger,
  isOneOf,
  isPositiveInteger,
  isRecord,
  issue,
  normalizeAssetPath,
  normalizeSeed,
  optionalPolygon,
  optionalPositive,
  optionalReference,
  optionalTokens,
  pointList,
  reject,
  requireId,
  requireNumber,
  requirePoint,
  requirePolygon,
  requireToken,
  round,
  uniqueEntries,
  type WorldPoint,
} from "./normalize";
import {
  LAND_USES,
  type LandUse,
  PROGRAM_SITINGS,
  type ProgramSiting,
  ROAD_CLASSES,
  type RoadClass,
} from "./vocabulary";

export type { WorldPoint } from "./normalize";

export const WORLD_RECIPE_SCHEMA_VERSION = 1;
export const WORLD_RECIPE_SUFFIX = ".worldrecipe.json";

export const PLAN_SOURCES = ["reference", "osm", "manual", "generated"] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

export const ROAD_NODE_KINDS = ["end", "junction", "gate"] as const;
export type RoadNodeKind = (typeof ROAD_NODE_KINDS)[number];

export const REFERENCE_VIEWS = ["topDown", "perspective"] as const;
export type ReferenceView = (typeof REFERENCE_VIEWS)[number];

/** Where a plan element came from; a re-run of one source leaves the others alone. */
export interface PlanProvenance {
  source: PlanSource;
  /** true: seen in the reference; false: inferred. Absent when not applicable. */
  observed?: boolean;
  /** 0..1; absent means not estimated. */
  confidence?: number;
}

/** A reference image laid over the world: its top-left corner and extent in metres. */
export interface WorldReference {
  /** Public-root-relative image path. */
  image?: string;
  origin: WorldPoint;
  size: WorldPoint;
  view?: ReferenceView;
}

export interface PlanRegion extends PlanProvenance {
  id: string;
  /** Token such as `mountain`, `valley`, `forest.conifer`. */
  kind: string;
  polygon: WorldPoint[];
}

export interface PlanWater extends PlanProvenance {
  id: string;
  /** Token such as `river`, `lake`, `stream`. */
  kind: string;
  /** Centre line (rivers); exactly one of `path` / `polygon`. */
  path?: WorldPoint[];
  /** Outline (lakes). */
  polygon?: WorldPoint[];
}

export interface PlanLandmark extends PlanProvenance {
  id: string;
  /** Token such as `logistics.depot`, `viewpoint`. */
  kind: string;
  position: WorldPoint;
  settlement?: string;
}

export interface ProgramEntry {
  role: string;
  count: number;
  siting?: ProgramSiting;
}

/** Where a settlement program line came from; later sources replace earlier ones for the same role. */
export const PROGRAM_SOURCES = ["profile", "game", "recipe"] as const;
export type ProgramSource = (typeof PROGRAM_SOURCES)[number];

/** One resolved line of a settlement's program (L1). */
export interface ProgramLine {
  role: string;
  count: number;
  siting: ProgramSiting;
  source: ProgramSource;
}

/** Changes to the program a settlement derives from population and its region profile. */
export interface SettlementProgram {
  add?: ProgramEntry[];
  remove?: string[];
}

export interface PlanSettlement extends PlanProvenance {
  id: string;
  center: WorldPoint;
  /** Search radius for site selection, metres. */
  radius?: number;
  boundary?: WorldPoint[];
  /** Token such as `hamlet`, `village`, `town`. */
  type: string;
  population?: number;
  /** Tokens such as `livestock`, `timber`. */
  economy?: string[];
  /** Public-root-relative `*.regionprofile.json`; overrides the recipe's. */
  regionProfile?: string;
  program?: SettlementProgram;
  /** Per-settlement seed (uint32); absent derives from the recipe seed. */
  seed?: number;
  /** A protected settlement is kept as is when stages re-run. */
  protected?: boolean;
}

export interface RoadNode extends PlanProvenance {
  id: string;
  position: WorldPoint;
  kind: RoadNodeKind;
  settlement?: string;
}

export interface RoadEdge extends PlanProvenance {
  id: string;
  from: string;
  to: string;
  roadClass: RoadClass;
  /** Corridor hint for the route solver, not the final geometry. */
  guide?: WorldPoint[];
}

export interface WorldPlan {
  regions: PlanRegion[];
  water: PlanWater[];
  landmarks: PlanLandmark[];
  settlements: PlanSettlement[];
  roadGraph: { nodes: RoadNode[]; edges: RoadEdge[] };
}

export interface GeneratedParcel {
  id: string;
  settlement: string;
  polygon: WorldPoint[];
  /** The road edge the parcel fronts. */
  frontage?: string;
  landUse?: LandUse;
  role?: string;
  /** The host parcel whose role this one is merged into (a lot of several parcels, L5). */
  partOf?: string;
  /** The placement standing on it. */
  placement?: string;
}

/** A settlement's chosen site and resolved program (L1 + L2), written by the `settlementSites` stage. */
export interface GeneratedSite {
  settlement: string;
  center: WorldPoint;
  /** Built-up core radius the program needs, metres. */
  coreRadius: number;
  /** Site score 0..1; absent when the site was not scored (a protected settlement keeps its planned centre). */
  score?: number;
  dwellings: number;
  program: ProgramLine[];
}

export interface OwnershipEntry {
  /** Token naming the stage, e.g. `roads`, `settlement`. */
  stage: string;
  /** Hash of the stage inputs that produced the object; absent until computed. */
  inputHash?: string;
  /**
   * Hash of the object exactly as the stage wrote it. A level object whose
   * current hash differs was edited by hand, and a re-run leaves it alone.
   */
  outputHash?: string;
}

export interface SplineOwnershipEntry extends OwnershipEntry {
  /** The road edge the spline realises. */
  edge?: string;
}

/** A box stages never touch, on the XZ plane. */
export interface ProtectedRegion {
  id: string;
  kind: string;
  min: WorldPoint;
  max: WorldPoint;
}

export interface WorldRecipe {
  schemaVersion: typeof WORLD_RECIPE_SCHEMA_VERSION;
  recipeId: string;
  /** Root seed (uint32). */
  seed: number;
  /** Generator name → version; a version bump marks its output stale. */
  generators: Record<string, number>;
  reference?: WorldReference;
  /** Public-root-relative default `*.regionprofile.json`. */
  regionProfile?: string;
  plan: WorldPlan;
  generated: { sites: GeneratedSite[]; parcels: GeneratedParcel[] };
  generation: {
    /** Stages leave objects outside `ownership` alone. Default true. */
    preserveManualOverrides: boolean;
    /** Stage tokens in run order. */
    stages: string[];
  };
  ownership: {
    placements: Record<string, OwnershipEntry>;
    splines: Record<string, SplineOwnershipEntry>;
    foliageRules: Record<string, OwnershipEntry>;
    protectedRegions: ProtectedRegion[];
  };
}

export interface WorldRecipeNormalization {
  /** null when the document is not a recipe at all (wrong schema, no id). */
  recipe: WorldRecipe | null;
  /** Each dropped or corrected value, with its path. Empty for a clean recipe. */
  issues: string[];
}

/** `<Level>.worldrecipe.json` beside the level, using the level sidecar naming rule. */
export function worldRecipePath(levelPath: string): string {
  const normalized = levelPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const base = normalized.replace(/(\.level|\.layout)?\.json$/i, "");
  if (!base || base === normalized) throw new Error("world recipe requires a .json level path");
  return `${base}${WORLD_RECIPE_SUFFIX}`;
}

export function createWorldRecipe(recipeId: string, seed = 0): WorldRecipe {
  if (!isPlacementId(recipeId)) throw new Error(`invalid recipeId "${recipeId}"`);
  return {
    schemaVersion: WORLD_RECIPE_SCHEMA_VERSION,
    recipeId,
    seed: normalizeSeed(seed) ?? 0,
    generators: {},
    plan: { regions: [], water: [], landmarks: [], settlements: [], roadGraph: { nodes: [], edges: [] } },
    generated: { sites: [], parcels: [] },
    generation: { preserveManualOverrides: true, stages: [] },
    ownership: { placements: {}, splines: {}, foliageRules: {}, protectedRegions: [] },
  };
}

export function normalizeWorldRecipe(value: unknown): WorldRecipeNormalization {
  const issues: string[] = [];
  if (!isRecord(value)) return { recipe: null, issues: ["recipe must be an object"] };
  if (value.schemaVersion !== WORLD_RECIPE_SCHEMA_VERSION) {
    return { recipe: null, issues: [`schemaVersion must be ${WORLD_RECIPE_SCHEMA_VERSION}`] };
  }
  if (!isPlacementId(value.recipeId)) return { recipe: null, issues: ["recipeId must be an id"] };

  const ctx: Ctx = { issues };
  const recipe = createWorldRecipe(value.recipeId);
  if (value.seed !== undefined) {
    const seed = normalizeSeed(value.seed);
    if (seed === null) issue(ctx, "seed", "must be an integer 0..4294967295");
    else recipe.seed = seed;
  }
  recipe.generators = normalizeGenerators(ctx, value.generators);
  if (value.reference !== undefined) {
    const reference = normalizeReference(ctx, value.reference);
    if (reference) recipe.reference = reference;
  }
  if (value.regionProfile !== undefined) {
    const profile = normalizeAssetPath(value.regionProfile, ".regionprofile.json");
    if (profile) recipe.regionProfile = profile;
    else issue(ctx, "regionProfile", "must be a public-root-relative .regionprofile.json path");
  }
  recipe.plan = normalizePlan(ctx, value.plan);
  recipe.generated = {
    sites: normalizeSites(ctx, value.generated, recipe.plan),
    parcels: normalizeParcels(ctx, value.generated, recipe.plan),
  };
  recipe.generation = normalizeGeneration(ctx, value.generation);
  recipe.ownership = normalizeOwnership(ctx, value.ownership, recipe.plan);
  return { recipe, issues };
}

// ─── Plan ───────────────────────────────────────────────────────────────────

function normalizePlan(ctx: Ctx, value: unknown): WorldPlan {
  const plan: WorldPlan = {
    regions: [], water: [], landmarks: [], settlements: [], roadGraph: { nodes: [], edges: [] },
  };
  if (value === undefined) return plan;
  if (!isRecord(value)) {
    issue(ctx, "plan", "must be an object");
    return plan;
  }
  plan.settlements = uniqueEntries(ctx, "plan.settlements", value.settlements, normalizeSettlement);
  const settlements = idSet(plan.settlements);
  plan.regions = uniqueEntries(ctx, "plan.regions", value.regions, normalizeRegion);
  plan.water = uniqueEntries(ctx, "plan.water", value.water, normalizeWater);
  plan.landmarks = uniqueEntries(ctx, "plan.landmarks", value.landmarks, (c, p, v) =>
    normalizeLandmark(c, p, v, settlements));

  const graph = value.roadGraph;
  if (graph !== undefined && !isRecord(graph)) {
    issue(ctx, "plan.roadGraph", "must be an object");
  } else if (graph) {
    plan.roadGraph.nodes = uniqueEntries(ctx, "plan.roadGraph.nodes", graph.nodes, (c, p, v) =>
      normalizeRoadNode(c, p, v, settlements));
    const nodes = idSet(plan.roadGraph.nodes);
    plan.roadGraph.edges = uniqueEntries(ctx, "plan.roadGraph.edges", graph.edges, (c, p, v) =>
      normalizeRoadEdge(c, p, v, nodes));
  }
  return plan;
}

function normalizeSettlement(ctx: Ctx, path: string, value: Record<string, unknown>): PlanSettlement | null {
  const id = requireId(ctx, path, value.id);
  const center = requirePoint(ctx, `${path}.center`, value.center);
  const type = requireToken(ctx, `${path}.type`, value.type);
  if (id === null || center === null || type === null) return null;
  const settlement: PlanSettlement = { id, ...provenance(ctx, path, value), center, type };
  const radius = optionalPositive(ctx, `${path}.radius`, value.radius);
  if (radius !== undefined) settlement.radius = radius;
  const boundary = optionalPolygon(ctx, `${path}.boundary`, value.boundary);
  if (boundary) settlement.boundary = boundary;
  if (value.population !== undefined) {
    if (isNonNegativeInteger(value.population)) settlement.population = value.population;
    else issue(ctx, `${path}.population`, "must be a non-negative integer");
  }
  const economy = optionalTokens(ctx, `${path}.economy`, value.economy);
  if (economy) settlement.economy = economy;
  if (value.regionProfile !== undefined) {
    const profile = normalizeAssetPath(value.regionProfile, ".regionprofile.json");
    if (profile) settlement.regionProfile = profile;
    else issue(ctx, `${path}.regionProfile`, "must be a public-root-relative .regionprofile.json path");
  }
  if (value.program !== undefined) {
    const program = normalizeProgram(ctx, `${path}.program`, value.program);
    if (program) settlement.program = program;
  }
  if (value.seed !== undefined) {
    const seed = normalizeSeed(value.seed);
    if (seed === null) issue(ctx, `${path}.seed`, "must be an integer 0..4294967295");
    else settlement.seed = seed;
  }
  if (value.protected !== undefined) {
    if (typeof value.protected === "boolean") {
      if (value.protected) settlement.protected = true;
    } else {
      issue(ctx, `${path}.protected`, "must be a boolean");
    }
  }
  return settlement;
}

function normalizeProgram(ctx: Ctx, path: string, value: unknown): SettlementProgram | null {
  if (!isRecord(value)) {
    issue(ctx, path, "must be an object");
    return null;
  }
  const program: SettlementProgram = {};
  if (value.add !== undefined) {
    const add = arrayOf(ctx, `${path}.add`, value.add, (c, p, entry) => {
      if (!isRecord(entry)) return reject(c, p, "must be an object");
      if (!isSemanticRole(entry.role)) return reject(c, `${p}.role`, "must be a semantic role");
      if (!isPositiveInteger(entry.count)) return reject(c, `${p}.count`, "must be a positive integer");
      const result: ProgramEntry = { role: entry.role, count: entry.count };
      if (entry.siting !== undefined) {
        if (isOneOf(PROGRAM_SITINGS, entry.siting)) result.siting = entry.siting;
        else issue(c, `${p}.siting`, `must be one of ${PROGRAM_SITINGS.join(", ")}`);
      }
      return result;
    });
    if (add.length > 0) program.add = add;
  }
  if (value.remove !== undefined) {
    const remove = arrayOf(ctx, `${path}.remove`, value.remove, (c, p, role) =>
      isSemanticRole(role) ? role : reject(c, p, "must be a semantic role"));
    if (remove.length > 0) program.remove = [...new Set(remove)];
  }
  return program.add || program.remove ? program : null;
}

function normalizeRegion(ctx: Ctx, path: string, value: Record<string, unknown>): PlanRegion | null {
  const id = requireId(ctx, path, value.id);
  const kind = requireToken(ctx, `${path}.kind`, value.kind);
  const polygon = requirePolygon(ctx, `${path}.polygon`, value.polygon);
  if (id === null || kind === null || polygon === null) return null;
  return { id, ...provenance(ctx, path, value), kind, polygon };
}

function normalizeWater(ctx: Ctx, path: string, value: Record<string, unknown>): PlanWater | null {
  const id = requireId(ctx, path, value.id);
  const kind = requireToken(ctx, `${path}.kind`, value.kind);
  if (id === null || kind === null) return null;
  if ((value.path === undefined) === (value.polygon === undefined)) {
    return reject(ctx, path, "needs exactly one of path or polygon");
  }
  const water: PlanWater = { id, ...provenance(ctx, path, value), kind };
  if (value.path !== undefined) {
    const line = pointList(ctx, `${path}.path`, value.path, 2);
    if (!line) return null;
    water.path = line;
  } else {
    const polygon = requirePolygon(ctx, `${path}.polygon`, value.polygon);
    if (!polygon) return null;
    water.polygon = polygon;
  }
  return water;
}

function normalizeLandmark(
  ctx: Ctx, path: string, value: Record<string, unknown>, settlements: ReadonlySet<string>,
): PlanLandmark | null {
  const id = requireId(ctx, path, value.id);
  const kind = requireToken(ctx, `${path}.kind`, value.kind);
  const position = requirePoint(ctx, `${path}.position`, value.position);
  if (id === null || kind === null || position === null) return null;
  const landmark: PlanLandmark = { id, ...provenance(ctx, path, value), kind, position };
  const settlement = optionalReference(ctx, `${path}.settlement`, value.settlement, settlements);
  if (settlement) landmark.settlement = settlement;
  return landmark;
}

function normalizeRoadNode(
  ctx: Ctx, path: string, value: Record<string, unknown>, settlements: ReadonlySet<string>,
): RoadNode | null {
  const id = requireId(ctx, path, value.id);
  const position = requirePoint(ctx, `${path}.position`, value.position);
  if (id === null || position === null) return null;
  if (!isOneOf(ROAD_NODE_KINDS, value.kind)) {
    return reject(ctx, `${path}.kind`, `must be one of ${ROAD_NODE_KINDS.join(", ")}`);
  }
  const node: RoadNode = { id, ...provenance(ctx, path, value), position, kind: value.kind };
  const settlement = optionalReference(ctx, `${path}.settlement`, value.settlement, settlements);
  if (settlement) node.settlement = settlement;
  return node;
}

function normalizeRoadEdge(
  ctx: Ctx, path: string, value: Record<string, unknown>, nodes: ReadonlySet<string>,
): RoadEdge | null {
  const id = requireId(ctx, path, value.id);
  if (id === null) return null;
  if (typeof value.from !== "string" || !nodes.has(value.from)) {
    return reject(ctx, `${path}.from`, "must name a road node");
  }
  if (typeof value.to !== "string" || !nodes.has(value.to)) {
    return reject(ctx, `${path}.to`, "must name a road node");
  }
  if (value.from === value.to) return reject(ctx, path, "from and to must differ");
  if (!isOneOf(ROAD_CLASSES, value.roadClass)) {
    return reject(ctx, `${path}.roadClass`, `must be one of ${ROAD_CLASSES.join(", ")}`);
  }
  const edge: RoadEdge = {
    id, ...provenance(ctx, path, value), from: value.from, to: value.to, roadClass: value.roadClass,
  };
  if (value.guide !== undefined) {
    const guide = pointList(ctx, `${path}.guide`, value.guide, 2);
    if (guide) edge.guide = guide;
  }
  return edge;
}

/** Plan elements default to `manual`: a hand-written element is the user's. */
function provenance(ctx: Ctx, path: string, value: Record<string, unknown>): PlanProvenance {
  const result: PlanProvenance = { source: "manual" };
  if (value.source !== undefined) {
    if (isOneOf(PLAN_SOURCES, value.source)) result.source = value.source;
    else issue(ctx, `${path}.source`, `must be one of ${PLAN_SOURCES.join(", ")}`);
  }
  if (value.observed !== undefined) {
    if (typeof value.observed === "boolean") result.observed = value.observed;
    else issue(ctx, `${path}.observed`, "must be a boolean");
  }
  if (value.confidence !== undefined) {
    if (isFiniteNumber(value.confidence) && value.confidence >= 0 && value.confidence <= 1) {
      result.confidence = round(value.confidence);
    } else {
      issue(ctx, `${path}.confidence`, "must be a number 0..1");
    }
  }
  return result;
}

// ─── Generated, generation, ownership ───────────────────────────────────────

function normalizeSites(ctx: Ctx, value: unknown, plan: WorldPlan): GeneratedSite[] {
  if (!isRecord(value) || value.sites === undefined) return [];
  const settlements = idSet(plan.settlements);
  const seen = new Set<string>();
  return arrayOf(ctx, "generated.sites", value.sites, (c, p, site) => {
    if (!isRecord(site)) return reject(c, p, "must be an object");
    if (typeof site.settlement !== "string" || !settlements.has(site.settlement)) {
      return reject(c, `${p}.settlement`, "must name a plan settlement");
    }
    const center = requirePoint(c, `${p}.center`, site.center);
    const coreRadius = optionalPositive(c, `${p}.coreRadius`, site.coreRadius);
    if (center === null) return null;
    if (coreRadius === undefined) return reject(c, `${p}.coreRadius`, "must be a positive number");
    if (!isNonNegativeInteger(site.dwellings)) return reject(c, `${p}.dwellings`, "must be a non-negative integer");
    if (seen.has(site.settlement)) return reject(c, `${p}.settlement`, `repeats settlement "${site.settlement}"`);
    const score = site.score === undefined ? null : requireNumber(c, `${p}.score`, site.score, 0, 1);
    // Field order matches what the stage writes, so a reloaded recipe compares equal to a re-run's.
    const result: GeneratedSite = {
      settlement: site.settlement, center, coreRadius, ...(score === null ? {} : { score }), dwellings: site.dwellings, program: [],
    };
    result.program = arrayOf(c, `${p}.program`, site.program ?? [], (c2, p2, line) => {
      if (!isRecord(line)) return reject(c2, p2, "must be an object");
      if (!isSemanticRole(line.role)) return reject(c2, `${p2}.role`, "must be a semantic role");
      if (!isPositiveInteger(line.count)) return reject(c2, `${p2}.count`, "must be a positive integer");
      if (!isOneOf(PROGRAM_SITINGS, line.siting)) return reject(c2, `${p2}.siting`, `must be one of ${PROGRAM_SITINGS.join(", ")}`);
      if (!isOneOf(PROGRAM_SOURCES, line.source)) return reject(c2, `${p2}.source`, `must be one of ${PROGRAM_SOURCES.join(", ")}`);
      const entry: ProgramLine = { role: line.role, count: line.count, siting: line.siting, source: line.source };
      return entry;
    });
    seen.add(site.settlement);
    return result;
  });
}

function normalizeParcels(ctx: Ctx, value: unknown, plan: WorldPlan): GeneratedParcel[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    issue(ctx, "generated", "must be an object");
    return [];
  }
  const settlements = idSet(plan.settlements);
  const edges = idSet(plan.roadGraph.edges);
  const paths = new Map<GeneratedParcel, string>();
  const parcels = uniqueEntries(ctx, "generated.parcels", value.parcels, (c, p, parcel) => {
    const id = requireId(c, p, parcel.id);
    const polygon = requirePolygon(c, `${p}.polygon`, parcel.polygon);
    if (id === null || polygon === null) return null;
    if (typeof parcel.settlement !== "string" || !settlements.has(parcel.settlement)) {
      return reject(c, `${p}.settlement`, "must name a plan settlement");
    }
    const result: GeneratedParcel = { id, settlement: parcel.settlement, polygon };
    const frontage = optionalReference(c, `${p}.frontage`, parcel.frontage, edges);
    if (frontage) result.frontage = frontage;
    if (parcel.landUse !== undefined) {
      if (isOneOf(LAND_USES, parcel.landUse)) result.landUse = parcel.landUse;
      else issue(c, `${p}.landUse`, `must be one of ${LAND_USES.join(", ")}`);
    }
    if (parcel.role !== undefined) {
      if (isSemanticRole(parcel.role)) result.role = parcel.role;
      else issue(c, `${p}.role`, "must be a semantic role");
    }
    if (parcel.partOf !== undefined) {
      if (isPlacementId(parcel.partOf)) result.partOf = parcel.partOf;
      else issue(c, `${p}.partOf`, "must be a parcel id");
    }
    if (parcel.placement !== undefined) {
      if (isPlacementId(parcel.placement)) result.placement = parcel.placement;
      else issue(c, `${p}.placement`, "must be a placement id");
    }
    paths.set(result, p);
    return result;
  });
  const byId = new Map(parcels.map((parcel) => [parcel.id, parcel]));
  for (const parcel of parcels) {
    if (parcel.partOf === undefined) continue;
    const host = byId.get(parcel.partOf);
    if (!host || host === parcel || host.settlement !== parcel.settlement || host.partOf !== undefined) {
      issue(ctx, `${paths.get(parcel)}.partOf`, "must name another, unmerged parcel of the same settlement");
      delete parcel.partOf;
    }
  }
  return parcels;
}

function normalizeGeneration(ctx: Ctx, value: unknown): WorldRecipe["generation"] {
  const generation: WorldRecipe["generation"] = { preserveManualOverrides: true, stages: [] };
  if (value === undefined) return generation;
  if (!isRecord(value)) {
    issue(ctx, "generation", "must be an object");
    return generation;
  }
  if (value.preserveManualOverrides !== undefined) {
    if (typeof value.preserveManualOverrides === "boolean") {
      generation.preserveManualOverrides = value.preserveManualOverrides;
    } else {
      issue(ctx, "generation.preserveManualOverrides", "must be a boolean");
    }
  }
  if (value.stages !== undefined) {
    const stages = arrayOf(ctx, "generation.stages", value.stages, (c, p, stage) =>
      isSemanticRole(stage) ? stage : reject(c, p, "must be a stage token"));
    const unique = [...new Set(stages)];
    if (unique.length !== stages.length) issue(ctx, "generation.stages", "repeated stages were removed");
    generation.stages = unique;
  }
  return generation;
}

function normalizeOwnership(ctx: Ctx, value: unknown, plan: WorldPlan): WorldRecipe["ownership"] {
  const ownership: WorldRecipe["ownership"] = {
    placements: {}, splines: {}, foliageRules: {}, protectedRegions: [],
  };
  if (value === undefined) return ownership;
  if (!isRecord(value)) {
    issue(ctx, "ownership", "must be an object");
    return ownership;
  }
  ownership.placements = ownershipMap(ctx, "ownership.placements", value.placements, () => ({}));
  const edges = idSet(plan.roadGraph.edges);
  ownership.splines = ownershipMap(ctx, "ownership.splines", value.splines, (c, p, entry) => {
    const edge = optionalReference(c, `${p}.edge`, entry.edge, edges);
    return edge ? { edge } : {};
  });
  ownership.foliageRules = ownershipMap(ctx, "ownership.foliageRules", value.foliageRules, () => ({}));
  ownership.protectedRegions = uniqueEntries(ctx, "ownership.protectedRegions", value.protectedRegions,
    (c, p, region) => {
      const id = requireId(c, p, region.id);
      const kind = requireToken(c, `${p}.kind`, region.kind);
      const min = requirePoint(c, `${p}.min`, region.min);
      const max = requirePoint(c, `${p}.max`, region.max);
      if (id === null || kind === null || min === null || max === null) return null;
      if (min[0] >= max[0] || min[1] >= max[1]) return reject(c, p, "min must be below max on both axes");
      return { id, kind, min, max };
    });
  return ownership;
}

function ownershipMap<T extends OwnershipEntry>(
  ctx: Ctx,
  path: string,
  value: unknown,
  extra: (ctx: Ctx, path: string, entry: Record<string, unknown>) => Omit<T, keyof OwnershipEntry>,
): Record<string, T> {
  const result: Record<string, T> = {};
  if (value === undefined) return result;
  if (!isRecord(value)) {
    issue(ctx, path, "must be an object keyed by id");
    return result;
  }
  for (const key of Object.keys(value).sort()) {
    const entryPath = `${path}.${key}`;
    const entry = value[key];
    if (!isPlacementId(key)) {
      issue(ctx, entryPath, "key must be an id");
      continue;
    }
    if (!isRecord(entry) || !isSemanticRole(entry.stage)) {
      issue(ctx, entryPath, "needs a stage token");
      continue;
    }
    const owned = { stage: entry.stage } as T;
    for (const field of ["inputHash", "outputHash"] as const) {
      const hash = entry[field];
      if (hash === undefined) continue;
      if (typeof hash === "string" && /^[0-9a-f]{1,64}$/.test(hash)) owned[field] = hash;
      else issue(ctx, `${entryPath}.${field}`, "must be a lowercase hex string");
    }
    Object.assign(owned, extra(ctx, entryPath, entry));
    result[key] = owned;
  }
  return result;
}

function normalizeGenerators(ctx: Ctx, value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (value === undefined) return result;
  if (!isRecord(value)) {
    issue(ctx, "generators", "must be an object");
    return result;
  }
  for (const key of Object.keys(value).sort()) {
    if (!isSemanticRole(key)) issue(ctx, `generators.${key}`, "key must be a generator token");
    else if (!isPositiveInteger(value[key])) issue(ctx, `generators.${key}`, "must be a positive integer");
    else result[key] = value[key] as number;
  }
  return result;
}

function normalizeReference(ctx: Ctx, value: unknown): WorldReference | null {
  if (!isRecord(value)) {
    issue(ctx, "reference", "must be an object");
    return null;
  }
  const origin = requirePoint(ctx, "reference.origin", value.origin);
  const size = requirePoint(ctx, "reference.size", value.size);
  if (origin === null || size === null) return null;
  if (size[0] <= 0 || size[1] <= 0) return reject(ctx, "reference.size", "must be positive");
  const reference: WorldReference = { origin, size };
  if (value.image !== undefined) {
    const image = normalizeAssetPath(value.image, null);
    if (image) reference.image = image;
    else issue(ctx, "reference.image", "must be a public-root-relative path");
  }
  if (value.view !== undefined) {
    if (isOneOf(REFERENCE_VIEWS, value.view)) reference.view = value.view;
    else issue(ctx, "reference.view", `must be one of ${REFERENCE_VIEWS.join(", ")}`);
  }
  return reference;
}
