import { normalizeWindSwaySettings, type WindSwaySettings } from "../environment/wind";
import { TERRAIN_MASK_RANGES, type TerrainMaskBands } from "../terrain/terrainMask";
import { parseWorldCellKey } from "../world/worldGrid";
import type { Vec3 } from "./layout";

/**
 * Render-agnostic Foliage model: the Foliage Type asset shape (`*.foliage.json`),
 * the per-layout instance sidecar shape (`<layout>.foliage.json`), their defaults,
 * and shared normalizers. Kept free of three.js so the editor core, the runtime
 * loader, and the save validator can all read foliage data without pulling in the
 * renderer (mirrors `engine/scene/landscape.ts`).
 *
 * Foliage is the web/three counterpart to Unreal's Foliage Mode: dense static-mesh
 * instances painted onto Landscape or Static Mesh surfaces. Instances are NOT
 * written into `layout.instances[].placements[]` — they live in a separate sidecar
 * and render as `InstancedMesh` batches keyed by foliage type.
 *
 * Faz 1 supports manual Static Mesh foliage paint (paint/erase/single/select/
 * remove) onto Static Mesh + Landscape targets. Later phases (grid chunking,
 * cull fade, landscape-grass scatter, procedural spawner, actor foliage) extend
 * these shapes without needing a migration.
 */

// --- Foliage Type asset (`*.foliage.json`) ----------------------------------

/**
 * A normalized Foliage Type: mesh + placement rules shared by every instance
 * painted with it. Serialized 1:1 to a `*.foliage.json` asset; `normalizeFoliageType`
 * fills every field so the resolved form is complete (height limits stay optional
 * — absent means "no limit").
 */
export interface ForgeFoliageTypeDef {
  schema: 1;
  type: "foliageType";
  name: string;
  /** Static mesh asset id instanced for every painted instance of this type. */
  meshAssetId: string;
  /** Minimum world-space spacing between two instances of this type (paint radius test). */
  radius: number;
  /** Relative paint density multiplier (`0..1+`); scales samples per brush dab. */
  density: number;
  /** Uniform random scale range applied to each instance (`scaleMin..scaleMax`). */
  scaleMin: Vec3;
  scaleMax: Vec3;
  /** Randomize yaw (Y rotation) per instance. */
  randomYaw: boolean;
  /** Orient the instance's up axis to the hit-surface normal. */
  alignToNormal: boolean;
  /** Random vertical offset range applied after placement (world units). */
  zOffsetMin: number;
  zOffsetMax: number;
  /** Slope acceptance window in degrees (`0` = flat, `90` = vertical wall). */
  slopeMin: number;
  slopeMax: number;
  /** World-Y placement window; absent means unbounded on that side. */
  heightMin?: number;
  heightMax?: number;
  castShadow: boolean;
  receiveShadow: boolean;
  /** Runtime collision. Default false — grass/flowers/pebbles must not collide. */
  collision: boolean;
  /** Distance cull window (`0` = disabled). Shader fade is a later phase. */
  cullStart: number;
  cullEnd: number;
  /** Wind sway (Faz 6). Absent: the type never sways. */
  sway?: WindSwaySettings;
  /**
   * Far billboards for Landscape rule foliage: past `cullEnd` the same plants
   * are drawn as camera-facing impostors out to this distance (m, × the quality
   * cull scale). Absent or not past `cullEnd`: off. Painted foliage ignores it.
   */
  farDistance?: number;
  /**
   * 0..1: how much the terrain under this type's rule foliage darkens toward
   * the plants' colour with distance, past `cullEnd` (forests read as dark
   * patches on far hills). Absent or 0: off.
   */
  farTint?: number;
}

/** Clamp ranges of the far billboard / tint fields; the editor's sliders read them. */
export const FOLIAGE_FAR_RANGES = {
  farDistance: { min: 0, max: 20000 },
  farTint: { min: 0, max: 1 },
} as const;

export const FOLIAGE_TYPE_DEFAULTS: Omit<ForgeFoliageTypeDef, "name" | "meshAssetId"> = {
  schema: 1,
  type: "foliageType",
  radius: 0.5,
  density: 1,
  scaleMin: [1, 1, 1],
  scaleMax: [1, 1, 1],
  randomYaw: true,
  alignToNormal: true,
  zOffsetMin: 0,
  zOffsetMax: 0,
  slopeMin: 0,
  slopeMax: 90,
  castShadow: true,
  receiveShadow: true,
  collision: false,
  cullStart: 0,
  cullEnd: 0,
};

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampMin(value: number, min: number): number {
  return value < min ? min : value;
}

function clampRange(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readVec3(value: unknown, fallback: Vec3): Vec3 {
  if (Array.isArray(value) && value.length === 3) {
    return [
      finiteNumber(value[0], fallback[0]),
      finiteNumber(value[1], fallback[1]),
      finiteNumber(value[2], fallback[2]),
    ];
  }
  return [...fallback];
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Fills a raw `*.foliage.json` body (or partial patch) into a complete
 * {@link ForgeFoliageTypeDef}. The single source of field shape for the loader
 * (`assetFoliageLoader`), the editor view-model, and the save validator.
 */
export function normalizeFoliageType(raw: unknown): ForgeFoliageTypeDef {
  const source = (raw ?? {}) as Partial<ForgeFoliageTypeDef> & Record<string, unknown>;
  const d = FOLIAGE_TYPE_DEFAULTS;
  // Foliage only supports uniform scaling: keep the Vec3 file shape for
  // backwards compatibility, but canonicalize its X component across all axes.
  // This also makes legacy non-uniform definitions safe on their next save.
  const scaleMinValue = clampMin(readVec3(source.scaleMin, d.scaleMin)[0], 0.001);
  // Keep scaleMax >= scaleMin so range sampling never inverts.
  const scaleMaxValue = Math.max(scaleMinValue, clampMin(readVec3(source.scaleMax, d.scaleMax)[0], 0.001));
  const scaleMin: Vec3 = [scaleMinValue, scaleMinValue, scaleMinValue];
  const orderedMax: Vec3 = [scaleMaxValue, scaleMaxValue, scaleMaxValue];
  const slopeMin = clampRange(finiteNumber(source.slopeMin, d.slopeMin), 0, 90);
  const slopeMax = clampRange(finiteNumber(source.slopeMax, d.slopeMax), 0, 90);
  const zOffsetMin = finiteNumber(source.zOffsetMin, d.zOffsetMin);
  const zOffsetMax = finiteNumber(source.zOffsetMax, d.zOffsetMax);
  const heightMin = readOptionalNumber(source.heightMin);
  const heightMax = readOptionalNumber(source.heightMax);
  const cullStart = clampMin(finiteNumber(source.cullStart, d.cullStart), 0);
  const cullEnd = clampMin(finiteNumber(source.cullEnd, d.cullEnd), 0);
  const sway = normalizeWindSwaySettings(source.sway);
  const farDistance = clampRange(finiteNumber(source.farDistance, 0), FOLIAGE_FAR_RANGES.farDistance.min, FOLIAGE_FAR_RANGES.farDistance.max);
  const farTint = clampRange(finiteNumber(source.farTint, 0), FOLIAGE_FAR_RANGES.farTint.min, FOLIAGE_FAR_RANGES.farTint.max);
  return {
    schema: 1,
    type: "foliageType",
    name: readString(source.name, "Foliage Type"),
    meshAssetId: readString(source.meshAssetId, ""),
    radius: clampMin(finiteNumber(source.radius, d.radius), 0.001),
    density: clampMin(finiteNumber(source.density, d.density), 0),
    scaleMin,
    scaleMax: orderedMax,
    randomYaw: readBool(source.randomYaw, d.randomYaw),
    alignToNormal: readBool(source.alignToNormal, d.alignToNormal),
    zOffsetMin: Math.min(zOffsetMin, zOffsetMax),
    zOffsetMax: Math.max(zOffsetMin, zOffsetMax),
    slopeMin: Math.min(slopeMin, slopeMax),
    slopeMax: Math.max(slopeMin, slopeMax),
    ...(heightMin !== undefined ? { heightMin } : {}),
    ...(heightMax !== undefined ? { heightMax } : {}),
    castShadow: readBool(source.castShadow, d.castShadow),
    receiveShadow: readBool(source.receiveShadow, d.receiveShadow),
    collision: readBool(source.collision, d.collision),
    cullStart,
    cullEnd,
    ...(sway ? { sway } : {}),
    ...(farDistance > 0 ? { farDistance } : {}),
    ...(farTint > 0 ? { farTint } : {}),
  };
}

/** True when a type draws far billboards: a far distance past its cull distance. */
export function foliageTypeHasFarBillboards(type: ForgeFoliageTypeDef): boolean {
  return type.cullEnd > 0 && (type.farDistance ?? 0) > type.cullEnd;
}

/** A blank Foliage Type asset body for `name` + `meshAssetId` (Content Browser "new"). */
export function createFoliageType(name: string, meshAssetId: string): ForgeFoliageTypeDef {
  return normalizeFoliageType({ name, meshAssetId });
}

// --- Level foliage sidecar (`<layout>.foliage.json`) ------------------------

export type FoliageTargetKind = "landscape" | "staticMesh";

export interface LayoutFoliageTarget {
  kind: FoliageTargetKind;
  /** Landscape id, or static-mesh placement/asset key the instance was painted onto. */
  id: string;
}

/** Resolve painted targets by actor identity, independent of their terrain backing data. */
export function resolveFoliageTarget(
  pick: { landscapeIndex: number | null; staticMeshAssetId: string | null },
  landscapes: readonly { id: string }[],
  filters: { landscape: boolean; staticMesh: boolean },
): LayoutFoliageTarget | null {
  if (pick.landscapeIndex !== null) {
    const actor = landscapes[pick.landscapeIndex];
    return filters.landscape && actor ? { kind: "landscape", id: actor.id } : null;
  }
  return filters.staticMesh && pick.staticMeshAssetId
    ? { kind: "staticMesh", id: pick.staticMeshAssetId }
    : null;
}

/** One painted foliage instance (transform is fully resolved, not type-relative). */
export interface LayoutFoliageInstance {
  position: Vec3;
  /** Euler degrees (XYZ order). */
  rotation: Vec3;
  scale: Vec3;
  /** Hit-surface normal at paint time; kept for reattach/snap (Faz 2). */
  normal?: Vec3;
  /** Deterministic per-instance seed (procedural reproducibility, Faz 4). */
  seed?: number;
}

/** A run of instances sharing a foliage type + target, batched into one InstancedMesh. */
export interface LayoutFoliageGroup {
  id: string;
  /** Asset id of the owning `*.foliage.json` Foliage Type. */
  foliageTypeId: string;
  target: LayoutFoliageTarget;
  instances: LayoutFoliageInstance[];
}

/** A persisted rule that generates foliage from one Landscape paint layer. */
export interface LandscapeFoliageRule {
  id: string;
  landscapeId: string;
  layerId: string;
  foliageTypeId: string;
  /** Candidate instances per square world unit; zero disables the rule. */
  density: number;
  /** Minimum bilinearly sampled Landscape layer weight required to spawn. */
  minWeight: number;
  /** Stable seed; generated instances are rebuilt from this instead of saved. */
  seed: number;
  /**
   * Placement bands over the ground's world height (m) and slope (degrees),
   * with the same meaning as Auto Paint's (`engine/terrain/terrainMask.ts`):
   * full density inside, thinning to nothing over the falloff outside, noise
   * breaking the coverage into patches. All optional; an absent field is open
   * (height), the full range (slope) or off (falloff, noise). The Foliage
   * Type's own slope/height limits still apply on top as hard limits.
   */
  heightMin?: number;
  heightMax?: number;
  heightFalloff?: number;
  slopeMin?: number;
  slopeMax?: number;
  slopeFalloff?: number;
  noiseAmount?: number;
  noiseScale?: number;
  /** Scale factor where the bands fade out (0..1; 1 or absent = no change), e.g. stunted trees at the tree line. */
  edgeScale?: number;
}

/** Values an absent {@link LandscapeFoliageRule} band field stands for. */
export const LANDSCAPE_FOLIAGE_RULE_BAND_DEFAULTS = {
  heightFalloff: 0, slopeMin: 0, slopeMax: 90, slopeFalloff: 0, noiseAmount: 0, noiseScale: 20, edgeScale: 1,
} as const;

/** Clamp ranges of the rule's band fields; the editor's sliders read them too. */
export const LANDSCAPE_FOLIAGE_RULE_RANGES = {
  ...TERRAIN_MASK_RANGES,
  edgeScale: { min: 0, max: 1 },
} as const;

/** The rule's bands with every default filled in (open heights are `±Infinity`). */
export function landscapeFoliageRuleBands(rule: LandscapeFoliageRule): TerrainMaskBands & { edgeScale: number } {
  const d = LANDSCAPE_FOLIAGE_RULE_BAND_DEFAULTS;
  return {
    heightMin: rule.heightMin ?? -Infinity,
    heightMax: rule.heightMax ?? Infinity,
    heightFalloff: rule.heightFalloff ?? d.heightFalloff,
    slopeMin: rule.slopeMin ?? d.slopeMin,
    slopeMax: rule.slopeMax ?? d.slopeMax,
    slopeFalloff: rule.slopeFalloff ?? d.slopeFalloff,
    noiseAmount: rule.noiseAmount ?? d.noiseAmount,
    noiseScale: rule.noiseScale ?? d.noiseScale,
    edgeScale: rule.edgeScale ?? d.edgeScale,
  };
}

/** True when the rule narrows nothing: every candidate keeps full density and scale. */
export function landscapeFoliageRuleIsUnbanded(rule: LandscapeFoliageRule): boolean {
  const d = LANDSCAPE_FOLIAGE_RULE_BAND_DEFAULTS;
  return rule.heightMin === undefined && rule.heightMax === undefined
    && (rule.slopeMin ?? d.slopeMin) <= 0 && (rule.slopeMax ?? d.slopeMax) >= 90
    && !((rule.noiseAmount ?? 0) > 0);
}

export interface LayoutFoliageData {
  schema: 1;
  type: "foliage";
  /** Hand-painted foliage only. Generated foliage is rebuilt from `landscapeRules`. */
  groups: LayoutFoliageGroup[];
  /** Faz 3 Landscape layer → foliage mappings. Omitted by legacy sidecars. */
  landscapeRules?: LandscapeFoliageRule[];
  /** Partitioned level (World Partition on): keys of `<Level>.cells/foliage/<x_z>.foliage.json` files holding the instances. */
  foliageCells?: string[];
}

export const FOLIAGE_TARGET_KINDS: readonly FoliageTargetKind[] = ["landscape", "staticMesh"];

export function createEmptyFoliageData(): LayoutFoliageData {
  return { schema: 1, type: "foliage", groups: [], landscapeRules: [] };
}

/** Normalizes a painted transform, dropping instances without a valid position array. */
export function normalizeFoliageInstance(raw: unknown): LayoutFoliageInstance | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<LayoutFoliageInstance>;
  if (!Array.isArray(source.position) || source.position.length !== 3) return null;
  const instance: LayoutFoliageInstance = {
    position: readVec3(source.position, [0, 0, 0]),
    rotation: readVec3(source.rotation, [0, 0, 0]),
    scale: readVec3(source.scale, [1, 1, 1]),
  };
  if (Array.isArray(source.normal) && source.normal.length === 3) {
    instance.normal = readVec3(source.normal, [0, 1, 0]);
  }
  const seed = readOptionalNumber(source.seed);
  if (seed !== undefined) instance.seed = seed;
  return instance;
}

function normalizeFoliageTarget(raw: unknown): LayoutFoliageTarget {
  const source = (raw ?? {}) as Partial<LayoutFoliageTarget>;
  const kind: FoliageTargetKind = FOLIAGE_TARGET_KINDS.includes(source.kind as FoliageTargetKind)
    ? (source.kind as FoliageTargetKind)
    : "staticMesh";
  return { kind, id: readString(source.id, "") };
}

/**
 * Normalizes one Landscape foliage rule (loader, save validator and editor
 * edits). `existing` holds the rules already accepted, for a unique id. Band
 * fields are clamped and written only when they differ from their default,
 * so a rule without bands saves exactly as before they existed.
 */
export function normalizeLandscapeFoliageRule(raw: unknown, existing: readonly LandscapeFoliageRule[]): LandscapeFoliageRule | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<LandscapeFoliageRule>;
  const landscapeId = readString(source.landscapeId, "");
  const layerId = readString(source.layerId, "");
  const foliageTypeId = readString(source.foliageTypeId, "");
  if (!landscapeId || !layerId || !foliageTypeId) return null;
  let id = readString(source.id, "");
  if (!id || existing.some((rule) => rule.id === id)) id = uniqueLandscapeFoliageRuleId(existing);
  return {
    id,
    landscapeId,
    layerId,
    foliageTypeId,
    density: clampRange(finiteNumber(source.density, 0.25), 0, 10),
    minWeight: clampRange(finiteNumber(source.minWeight, 0.5), 0, 1),
    seed: Math.floor(clampRange(finiteNumber(source.seed, 1), 0, 0xffffffff)) >>> 0,
    ...normalizeLandscapeFoliageRuleBands(source),
  };
}

function normalizeLandscapeFoliageRuleBands(source: Partial<LandscapeFoliageRule>): Partial<LandscapeFoliageRule> {
  const r = LANDSCAPE_FOLIAGE_RULE_RANGES;
  const d = LANDSCAPE_FOLIAGE_RULE_BAND_DEFAULTS;
  const bands: Partial<LandscapeFoliageRule> = {};
  const set = (key: keyof typeof d | "heightMin" | "heightMax", range: { min: number; max: number }, fallback?: number): void => {
    const value = readOptionalNumber(source[key]);
    if (value === undefined) return;
    const clamped = clampRange(value, range.min, range.max);
    if (clamped !== fallback) bands[key] = clamped;
  };
  set("heightMin", r.height);
  set("heightMax", r.height);
  set("heightFalloff", r.heightFalloff, d.heightFalloff);
  set("slopeMin", r.slope, d.slopeMin);
  set("slopeMax", r.slope, d.slopeMax);
  set("slopeFalloff", r.slopeFalloff, d.slopeFalloff);
  set("noiseAmount", r.noiseAmount, d.noiseAmount);
  set("noiseScale", r.noiseScale, d.noiseScale);
  set("edgeScale", r.edgeScale, d.edgeScale);
  return bands;
}

/**
 * Fills a raw `<layout>.foliage.json` body into a complete {@link LayoutFoliageData}.
 * Groups with no valid instances survive (so a freshly-created group persists);
 * malformed instances are dropped. Shared by the loader and the save validator.
 */
export function normalizeFoliageData(raw: unknown): LayoutFoliageData {
  const source = (raw ?? {}) as Partial<LayoutFoliageData>;
  const groups = Array.isArray(source.groups) ? source.groups : [];
  const seenIds = new Set<string>();
  const normalizedGroups: LayoutFoliageGroup[] = [];
  for (const rawGroup of groups) {
    if (!rawGroup || typeof rawGroup !== "object") continue;
    const group = rawGroup as Partial<LayoutFoliageGroup>;
    const foliageTypeId = readString(group.foliageTypeId, "");
    if (!foliageTypeId) continue;
    let id = readString(group.id, "");
    if (!id || seenIds.has(id)) id = uniqueFoliageGroupId(normalizedGroups);
    seenIds.add(id);
    const instances: LayoutFoliageInstance[] = [];
    const rawInstances = Array.isArray(group.instances) ? group.instances : [];
    for (const rawInstance of rawInstances) {
      const instance = normalizeFoliageInstance(rawInstance);
      if (instance) instances.push(instance);
    }
    normalizedGroups.push({
      id,
      foliageTypeId,
      target: normalizeFoliageTarget(group.target),
      instances,
    });
  }
  const rawRules = Array.isArray(source.landscapeRules) ? source.landscapeRules : [];
  const landscapeRules: LandscapeFoliageRule[] = [];
  for (const rawRule of rawRules) {
    const rule = normalizeLandscapeFoliageRule(rawRule, landscapeRules);
    if (rule) landscapeRules.push(rule);
  }
  const foliageCells = Array.isArray(source.foliageCells)
    ? [...new Set(source.foliageCells.filter((key) => typeof key === "string" && parseWorldCellKey(key)))].sort((a, b) => {
      const first = parseWorldCellKey(a)!;
      const second = parseWorldCellKey(b)!;
      return first.z - second.z || first.x - second.x;
    })
    : undefined;
  return { schema: 1, type: "foliage", groups: normalizedGroups, landscapeRules,
    ...(foliageCells !== undefined ? { foliageCells } : {}) };
}

/** A stable, collision-free id for a new foliage group (`foliage-group-<n>`). */
export function uniqueFoliageGroupId(groups: readonly LayoutFoliageGroup[]): string {
  const existing = new Set(groups.map((group) => group.id));
  let index = 1;
  while (existing.has(`foliage-group-${index}`)) index += 1;
  return `foliage-group-${index}`;
}

/** A stable, collision-free id for a Landscape layer foliage rule. */
export function uniqueLandscapeFoliageRuleId(rules: readonly LandscapeFoliageRule[]): string {
  const existing = new Set(rules.map((rule) => rule.id));
  let index = 1;
  while (existing.has(`landscape-foliage-rule-${index}`)) index += 1;
  return `landscape-foliage-rule-${index}`;
}

/**
 * Public-root-relative sidecar path for a layout's foliage data, a sibling of the
 * scene file: `layouts/foo.json` → `layouts/foo.foliage.json`,
 * `.../Land.level.json` → `.../Land.foliage.json`.
 */
export function foliageDataPath(scenePath: string): string {
  const normalized = scenePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const base = normalized.replace(/(\.level|\.layout)?\.json$/i, "");
  return `${base}.foliage.json`;
}

// --- Render chunking (Faz 2: per-chunk frustum + distance culling) ----------

/** Default world-XZ size of a foliage render chunk, in world units. */
export const FOLIAGE_CHUNK_SIZE = 16;

/** One world-XZ grid cell of a group's instances (indices into `group.instances`). */
export interface FoliageChunkBucket {
  chunkX: number;
  chunkZ: number;
  /** Indices into the owning group's `instances` array that fall in this cell. */
  indices: number[];
}

/**
 * Partitions a group's instances into world-XZ grid buckets of `chunkSize`, so the
 * renderer can build one InstancedMesh batch per bucket — giving each chunk its own
 * (tight) bounding sphere for frustum culling plus a center for distance culling.
 * Pure + testable: buckets come back in a stable order (chunkZ then chunkX), each
 * carrying its original instance indices so picking can map a chunk-local hit back
 * to the group index.
 */
export function chunkFoliageInstances(
  instances: readonly LayoutFoliageInstance[],
  chunkSize: number,
): FoliageChunkBucket[] {
  const size = chunkSize > 0 ? chunkSize : FOLIAGE_CHUNK_SIZE;
  const buckets = new Map<string, FoliageChunkBucket>();
  instances.forEach((instance, index) => {
    const chunkX = Math.floor(instance.position[0] / size);
    const chunkZ = Math.floor(instance.position[2] / size);
    const key = `${chunkX},${chunkZ}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { chunkX, chunkZ, indices: [] };
      buckets.set(key, bucket);
    }
    bucket.indices.push(index);
  });
  return [...buckets.values()].sort((a, b) => a.chunkZ - b.chunkZ || a.chunkX - b.chunkX);
}

// --- Resource usage report (Faz 2 panel readout) ----------------------------

/** Live render cost of one foliage group's batch (supplied by the render layer). */
export interface FoliageGroupRenderStat {
  /** Triangles drawn for a SINGLE instance (summed over the mesh's sub-batches). */
  trianglesPerInstance: number;
  /** InstancedMesh draw calls this group contributes. */
  drawCalls: number;
}

/** Aggregated foliage cost for one Foliage Type (all its groups combined). */
export interface FoliageTypeUsage {
  typeId: string;
  name: string;
  instances: number;
  triangles: number;
  drawCalls: number;
}

/** Whole-level foliage resource report shown in the Foliage panel. */
export interface FoliageResourceUsage {
  totalInstances: number;
  totalTriangles: number;
  totalDrawCalls: number;
  /** Per-type breakdown, heaviest (most instances) first. */
  types: FoliageTypeUsage[];
}

/**
 * Aggregates a level's foliage into a per-type resource report. Pure and
 * three-agnostic: the caller supplies the type display name and each group's live
 * render stat (triangles-per-instance + draw calls from the InstancedMesh batches),
 * so this stays unit-testable without a renderer. Groups with no live batch (mesh
 * not loaded) still count their instances but contribute zero triangles/draw calls.
 */
export function computeFoliageResourceUsage(
  data: LayoutFoliageData,
  typeName: (typeId: string) => string,
  groupStat: (groupId: string) => FoliageGroupRenderStat | null,
): FoliageResourceUsage {
  const byType = new Map<string, FoliageTypeUsage>();
  let totalInstances = 0;
  let totalTriangles = 0;
  let totalDrawCalls = 0;
  for (const group of data.groups) {
    const instances = group.instances.length;
    const stat = groupStat(group.id);
    const triangles = stat ? instances * stat.trianglesPerInstance : 0;
    const drawCalls = stat ? stat.drawCalls : 0;
    totalInstances += instances;
    totalTriangles += triangles;
    totalDrawCalls += drawCalls;
    let entry = byType.get(group.foliageTypeId);
    if (!entry) {
      entry = {
        typeId: group.foliageTypeId,
        name: typeName(group.foliageTypeId),
        instances: 0,
        triangles: 0,
        drawCalls: 0,
      };
      byType.set(group.foliageTypeId, entry);
    }
    entry.instances += instances;
    entry.triangles += triangles;
    entry.drawCalls += drawCalls;
  }
  const types = [...byType.values()].sort(
    (a, b) => b.instances - a.instances || a.name.localeCompare(b.name),
  );
  return { totalInstances, totalTriangles, totalDrawCalls, types };
}
