/**
 * Stage Runner core (World Builder plan v0.4 §2.1, §3.2, §6.2, §10 #4).
 *
 * A stage is a pure, deterministic function from the recipe (+ level, region
 * profile, World Terrains) to the objects it wants to exist: placements and
 * World Terrain splines. `planStage` turns that wish into a change set against
 * the level — the dry run — and never touches anything a stage does not own:
 *
 * - Objects not in `recipe.ownership` are manual: a wanted id that collides with
 *   one is blocked, never overwritten.
 * - An owned object whose content no longer matches the `outputHash` it was
 *   written with was edited by hand; with `preserveManualOverrides` it is kept.
 *   An owned object missing from the level was deleted by hand and is not
 *   brought back.
 * - Nothing is created, moved or removed inside a protected region, nor on a
 *   locked terrain.
 *
 * Placements and splines follow the same rules (`reconcile`); their ownership
 * lives in `recipe.ownership.placements` / `.splines`. Running the same stage on
 * its own output yields an empty plan (idempotent). The plan carries whole
 * before/after placement arrays per touched asset group and whole spline lists
 * per touched terrain, so the editor applies and undoes it as one history step
 * with one rebuild per group / terrain. Dependency-free; no three.js.
 */
import type { LayoutPlacement, RoomLayout } from "../scene/layout";
import { findDuplicatePlacementId, isPlacementId, isSemanticRole } from "../scene/placementIdentity";
import { normalizeTerrainSplines } from "../terrain/terrainSplineData";
import type { TerrainSpline, WorldTerrainSpline } from "../terrain/terrainTypes";
import type { WorldPoint } from "./normalize";
import { normalizeWorldRecipe, type OwnershipEntry, type SplineOwnershipEntry, type WorldRecipe } from "./recipe";
import type { RegionProfile } from "./regionProfile";

/** A World Terrain of the level, as stages see it. */
export interface StageTerrain {
  /** The Landscape actor id. */
  readonly id: string;
  /** XZ box the tile grid covers, world metres. */
  readonly min: WorldPoint;
  readonly max: WorldPoint;
  readonly layers: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** The definition's splines as they are now. */
  readonly splines: readonly TerrainSpline[];
  /** A locked terrain's splines are never written. */
  readonly locked: boolean;
}

export interface StageInput {
  readonly recipe: WorldRecipe;
  readonly layout: RoomLayout;
  /** The recipe's region profile, when it has one and it loaded. */
  readonly profile: RegionProfile | null;
  /** Terrain height at world XZ, or null where there is no terrain. */
  readonly sampleHeight: (x: number, z: number) => number | null;
  /** The level's loaded World Terrains, in level order. */
  readonly terrains: readonly StageTerrain[];
}

/** One placement a stage wants; `placement.id` is its stable identity. */
export interface GeneratedPlacement {
  assetId: string;
  placement: LayoutPlacement & { id: string };
}

/** One spline a stage wants on a World Terrain; `spline.id` is its stable identity. */
export interface GeneratedSpline {
  /** The `StageTerrain.id` that holds it. */
  landscapeId: string;
  spline: WorldTerrainSpline;
  /** The road edge it realises, recorded in its ownership entry. */
  edge?: string;
}

export interface StageOutput {
  placements: GeneratedPlacement[];
  splines?: GeneratedSpline[];
  /** Replaces the named `recipe.generated` sections. */
  generated?: Partial<WorldRecipe["generated"]>;
  warnings: string[];
}

export interface WorldStage {
  /** Token; also the ownership `stage` and the `recipe.generators` key. */
  readonly id: string;
  readonly label: string;
  /** Generator version (positive integer), recorded in `recipe.generators`. */
  readonly version: number;
  run(input: StageInput): StageOutput;
}

export type BlockedReason = "manual" | "otherStage" | "protected" | "locked";
export type KeptReason = "editedByHand" | "deletedByHand" | "protected" | "locked";

/** A touched asset group, whole. `null` means the group is absent on that side. */
export interface PlacementGroupChange {
  assetId: string;
  /** Index of the group in `layout.instances` before the change, for undo. */
  beforeIndex: number | null;
  before: LayoutPlacement[] | null;
  after: LayoutPlacement[] | null;
}

/** A touched World Terrain's spline list, whole. */
export interface TerrainSplineChange {
  landscapeId: string;
  before: TerrainSpline[];
  after: TerrainSpline[];
}

export interface StagePlan {
  stageId: string;
  stageLabel: string;
  version: number;
  /** Placement and spline ids. */
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: number;
  /** Owned objects left as they are, and why. */
  kept: Array<{ id: string; reason: KeptReason }>;
  /** Wanted objects the stage may not write, and why. */
  blocked: Array<{ id: string; reason: BlockedReason }>;
  warnings: string[];
  /** A non-empty list means the plan must not be applied. */
  errors: string[];
  /** XZ box around every added, moved and removed object. */
  bounds: { min: WorldPoint; max: WorldPoint } | null;
  groupChanges: PlacementGroupChange[];
  splineChanges: TerrainSplineChange[];
  recipeBefore: WorldRecipe;
  recipeAfter: WorldRecipe;
  /** Neither the level, its terrains nor the recipe change. */
  empty: boolean;
}

interface Located {
  assetId: string;
  placement: LayoutPlacement;
}

interface LocatedSpline {
  landscapeId: string;
  spline: TerrainSpline;
  edge?: string;
}

export function planStage(stage: WorldStage, input: StageInput): StagePlan {
  const recipeBefore = structuredClone(input.recipe);
  const plan: StagePlan = {
    stageId: stage.id,
    stageLabel: stage.label,
    version: stage.version,
    added: [],
    updated: [],
    removed: [],
    unchanged: 0,
    kept: [],
    blocked: [],
    warnings: [],
    errors: [],
    bounds: null,
    groupChanges: [],
    splineChanges: [],
    recipeBefore,
    recipeAfter: structuredClone(recipeBefore),
    empty: true,
  };
  if (!isSemanticRole(stage.id)) plan.errors.push(`stage id "${stage.id}" must be a token`);
  if (!Number.isInteger(stage.version) || stage.version < 1) plan.errors.push(`stage ${stage.id} version must be a positive integer`);
  if (plan.errors.length > 0) return plan;

  const output = stage.run(input);
  plan.warnings.push(...output.warnings);
  const ownership = input.recipe.ownership;
  const preserve = input.recipe.generation.preserveManualOverrides;
  const touched: WorldPoint[] = [];
  const isProtected = (point: WorldPoint) =>
    ownership.protectedRegions.some((region) => insideRegion(point, region.min, region.max));

  const groups = new WorkingGroups(input.layout);
  const placements = reconcile<Located>(stage.id, preserve, plan, touched, {
    owned: ownership.placements,
    wanted: collectWanted(output, plan),
    current: locatePlacements(input.layout),
    hash: placementHash,
    guard: (item) => (isProtected(xz(item.placement)) ? "protected" : null),
    points: (item) => [xz(item.placement)],
    entry: (item) => ({ stage: stage.id, outputHash: placementHash(item) }),
    add: (item) => groups.append(item),
    remove: (item) => groups.remove(item.assetId, item.placement.id!),
    replace: (current, next) => groups.replace(current.assetId, current.placement.id!, next),
  });

  const terrains = new Map(input.terrains.map((terrain) => [terrain.id, terrain]));
  const lists = new WorkingSplines(input.terrains);
  const splines = reconcile<LocatedSpline>(stage.id, preserve, plan, touched, {
    owned: ownership.splines,
    wanted: collectWantedSplines(output, plan, terrains),
    current: locateSplines(input.terrains, ownership.splines, plan),
    hash: splineHash,
    guard: (item) => terrains.get(item.landscapeId)?.locked
      ? "locked"
      : item.spline.points.some((point) => isProtected(splinePointXz(point.position))) ? "protected" : null,
    points: (item) => item.spline.points.map((point) => splinePointXz(point.position)),
    entry: (item): SplineOwnershipEntry => ({
      stage: stage.id, outputHash: splineHash(item), ...(item.edge === undefined ? {} : { edge: item.edge }),
    }),
    add: (item) => lists.add(item),
    remove: (item) => lists.remove(item),
    replace: (current, next) => lists.replace(current, next),
  });

  plan.groupChanges = groups.changes();
  plan.splineChanges = lists.changes();
  plan.bounds = boundsOf(touched);
  plan.recipeAfter = nextRecipe(input.recipe, stage, placements, splines, output.generated);
  validatePlan(plan, input.layout);
  plan.empty = plan.groupChanges.length === 0 && plan.splineChanges.length === 0 &&
    JSON.stringify(plan.recipeAfter) === JSON.stringify(plan.recipeBefore);
  return plan;
}

/**
 * Writes one side of a plan's group changes into `layout.instances` and returns
 * the asset ids whose render groups need a rebuild. Applying "after" then
 * "before" restores the layout exactly, group order included.
 */
export function applyPlacementGroupChanges(
  layout: RoomLayout,
  changes: readonly PlacementGroupChange[],
  side: "before" | "after",
): string[] {
  const ordered = side === "after" ? changes : [...changes].reverse();
  for (const change of ordered) {
    const target = side === "after" ? change.after : change.before;
    const index = layout.instances.findIndex((group) => group.assetId === change.assetId);
    if (target === null) {
      if (index >= 0) layout.instances.splice(index, 1);
      continue;
    }
    const placements = structuredClone(target);
    if (index >= 0) {
      layout.instances[index]!.placements = placements;
    } else if (side === "before" && change.beforeIndex !== null) {
      layout.instances.splice(Math.min(change.beforeIndex, layout.instances.length), 0, {
        assetId: change.assetId, placements,
      });
    } else {
      layout.instances.push({ assetId: change.assetId, placements });
    }
  }
  return changes.map((change) => change.assetId);
}

/** Content hash of a placement as a stage wrote it (asset + every field). */
export function placementHash(entry: { assetId: string; placement: LayoutPlacement }): string {
  return contentHash({ assetId: entry.assetId, placement: entry.placement });
}

/** Content hash of a spline as a stage wrote it (terrain + every field). */
export function splineHash(entry: { landscapeId: string; spline: TerrainSpline }): string {
  return contentHash({ landscapeId: entry.landscapeId, spline: entry.spline });
}

// ─── Internals ──────────────────────────────────────────────────────────────

/** How `reconcile` reads and writes one kind of owned object. */
interface Ledger<T> {
  /** The recipe ownership section of this kind. */
  owned: Readonly<Record<string, OwnershipEntry>>;
  wanted: ReadonlyMap<string, T>;
  current: ReadonlyMap<string, T>;
  hash(item: T): string;
  /** Why the item may not be written or removed, or null. */
  guard(item: T): "protected" | "locked" | null;
  points(item: T): WorldPoint[];
  entry(item: T): OwnershipEntry;
  add(item: T): void;
  remove(item: T): void;
  replace(current: T, next: T): void;
}

/**
 * The ownership rules, for one kind of object: fills the plan's id lists and
 * returns the next ownership section.
 */
function reconcile<T>(
  stageId: string,
  preserve: boolean,
  plan: StagePlan,
  touched: WorldPoint[],
  ledger: Ledger<T>,
): Record<string, OwnershipEntry> {
  const next: Record<string, OwnershipEntry> = structuredClone(ledger.owned);
  const add = (id: string, want: T): void => {
    ledger.add(want);
    next[id] = ledger.entry(want);
    plan.added.push(id);
    touched.push(...ledger.points(want));
  };

  const owned = Object.keys(ledger.owned).filter((id) => ledger.owned[id]!.stage === stageId).sort();
  for (const id of owned) {
    const entry = ledger.owned[id]!;
    const current = ledger.current.get(id);
    const want = ledger.wanted.get(id);
    if (current === undefined) {
      if (want === undefined) {
        delete next[id];
      } else if (preserve) {
        plan.kept.push({ id, reason: "deletedByHand" });
      } else {
        const guard = ledger.guard(want);
        if (guard) plan.kept.push({ id, reason: guard });
        else add(id, want);
      }
      continue;
    }
    if (preserve && entry.outputHash !== undefined && entry.outputHash !== ledger.hash(current)) {
      plan.kept.push({ id, reason: "editedByHand" });
      continue;
    }
    const guard = ledger.guard(current) ?? (want === undefined ? null : ledger.guard(want));
    if (guard) {
      plan.kept.push({ id, reason: guard });
      continue;
    }
    if (want === undefined) {
      ledger.remove(current);
      delete next[id];
      plan.removed.push(id);
      touched.push(...ledger.points(current));
      continue;
    }
    next[id] = ledger.entry(want);
    if (ledger.hash(current) === ledger.hash(want)) {
      plan.unchanged += 1;
      continue;
    }
    ledger.replace(current, want);
    plan.updated.push(id);
    touched.push(...ledger.points(current), ...ledger.points(want));
  }

  for (const [id, want] of ledger.wanted) {
    const entry = ledger.owned[id];
    if (entry?.stage === stageId) continue;
    if (entry) {
      plan.blocked.push({ id, reason: "otherStage" });
    } else if (ledger.current.has(id)) {
      plan.blocked.push({ id, reason: "manual" });
    } else {
      const guard = ledger.guard(want);
      if (guard) plan.blocked.push({ id, reason: guard });
      else add(id, want);
    }
  }
  return Object.fromEntries(Object.keys(next).sort().map((id) => [id, next[id]!]));
}

function collectWanted(output: StageOutput, plan: StagePlan): Map<string, Located> {
  const wanted = new Map<string, Located>();
  output.placements.forEach((entry, index) => {
    const id = entry.placement.id;
    if (!isPlacementId(id)) {
      plan.errors.push(`stage output placements[${index}]: id must be an id`);
    } else if (typeof entry.assetId !== "string" || entry.assetId.length === 0) {
      plan.errors.push(`stage output ${id}: assetId must be a non-empty string`);
    } else if (entry.placement.role !== undefined && !isSemanticRole(entry.placement.role)) {
      plan.errors.push(`stage output ${id}: role must be a semantic role`);
    } else if (wanted.has(id)) {
      plan.errors.push(`stage output repeats id "${id}"`);
    } else {
      const placement = saveCanonicalTransform(structuredClone(entry.placement));
      if (typeof placement === "string") plan.errors.push(`stage output ${id}: ${placement}`);
      else wanted.set(id, { assetId: entry.assetId, placement });
    }
  });
  return wanted;
}

/**
 * Validates wanted splines and puts each through the terrain spline normalizer,
 * so the hash taken now is the hash of what the terrain save writes back.
 */
function collectWantedSplines(
  output: StageOutput,
  plan: StagePlan,
  terrains: ReadonlyMap<string, StageTerrain>,
): Map<string, LocatedSpline> {
  const wanted = new Map<string, LocatedSpline>();
  (output.splines ?? []).forEach((entry, index) => {
    const id = entry.spline.id;
    if (!isPlacementId(id)) {
      plan.errors.push(`stage output splines[${index}]: id must be an id`);
    } else if (!terrains.has(entry.landscapeId)) {
      plan.errors.push(`stage output spline ${id}: terrain "${entry.landscapeId}" is not loaded`);
    } else if (entry.spline.coordinateSpace !== "world") {
      plan.errors.push(`stage output spline ${id}: coordinateSpace must be world`);
    } else if (wanted.has(id)) {
      plan.errors.push(`stage output repeats spline id "${id}"`);
    } else {
      try {
        const [spline] = normalizeTerrainSplines([entry.spline]);
        wanted.set(id, { landscapeId: entry.landscapeId, spline: spline!, ...(entry.edge === undefined ? {} : { edge: entry.edge }) });
      } catch (error) {
        plan.errors.push(`stage output spline ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  return wanted;
}

/**
 * Rounds the transform exactly like the layout save (position/scale/pivot to
 * 3 decimals, rotations to 1), so the hash taken now still matches after a
 * save and reload. Returns an error message for a transform the save would
 * reject. Stages must also omit default-valued flags the save drops (see the
 * stage tests' save round-trip check).
 */
function saveCanonicalTransform<T extends LayoutPlacement>(placement: T): T | string {
  const finite = (values: readonly number[]) => values.every((value) => Number.isFinite(value));
  if (!Array.isArray(placement.position) || placement.position.length !== 3 || !finite(placement.position)) {
    return "position must be three finite numbers";
  }
  placement.position = placement.position.map((value) => round(value, 3)) as LayoutPlacement["position"];
  if (placement.rotation !== undefined) {
    if (!finite(placement.rotation) || placement.rotation.some((value) => Math.abs(value) > 360)) {
      return "rotation components must be within ±360";
    }
    placement.rotation = placement.rotation.map((value) => round(value, 1)) as LayoutPlacement["position"];
  }
  if (placement.rotationYDeg !== undefined) placement.rotationYDeg = round(placement.rotationYDeg, 1);
  if (placement.pivot !== undefined) {
    placement.pivot = placement.pivot.map((value) => round(value, 3)) as LayoutPlacement["position"];
  }
  if (placement.scale !== undefined) {
    const axes = typeof placement.scale === "number" ? [placement.scale] : placement.scale;
    if (!finite(axes) || axes.some((value) => value <= 0 || value > 1000)) return "scale must be within (0, 1000]";
    placement.scale = typeof placement.scale === "number"
      ? round(placement.scale, 3)
      : placement.scale.map((value) => round(value, 3)) as LayoutPlacement["position"];
  }
  return placement;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function locatePlacements(layout: RoomLayout): Map<string, Located> {
  const located = new Map<string, Located>();
  for (const group of layout.instances) {
    for (const placement of group.placements) {
      if (placement.id !== undefined) located.set(placement.id, { assetId: group.assetId, placement });
    }
  }
  return located;
}

/**
 * Spline ids are unique per terrain only. Hand-made splines may repeat an id
 * across terrains freely; an id the stage owns or wants may not.
 */
function locateSplines(
  terrains: readonly StageTerrain[],
  owned: Readonly<Record<string, OwnershipEntry>>,
  plan: StagePlan,
): Map<string, LocatedSpline> {
  const located = new Map<string, LocatedSpline>();
  const repeated = new Set<string>();
  for (const terrain of terrains) {
    for (const spline of terrain.splines) {
      if (located.has(spline.id)) repeated.add(spline.id);
      else located.set(spline.id, { landscapeId: terrain.id, spline });
    }
  }
  for (const id of [...repeated].sort()) {
    if (owned[id]?.stage === plan.stageId) plan.errors.push(`spline id "${id}" is on more than one terrain`);
  }
  return located;
}

/** Copy-on-write view of the touched asset groups. */
class WorkingGroups {
  private readonly groups = new Map<string, { beforeIndex: number | null; before: LayoutPlacement[] | null; after: LayoutPlacement[] }>();

  constructor(private readonly layout: RoomLayout) {}

  append(entry: Located): void {
    this.group(entry.assetId).push(structuredClone(entry.placement));
  }

  remove(assetId: string, id: string): void {
    const placements = this.group(assetId);
    const index = placements.findIndex((placement) => placement.id === id);
    if (index >= 0) placements.splice(index, 1);
  }

  /** Same asset: in place, keeping its order. New asset: moved to that group's end. */
  replace(assetId: string, id: string, next: Located): void {
    if (assetId === next.assetId) {
      const placements = this.group(assetId);
      const index = placements.findIndex((placement) => placement.id === id);
      if (index >= 0) {
        placements[index] = structuredClone(next.placement);
        return;
      }
    }
    this.remove(assetId, id);
    this.append(next);
  }

  changes(): PlacementGroupChange[] {
    const changes: PlacementGroupChange[] = [];
    for (const [assetId, group] of this.groups) {
      const after = group.after.length > 0 ? group.after : null;
      if (canonicalJson(after) === canonicalJson(group.before)) continue;
      changes.push({ assetId, beforeIndex: group.beforeIndex, before: group.before, after });
    }
    return changes;
  }

  private group(assetId: string): LayoutPlacement[] {
    let group = this.groups.get(assetId);
    if (!group) {
      const index = this.layout.instances.findIndex((entry) => entry.assetId === assetId);
      const before = index >= 0 ? structuredClone(this.layout.instances[index]!.placements) : null;
      group = { beforeIndex: index >= 0 ? index : null, before, after: before ? structuredClone(before) : [] };
      this.groups.set(assetId, group);
    }
    return group.after;
  }
}

/** Copy-on-write view of the touched terrains' spline lists. */
class WorkingSplines {
  private readonly lists = new Map<string, { before: TerrainSpline[]; after: TerrainSpline[] }>();

  constructor(private readonly terrains: readonly StageTerrain[]) {}

  add(item: LocatedSpline): void {
    this.list(item.landscapeId).push(structuredClone(item.spline));
  }

  remove(item: LocatedSpline): void {
    const splines = this.list(item.landscapeId);
    const index = splines.findIndex((spline) => spline.id === item.spline.id);
    if (index >= 0) splines.splice(index, 1);
  }

  /** Same terrain: in place, keeping its order. Another terrain: moved to that list's end. */
  replace(current: LocatedSpline, next: LocatedSpline): void {
    if (current.landscapeId === next.landscapeId) {
      const splines = this.list(current.landscapeId);
      const index = splines.findIndex((spline) => spline.id === current.spline.id);
      if (index >= 0) {
        splines[index] = structuredClone(next.spline);
        return;
      }
    }
    this.remove(current);
    this.add(next);
  }

  /** In level terrain order. */
  changes(): TerrainSplineChange[] {
    return this.terrains.flatMap((terrain) => {
      const list = this.lists.get(terrain.id);
      if (!list || canonicalJson(list.before) === canonicalJson(list.after)) return [];
      return [{ landscapeId: terrain.id, before: list.before, after: list.after }];
    });
  }

  private list(landscapeId: string): TerrainSpline[] {
    let list = this.lists.get(landscapeId);
    if (!list) {
      const splines = this.terrains.find((terrain) => terrain.id === landscapeId)?.splines ?? [];
      list = { before: structuredClone([...splines]), after: structuredClone([...splines]) };
      this.lists.set(landscapeId, list);
    }
    return list.after;
  }
}

function nextRecipe(
  recipe: WorldRecipe,
  stage: WorldStage,
  placements: Record<string, OwnershipEntry>,
  splines: Record<string, SplineOwnershipEntry>,
  generated: StageOutput["generated"],
): WorldRecipe {
  const next = structuredClone(recipe);
  next.ownership.placements = placements;
  next.ownership.splines = splines;
  next.generators = Object.fromEntries(
    Object.entries({ ...next.generators, [stage.id]: stage.version }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  if (!next.generation.stages.includes(stage.id)) next.generation.stages.push(stage.id);
  if (generated) {
    for (const key of Object.keys(generated) as Array<keyof WorldRecipe["generated"]>) {
      if (generated[key]) next.generated[key] = structuredClone(generated[key]!);
    }
  }
  return next;
}

/** The plan's result must still be a valid level, valid terrain splines and a valid, clean recipe. */
function validatePlan(plan: StagePlan, layout: RoomLayout): void {
  const instances = layout.instances.map((group) => {
    const change = plan.groupChanges.find((entry) => entry.assetId === group.assetId);
    return change ? { placements: change.after ?? [] } : group;
  });
  for (const change of plan.groupChanges) {
    if (change.beforeIndex === null && change.after) instances.push({ placements: change.after });
  }
  const duplicate = findDuplicatePlacementId(instances);
  if (duplicate !== null) plan.errors.push(`the result would repeat placement id "${duplicate}"`);
  for (const change of plan.splineChanges) {
    try {
      normalizeTerrainSplines(change.after);
    } catch (error) {
      plan.errors.push(`terrain ${change.landscapeId} splines after the stage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const { issues } = normalizeWorldRecipe(plan.recipeAfter);
  plan.errors.push(...issues.map((issue) => `recipe after the stage: ${issue}`));
}

function insideRegion(point: WorldPoint, min: WorldPoint, max: WorldPoint): boolean {
  return point[0] >= min[0] && point[0] <= max[0] && point[1] >= min[1] && point[1] <= max[1];
}

function xz(placement: LayoutPlacement): WorldPoint {
  return [placement.position[0] ?? 0, placement.position[2] ?? 0];
}

function splinePointXz(position: readonly number[]): WorldPoint {
  return [position[0] ?? 0, position[2] ?? 0];
}

function boundsOf(points: readonly WorldPoint[]): StagePlan["bounds"] {
  if (points.length === 0) return null;
  const min: WorldPoint = [Infinity, Infinity];
  const max: WorldPoint = [-Infinity, -Infinity];
  for (const [x, z] of points) {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], z);
  }
  return { min, max };
}

function contentHash(value: unknown): string {
  const text = canonicalJson(value);
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01000193);
}

/** JSON with object keys sorted at every level, so equal content hashes equally. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

function fnv1a(text: string, offset: number): string {
  let hash = offset >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
