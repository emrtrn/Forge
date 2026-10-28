/**
 * Stage Runner core (World Builder plan v0.4 §2.1, §3.2, §6.2, §10 #4).
 *
 * A stage is a pure, deterministic function from the recipe (+ level, region
 * profile, terrain heights) to the objects it wants to exist. `planStage` turns
 * that wish into a change set against the level — the dry run — and never
 * touches anything a stage does not own:
 *
 * - Objects not in `recipe.ownership` are manual: a wanted id that collides with
 *   one is blocked, never overwritten.
 * - An owned object whose content no longer matches the `outputHash` it was
 *   written with was edited by hand; with `preserveManualOverrides` it is kept.
 *   An owned object missing from the level was deleted by hand and is not
 *   brought back.
 * - Nothing is created, moved or removed inside a protected region.
 *
 * Running the same stage on its own output yields an empty plan (idempotent).
 * The plan carries whole before/after placement arrays per touched asset group,
 * so the editor applies and undoes it as one history step with one rebuild per
 * group. Dependency-free; no three.js.
 */
import type { LayoutPlacement, RoomLayout } from "../scene/layout";
import { findDuplicatePlacementId, isPlacementId, isSemanticRole } from "../scene/placementIdentity";
import type { WorldPoint } from "./normalize";
import { normalizeWorldRecipe, type OwnershipEntry, type WorldRecipe } from "./recipe";
import type { RegionProfile } from "./regionProfile";

export interface StageInput {
  readonly recipe: WorldRecipe;
  readonly layout: RoomLayout;
  /** The recipe's region profile, when it has one and it loaded. */
  readonly profile: RegionProfile | null;
  /** Terrain height at world XZ, or null where there is no terrain. */
  readonly sampleHeight: (x: number, z: number) => number | null;
}

/** One placement a stage wants; `placement.id` is its stable identity. */
export interface GeneratedPlacement {
  assetId: string;
  placement: LayoutPlacement & { id: string };
}

export interface StageOutput {
  placements: GeneratedPlacement[];
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

export type BlockedReason = "manual" | "otherStage" | "protected";
export type KeptReason = "editedByHand" | "deletedByHand" | "protected";

/** A touched asset group, whole. `null` means the group is absent on that side. */
export interface PlacementGroupChange {
  assetId: string;
  /** Index of the group in `layout.instances` before the change, for undo. */
  beforeIndex: number | null;
  before: LayoutPlacement[] | null;
  after: LayoutPlacement[] | null;
}

export interface StagePlan {
  stageId: string;
  stageLabel: string;
  version: number;
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
  /** XZ box around every added, moved and removed placement. */
  bounds: { min: WorldPoint; max: WorldPoint } | null;
  groupChanges: PlacementGroupChange[];
  recipeBefore: WorldRecipe;
  recipeAfter: WorldRecipe;
  /** Neither the level nor the recipe changes. */
  empty: boolean;
}

interface Located {
  assetId: string;
  placement: LayoutPlacement;
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
    recipeBefore,
    recipeAfter: structuredClone(recipeBefore),
    empty: true,
  };
  if (!isSemanticRole(stage.id)) plan.errors.push(`stage id "${stage.id}" must be a token`);
  if (!Number.isInteger(stage.version) || stage.version < 1) plan.errors.push(`stage ${stage.id} version must be a positive integer`);
  if (plan.errors.length > 0) return plan;

  const output = stage.run(input);
  plan.warnings.push(...output.warnings);
  const wanted = collectWanted(output, plan);
  const located = locatePlacements(input.layout);
  const ownership = input.recipe.ownership;
  const preserve = input.recipe.generation.preserveManualOverrides;
  const groups = new WorkingGroups(input.layout);
  const nextOwned: Record<string, OwnershipEntry> = structuredClone(ownership.placements);
  const touchedPoints: WorldPoint[] = [];
  const isProtected = (placement: LayoutPlacement) =>
    ownership.protectedRegions.some((region) => insideRegion(placement.position, region.min, region.max));

  const owned = Object.keys(ownership.placements)
    .filter((id) => ownership.placements[id]!.stage === stage.id)
    .sort();
  for (const id of owned) {
    const entry = ownership.placements[id]!;
    const current = located.get(id);
    const want = wanted.get(id);
    if (!current) {
      if (!want) {
        delete nextOwned[id];
      } else if (preserve) {
        plan.kept.push({ id, reason: "deletedByHand" });
      } else if (isProtected(want.placement)) {
        plan.kept.push({ id, reason: "protected" });
      } else {
        groups.append(want);
        nextOwned[id] = ownedEntry(stage.id, want);
        plan.added.push(id);
        touchedPoints.push(xz(want.placement));
      }
      continue;
    }
    if (preserve && entry.outputHash !== undefined && entry.outputHash !== placementHash(current)) {
      plan.kept.push({ id, reason: "editedByHand" });
      continue;
    }
    if (isProtected(current.placement) || (want && isProtected(want.placement))) {
      plan.kept.push({ id, reason: "protected" });
      continue;
    }
    if (!want) {
      groups.remove(current.assetId, id);
      delete nextOwned[id];
      plan.removed.push(id);
      touchedPoints.push(xz(current.placement));
      continue;
    }
    nextOwned[id] = ownedEntry(stage.id, want);
    if (placementHash(current) === placementHash(want)) {
      plan.unchanged += 1;
      continue;
    }
    groups.replace(current.assetId, id, want);
    plan.updated.push(id);
    touchedPoints.push(xz(current.placement), xz(want.placement));
  }

  for (const [id, want] of wanted) {
    const entry = ownership.placements[id];
    if (entry?.stage === stage.id) continue;
    if (entry) {
      plan.blocked.push({ id, reason: "otherStage" });
    } else if (located.has(id)) {
      plan.blocked.push({ id, reason: "manual" });
    } else if (isProtected(want.placement)) {
      plan.blocked.push({ id, reason: "protected" });
    } else {
      groups.append(want);
      nextOwned[id] = ownedEntry(stage.id, want);
      plan.added.push(id);
      touchedPoints.push(xz(want.placement));
    }
  }

  plan.groupChanges = groups.changes();
  plan.bounds = boundsOf(touchedPoints);
  plan.recipeAfter = nextRecipe(input.recipe, stage, nextOwned, output.generated);
  validatePlan(plan, input.layout);
  plan.empty = plan.groupChanges.length === 0 &&
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
  const text = canonicalJson({ assetId: entry.assetId, placement: entry.placement });
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01000193);
}

// ─── Internals ──────────────────────────────────────────────────────────────

function collectWanted(output: StageOutput, plan: StagePlan): Map<string, GeneratedPlacement> {
  const wanted = new Map<string, GeneratedPlacement>();
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

/** Copy-on-write view of the touched asset groups. */
class WorkingGroups {
  private readonly groups = new Map<string, { beforeIndex: number | null; before: LayoutPlacement[] | null; after: LayoutPlacement[] }>();

  constructor(private readonly layout: RoomLayout) {}

  append(entry: GeneratedPlacement): void {
    this.group(entry.assetId).push(structuredClone(entry.placement));
  }

  remove(assetId: string, id: string): void {
    const placements = this.group(assetId);
    const index = placements.findIndex((placement) => placement.id === id);
    if (index >= 0) placements.splice(index, 1);
  }

  /** Same asset: in place, keeping its order. New asset: moved to that group's end. */
  replace(assetId: string, id: string, next: GeneratedPlacement): void {
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

function ownedEntry(stage: string, want: GeneratedPlacement): OwnershipEntry {
  return { stage, outputHash: placementHash(want) };
}

function nextRecipe(
  recipe: WorldRecipe,
  stage: WorldStage,
  owned: Record<string, OwnershipEntry>,
  generated: StageOutput["generated"],
): WorldRecipe {
  const next = structuredClone(recipe);
  next.ownership.placements = Object.fromEntries(Object.keys(owned).sort().map((id) => [id, owned[id]!]));
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

/** The plan's result must still be a valid level and a valid, clean recipe. */
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
  const { issues } = normalizeWorldRecipe(plan.recipeAfter);
  plan.errors.push(...issues.map((issue) => `recipe after the stage: ${issue}`));
}

function insideRegion(position: readonly number[], min: WorldPoint, max: WorldPoint): boolean {
  const x = position[0] ?? 0;
  const z = position[2] ?? 0;
  return x >= min[0] && x <= max[0] && z >= min[1] && z <= max[1];
}

function xz(placement: LayoutPlacement): WorldPoint {
  return [placement.position[0] ?? 0, placement.position[2] ?? 0];
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
