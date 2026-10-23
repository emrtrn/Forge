/** Pure level/cell transforms (OPEN_WORLD_PLAN Faz 5); no IO or streaming lifecycle. */
import { resolveBlockingVolume } from "../scene/blockingVolume";
import type { LayoutModelInstances, RoomLayout, Vec3 } from "../scene/layout";
import { levelTerrainDir } from "../terrain/terrainTypes";
import { parseWorldCellKey, worldCellForActor, worldCellKey } from "./worldGrid";

export interface WorldPartitionGridSettings {
  cellSize: number;
  loadRange: number;
}

export interface WorldPartitionSettings {
  enabled: boolean;
  grids: { main: WorldPartitionGridSettings };
}

export const DEFAULT_WORLD_PARTITION: WorldPartitionSettings = {
  enabled: false,
  grids: { main: { cellSize: 128, loadRange: 384 } },
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
    if (name !== "main") throw new Error(`Unknown grid: grids.${name}`);
  }
  const main = grids.main === undefined ? {} : record(grids.main, "grids.main");
  const defaults = DEFAULT_WORLD_PARTITION.grids.main;
  return {
    enabled,
    grids: { main: {
      cellSize: positive(main.cellSize, defaults.cellSize, "grids.main.cellSize"),
      loadRange: positive(main.loadRange, defaults.loadRange, "grids.main.loadRange"),
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

function compareCellKeys(a: string, b: string): number {
  const first = parseWorldCellKey(a)!;
  const second = parseWorldCellKey(b)!;
  return first.z - second.z || first.x - second.x;
}

function spatiallyLoaded(item: object): boolean {
  return (item as { spatiallyLoaded?: unknown }).spatiallyLoaded !== false;
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
  const grid = settings.grids.main;

  function split<T extends object>(
    items: T[],
    position: (item: T) => Vec3 | undefined,
    append: (cell: WorldCellDocument, item: T) => void,
    footprint?: (item: T) => { width: number; depth: number },
    label?: (item: T) => string,
  ): T[] {
    return items.filter((item) => {
      if (!spatiallyLoaded(item)) return true;
      const pivot = position(item);
      if (!pivot) return true;
      const coord = worldCellForActor(grid, [pivot[0], pivot[2]], footprint?.(item));
      if (!coord) {
        warnings.push(`Blocking volume "${label?.(item)}" exceeds main cellSize (${grid.cellSize}); kept persistent`);
        return true;
      }
      const key = worldCellKey(coord.x, coord.z);
      let cell = cells.get(key);
      if (!cell) {
        cell = { schema: 1, type: "worldCell", grid: "main", key };
        cells.set(key, cell);
      }
      append(cell, item);
      return false;
    });
  }

  for (const group of persistent.instances) {
    if (group.assetId.startsWith("marker:playerStart") || !spatiallyLoaded(group)) continue;
    const targets = new Map<string, LayoutModelInstances>();
    group.placements = split(group.placements, (item) => item.position, (cell, item) => {
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
    persistent.actors = split(persistent.actors, (item) => item.position,
      (cell, item) => (cell.actors ??= []).push(item));
  }
  persistent.characters = split(persistent.characters, (item) => item.position,
    (cell, item) => (cell.characters ??= []).push(item));
  if (persistent.lights) {
    persistent.lights = split(persistent.lights, (item) => item.type === "directional" ? undefined : item.position,
      (cell, item) => (cell.lights ??= []).push(item));
  }
  if (persistent.reflectionCaptures) {
    persistent.reflectionCaptures = split(persistent.reflectionCaptures, (item) => item.position,
      (cell, item) => (cell.reflectionCaptures ??= []).push(item));
  }
  if (persistent.targetPoints) {
    persistent.targetPoints = split(persistent.targetPoints, (item) => item.position,
      (cell, item) => (cell.targetPoints ??= []).push(item));
  }
  if (persistent.blockingVolumes) {
    persistent.blockingVolumes = split(persistent.blockingVolumes, (item) => item.position,
      (cell, item) => (cell.blockingVolumes ??= []).push(item),
      (item) => {
        const size = resolveBlockingVolume(item).size;
        const scale = item.scale ?? 1;
        // Mirrored scales still have positive extents; rotation is outside this slice.
        return {
          width: Math.abs(size[0] * (typeof scale === "number" ? scale : scale[0])),
          depth: Math.abs(size[2] * (typeof scale === "number" ? scale : scale[2])),
        };
      }, (item) => item.name ?? item.id);
  }
  if (persistent.worldWidgets) {
    persistent.worldWidgets = split(persistent.worldWidgets, (item) => item.anchor?.worldPos,
      (cell, item) => (cell.worldWidgets ??= []).push(item));
  }
  return { persistent, cells: new Map([...cells].sort(([a], [b]) => compareCellKeys(a, b))), warnings };
}

export function mergeWorldCells(persistent: RoomLayout, cells: Iterable<WorldCellDocument>): RoomLayout {
  const merged = structuredClone(persistent);
  const ordered = [...cells].sort((a, b) => compareCellKeys(a.key, b.key));
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
