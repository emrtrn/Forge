/** Pure level/cell transforms (OPEN_WORLD_PLAN Faz 5); no IO or streaming lifecycle. */
import { resolveBlockingVolume } from "../scene/blockingVolume";
import type { LayoutModelInstances, RoomLayout, Vec3 } from "../scene/layout";
import { levelTerrainDir } from "../terrain/terrainTypes";
import { parseWorldCellKey, worldCellBounds, worldCellForActor, worldCellKey } from "./worldGrid";

export interface WorldPartitionGridSettings {
  cellSize: number;
  loadRange: number;
}

export interface WorldPartitionSettings {
  enabled: boolean;
  grids: { main: WorldPartitionGridSettings; foliage: WorldPartitionGridSettings };
}

export const DEFAULT_WORLD_PARTITION: WorldPartitionSettings = {
  enabled: false,
  grids: { main: { cellSize: 128, loadRange: 384 }, foliage: { cellSize: 64, loadRange: 256 } },
};

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function positive(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be finite and positive`);
  }
  return value;
}

export function normalizeWorldPartitionSettings(value: unknown): WorldPartitionSettings {
  const input = value === undefined ? {} : record(value, "worldPartition");
  const enabled = input.enabled === undefined ? DEFAULT_WORLD_PARTITION.enabled : input.enabled;
  if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
  const grids = input.grids === undefined ? {} : record(input.grids, "grids");
  for (const name of Object.keys(grids)) {
    if (name !== "main" && name !== "foliage") throw new Error(`Unknown grid: grids.${name}`);
  }
  const main = grids.main === undefined ? {} : record(grids.main, "grids.main");
  const foliage = grids.foliage === undefined ? {} : record(grids.foliage, "grids.foliage");
  const defaults = DEFAULT_WORLD_PARTITION.grids.main;
  const foliageDefaults = DEFAULT_WORLD_PARTITION.grids.foliage;
  return {
    enabled,
    grids: { main: {
      cellSize: positive(main.cellSize, defaults.cellSize, "grids.main.cellSize"),
      loadRange: positive(main.loadRange, defaults.loadRange, "grids.main.loadRange"),
    }, foliage: {
      cellSize: positive(foliage.cellSize, foliageDefaults.cellSize, "grids.foliage.cellSize"),
      loadRange: positive(foliage.loadRange, foliageDefaults.loadRange, "grids.foliage.loadRange"),
    } },
  };
}

const CELL_ARRAYS = [
  "instances", "actors", "characters", "lights", "reflectionCaptures",
  "targetPoints", "blockingVolumes", "worldWidgets",
] as const;

type WorldCellArrays = Partial<Pick<RoomLayout, typeof CELL_ARRAYS[number]>>;

export interface WorldCellDocument extends WorldCellArrays {
  schema: 1;
  type: "worldCell";
  grid: "main";
  key: string;
}

/** Elements stay opaque here; later IO slices apply the existing save validators. */
export function normalizeWorldCellDocument(value: unknown): WorldCellDocument {
  const input = record(value, "worldCell");
  if (input.schema !== 1) throw new Error("Invalid worldCell.schema");
  if (input.type !== "worldCell") throw new Error("Invalid worldCell.type");
  if (input.grid !== "main") throw new Error("Invalid worldCell.grid");
  if (typeof input.key !== "string" || !parseWorldCellKey(input.key)) throw new Error("Invalid worldCell.key");
  const arrays: Record<string, unknown[]> = {};
  for (const field of CELL_ARRAYS) {
    if (!(field in input)) continue;
    const items = input[field];
    if (!Array.isArray(items)) throw new Error(`worldCell.${field} must be an array`);
    if (items.length) arrays[field] = structuredClone(items);
  }
  // The array containers are validated; their element types are deliberately unchecked.
  return { schema: 1, type: "worldCell", grid: "main", key: input.key, ...arrays } as WorldCellDocument;
}

export function worldCellPath(levelPath: string, grid: "main", key: string): string {
  if (grid !== "main") throw new Error("Invalid worldCell.grid");
  if (!parseWorldCellKey(key)) throw new Error("Invalid worldCell.key");
  // Reuse the level sidecar naming rule, including separators and legacy suffixes.
  const terrainDir = levelTerrainDir(levelPath);
  return `${terrainDir.slice(0, -".landscapes".length)}.cells/${grid}/${key}.cell.json`;
}

export function compareWorldCellKeys(a: string, b: string): number {
  const first = parseWorldCellKey(a)!;
  const second = parseWorldCellKey(b)!;
  return first.z - second.z || first.x - second.x;
}

function spatiallyLoaded(item: { spatiallyLoaded?: boolean } | LayoutModelInstances): boolean {
  return !("spatiallyLoaded" in item) || item.spatiallyLoaded !== false;
}

function positionCellKey(
  item: { spatiallyLoaded?: boolean },
  position: Vec3 | undefined,
  grid: WorldPartitionGridSettings,
  footprint?: { width: number; depth: number },
): string | null {
  if (!spatiallyLoaded(item) || !position) return null;
  const coord = worldCellForActor(grid, [position[0], position[2]], footprint);
  return coord ? worldCellKey(coord.x, coord.z) : null;
}

function streamedInstanceGroup(group: LayoutModelInstances): boolean {
  return !group.assetId.startsWith("marker:playerStart") && spatiallyLoaded(group);
}

/** Shared per-kind routing for saved documents and merged-layout indices. */
function partitionRoutes(grid: WorldPartitionGridSettings, warnings?: string[]) {
  return {
    instances: (item: LayoutModelInstances["placements"][number]) => positionCellKey(item, item.position, grid),
    actors: (item: NonNullable<RoomLayout["actors"]>[number]) => positionCellKey(item, item.position, grid),
    characters: (item: RoomLayout["characters"][number]) => positionCellKey(item, item.position, grid),
    lights: (item: NonNullable<RoomLayout["lights"]>[number]) =>
      positionCellKey(item, item.type === "directional" ? undefined : item.position, grid),
    reflectionCaptures: (item: NonNullable<RoomLayout["reflectionCaptures"]>[number]) =>
      positionCellKey(item, item.position, grid),
    targetPoints: (item: NonNullable<RoomLayout["targetPoints"]>[number]) => positionCellKey(item, item.position, grid),
    blockingVolumes: (item: NonNullable<RoomLayout["blockingVolumes"]>[number]) => {
      if (!spatiallyLoaded(item) || !item.position) return null;
      const size = resolveBlockingVolume(item).size;
      const scale = item.scale ?? 1;
      // Mirrored scales still have positive extents; rotation is outside this slice.
      const key = positionCellKey(item, item.position, grid, {
        width: Math.abs(size[0] * (typeof scale === "number" ? scale : scale[0])),
        depth: Math.abs(size[2] * (typeof scale === "number" ? scale : scale[2])),
      });
      if (key === null) {
        warnings?.push(`Blocking volume "${item.name ?? item.id}" exceeds main cellSize (${grid.cellSize}); kept persistent`);
      }
      return key;
    },
    worldWidgets: (item: NonNullable<RoomLayout["worldWidgets"]>[number]) =>
      positionCellKey(item, item.anchor?.worldPos, grid),
  };
}

export interface WorldCellContents {
  /** Indices into the merged layout, ascending. */
  actors: number[];
  /** `group` indexes `layout.instances`; `placement` indexes that group's `placements`. Ascending by (group, placement). */
  instances: { group: number; placement: number }[];
  characters: number[];
  lights: number[];
  reflectionCaptures: number[];
  targetPoints: number[];
  blockingVolumes: number[];
  worldWidgets: number[];
}

/**
 * Same routing as partitionLayout, as indices into the merged layout. Persistent
 * elements are absent; disabled settings return an empty map. Never mutates layout.
 * Only occupied cells appear, sorted by compareWorldCellKeys, with all eight arrays.
 */
export function worldPartitionCellContents(layout: RoomLayout, settings: WorldPartitionSettings): Map<string, WorldCellContents> {
  const cells = new Map<string, WorldCellContents>();
  if (!settings.enabled) return cells;
  const routes = partitionRoutes(settings.grids.main);
  function cellForKey(key: string): WorldCellContents {
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        actors: [], instances: [], characters: [], lights: [], reflectionCaptures: [],
        targetPoints: [], blockingVolumes: [], worldWidgets: [],
      };
      cells.set(key, cell);
    }
    return cell;
  }
  layout.instances.forEach((group, groupIndex) => {
    if (!streamedInstanceGroup(group)) return;
    group.placements.forEach((item, placement) => {
      const key = routes.instances(item);
      if (key !== null) cellForKey(key).instances.push({ group: groupIndex, placement });
    });
  });
  function collect<T>(
    field: Exclude<typeof CELL_ARRAYS[number], "instances">,
    items: T[] | undefined,
    route: (item: T) => string | null,
  ): void {
    items?.forEach((item, index) => {
      const key = route(item);
      if (key !== null) cellForKey(key)[field].push(index);
    });
  }
  collect("actors", layout.actors, routes.actors);
  collect("characters", layout.characters, routes.characters);
  collect("lights", layout.lights, routes.lights);
  collect("reflectionCaptures", layout.reflectionCaptures, routes.reflectionCaptures);
  collect("targetPoints", layout.targetPoints, routes.targetPoints);
  collect("blockingVolumes", layout.blockingVolumes, routes.blockingVolumes);
  collect("worldWidgets", layout.worldWidgets, routes.worldWidgets);
  return new Map([...cells].sort(([a], [b]) => compareWorldCellKeys(a, b)));
}

export type StreamedLightKind = "point" | "spot" | "pointShadow" | "spotShadow";

/**
 * Independent per-kind upper bounds over occupied-cell box neighbourhoods within
 * loadRange * hysteresis. Only lights in contents count; persistent and directional
 * lights are not pooled. Each source cell includes itself and cells touching its box.
 */
export function streamedLightPeaks(
  layout: RoomLayout,
  contents: ReadonlyMap<string, WorldCellContents>,
  grid: WorldPartitionGridSettings,
  hysteresis = 1.25,
): Record<StreamedLightKind, number> {
  const peaks: Record<StreamedLightKind, number> = { point: 0, spot: 0, pointShadow: 0, spotShadow: 0 };
  const kinds = Object.keys(peaks) as StreamedLightKind[];
  const cells = [...contents].map(([key, content]) => {
    const coord = parseWorldCellKey(key)!;
    const counts: Record<StreamedLightKind, number> = { point: 0, spot: 0, pointShadow: 0, spotShadow: 0 };
    for (const index of content.lights) {
      const light = layout.lights![index]!;
      if (light.type === "directional") continue;
      const kind: StreamedLightKind = light.castShadow === true ? `${light.type}Shadow` : light.type;
      counts[kind] += 1;
    }
    return { bounds: worldCellBounds(grid, coord.x, coord.z), counts };
  });
  const reach = grid.loadRange * hysteresis;
  for (const source of cells) {
    const totals: Record<StreamedLightKind, number> = { point: 0, spot: 0, pointShadow: 0, spotShadow: 0 };
    for (const target of cells) {
      const dx = Math.max(source.bounds.minX - target.bounds.maxX, target.bounds.minX - source.bounds.maxX, 0);
      const dz = Math.max(source.bounds.minZ - target.bounds.maxZ, target.bounds.minZ - source.bounds.maxZ, 0);
      if (Math.hypot(dx, dz) > reach) continue;
      for (const kind of kinds) totals[kind] += target.counts[kind];
    }
    for (const kind of kinds) peaks[kind] = Math.max(peaks[kind], totals[kind]);
  }
  return peaks;
}

/**
 * Maps streamed actors' input-array indices to their main-grid cell keys.
 * Persistent actors are absent. Pass the merged level to preserve the runtime's
 * `actor:<index>` identities; this helper never reorders or mutates the layout.
 */
export function worldPartitionActorCells(layout: RoomLayout, settings: WorldPartitionSettings): Map<number, string> {
  const cells = new Map<number, string>();
  if (!settings.enabled) return cells;
  const routes = partitionRoutes(settings.grids.main);
  layout.actors?.forEach((actor, index) => {
    const key = routes.actors(actor);
    if (key !== null) cells.set(index, key);
  });
  return cells;
}

export function partitionLayout(layout: RoomLayout, settings: WorldPartitionSettings): {
  persistent: RoomLayout;
  cells: Map<string, WorldCellDocument>;
  warnings: string[];
} {
  // Moving items out of this owned copy also keeps nested data detached from the input.
  const persistent = structuredClone(layout);
  const cells = new Map<string, WorldCellDocument>();
  const warnings: string[] = [];
  if (!settings.enabled) return { persistent, cells, warnings };
  const routes = partitionRoutes(settings.grids.main, warnings);

  function cellForKey(key: string): WorldCellDocument {
    let cell = cells.get(key);
    if (!cell) {
      cell = { schema: 1, type: "worldCell", grid: "main", key };
      cells.set(key, cell);
    }
    return cell;
  }

  function split<T>(
    items: T[],
    route: (item: T) => string | null,
    append: (cell: WorldCellDocument, item: T) => void,
  ): T[] {
    return items.filter((item) => {
      const key = route(item);
      if (key === null) return true;
      append(cellForKey(key), item);
      return false;
    });
  }

  for (const group of persistent.instances) {
    if (!streamedInstanceGroup(group)) continue;
    const targets = new Map<string, LayoutModelInstances>();
    group.placements = split(group.placements, routes.instances, (cell, item) => {
      let target = targets.get(cell.key);
      if (!target) {
        target = { assetId: group.assetId, placements: [] };
        targets.set(cell.key, target);
        (cell.instances ??= []).push(target);
      }
      target.placements.push(item);
    });
  }
  if (persistent.actors) {
    persistent.actors = persistent.actors.filter((actor) => {
      const key = routes.actors(actor);
      if (key === null) return true;
      (cellForKey(key).actors ??= []).push(actor);
      return false;
    });
  }
  persistent.characters = split(persistent.characters, routes.characters,
    (cell, item) => (cell.characters ??= []).push(item));
  if (persistent.lights) {
    persistent.lights = split(persistent.lights, routes.lights,
      (cell, item) => (cell.lights ??= []).push(item));
  }
  if (persistent.reflectionCaptures) {
    persistent.reflectionCaptures = split(persistent.reflectionCaptures, routes.reflectionCaptures,
      (cell, item) => (cell.reflectionCaptures ??= []).push(item));
  }
  if (persistent.targetPoints) {
    persistent.targetPoints = split(persistent.targetPoints, routes.targetPoints,
      (cell, item) => (cell.targetPoints ??= []).push(item));
  }
  if (persistent.blockingVolumes) {
    persistent.blockingVolumes = split(persistent.blockingVolumes, routes.blockingVolumes,
      (cell, item) => (cell.blockingVolumes ??= []).push(item));
  }
  if (persistent.worldWidgets) {
    persistent.worldWidgets = split(persistent.worldWidgets, routes.worldWidgets,
      (cell, item) => (cell.worldWidgets ??= []).push(item));
  }
  return { persistent, cells: new Map([...cells].sort(([a], [b]) => compareWorldCellKeys(a, b))), warnings };
}

export function mergeWorldCells(persistent: RoomLayout, cells: Iterable<WorldCellDocument>): RoomLayout {
  const merged = structuredClone(persistent);
  const ordered = [...cells].sort((a, b) => compareWorldCellKeys(a.key, b.key));
  for (const source of ordered) {
    const cell = structuredClone(source);
    for (const group of cell.instances ?? []) {
      const target = merged.instances.find((entry) => entry.assetId === group.assetId);
      if (target) target.placements.push(...group.placements);
      else merged.instances.push(group);
    }
    if (cell.actors?.length) (merged.actors ??= []).push(...cell.actors);
    if (cell.characters?.length) merged.characters.push(...cell.characters);
    if (cell.lights?.length) (merged.lights ??= []).push(...cell.lights);
    if (cell.reflectionCaptures?.length) (merged.reflectionCaptures ??= []).push(...cell.reflectionCaptures);
    if (cell.targetPoints?.length) (merged.targetPoints ??= []).push(...cell.targetPoints);
    if (cell.blockingVolumes?.length) (merged.blockingVolumes ??= []).push(...cell.blockingVolumes);
    if (cell.worldWidgets?.length) (merged.worldWidgets ??= []).push(...cell.worldWidgets);
  }
  return merged;
}

/** Elements in the arrays a cell can own; instance groups count their placements. */
export function countWorldCellElements(arrays: WorldCellArrays): number {
  let count = 0;
  for (const field of CELL_ARRAYS) {
    const items = arrays[field];
    if (!items) continue;
    count += field === "instances"
      ? (items as LayoutModelInstances[]).reduce((sum, group) => sum + group.placements.length, 0)
      : items.length;
  }
  return count;
}
