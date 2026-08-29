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
}

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
  };
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
}

export interface LayoutFoliageData {
  schema: 1;
  type: "foliage";
  /** Hand-painted foliage only. Generated foliage is rebuilt from `landscapeRules`. */
  groups: LayoutFoliageGroup[];
  /** Faz 3 Landscape layer → foliage mappings. Omitted by legacy sidecars. */
  landscapeRules?: LandscapeFoliageRule[];
}

export const FOLIAGE_TARGET_KINDS: readonly FoliageTargetKind[] = ["landscape", "staticMesh"];

export function createEmptyFoliageData(): LayoutFoliageData {
  return { schema: 1, type: "foliage", groups: [], landscapeRules: [] };
}

function normalizeFoliageInstance(raw: unknown): LayoutFoliageInstance | null {
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

function normalizeLandscapeFoliageRule(raw: unknown, existing: readonly LandscapeFoliageRule[]): LandscapeFoliageRule | null {
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
  };
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
  return { schema: 1, type: "foliage", groups: normalizedGroups, landscapeRules };
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
