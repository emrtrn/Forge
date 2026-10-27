import type { RoomLayout } from "@engine/scene/layout";
import { distanceToWorldCell, parseWorldCellKey } from "@engine/world/worldGrid";
import { worldPartitionCellContents, type WorldPartitionSettings } from "@engine/world/worldPartition";
import { selectionId } from "./selection";

/**
 * Outliner World Partition filter (OPEN_WORLD_PLAN Faz 8). The editor keeps
 * every actor loaded, so "loaded" here means what Play would load with the
 * pawn standing at the editor camera: persistent elements plus the cells
 * within the `main` grid's load range.
 */
export const OUTLINER_PARTITION_FILTERS = [
  { filter: "all", label: "All actors" },
  { filter: "loaded", label: "Loaded around the camera" },
  { filter: "unloaded", label: "In unloaded cells" },
  { filter: "persistent", label: "Persistent only" },
] as const;

export type OutlinerPartitionFilter = (typeof OUTLINER_PARTITION_FILTERS)[number]["filter"];

export interface OutlinerPartitionView {
  /** Scene object id → its `main` cell key; an absent id is persistent. */
  cells: ReadonlyMap<string, string>;
  /** Occupied cells within the load range of the editor camera. */
  loadedCells: ReadonlySet<string>;
}

export type OutlinerPartitionState = "persistent" | "loaded" | "unloaded";

/**
 * Scene object id (`selectionId`) → `main` cell key for every streamed
 * element, with the save's own routing. Persistent elements and every kind
 * the partition never streams are absent; a disabled partition is empty.
 */
export function worldPartitionObjectCells(layout: RoomLayout, settings: WorldPartitionSettings): Map<string, string> {
  const cells = new Map<string, string>();
  // Instance ids name an asset, and the editor resolves them to its first group.
  const firstGroup = new Map<string, number>();
  layout.instances.forEach(({ assetId }, group) => { if (!firstGroup.has(assetId)) firstGroup.set(assetId, group); });
  for (const [key, contents] of worldPartitionCellContents(layout, settings)) {
    for (const { group, placement } of contents.instances) {
      const assetId = layout.instances[group]!.assetId;
      if (firstGroup.get(assetId) !== group) continue;
      cells.set(selectionId({ kind: "instance", assetId, placementIndex: placement }), key);
    }
    for (const index of contents.actors) cells.set(selectionId({ kind: "actor", index }), key);
    for (const index of contents.characters) cells.set(selectionId({ kind: "character", index }), key);
    for (const index of contents.lights) cells.set(selectionId({ kind: "light", index }), key);
    for (const index of contents.reflectionCaptures) cells.set(selectionId({ kind: "reflectionCapture", index }), key);
    for (const index of contents.targetPoints) cells.set(selectionId({ kind: "targetPoint", index }), key);
    for (const index of contents.blockingVolumes) cells.set(selectionId({ kind: "blockingVolume", index }), key);
    for (const index of contents.worldWidgets) cells.set(selectionId({ kind: "worldWidget", index }), key);
  }
  return cells;
}

/**
 * The cells among `cellKeys` a streaming source at world (`x`, `z`) loads:
 * nearest point within the `main` load range, the runtime's own rule
 * (`computeStreamingTargets`, without its unload hysteresis).
 */
export function worldPartitionCellsInRange(
  settings: WorldPartitionSettings,
  cellKeys: Iterable<string>,
  x: number,
  z: number,
): Set<string> {
  const grid = settings.grids.main;
  const loaded = new Set<string>();
  for (const key of cellKeys) {
    const cell = parseWorldCellKey(key);
    if (cell && distanceToWorldCell(grid, cell.x, cell.z, x, z) <= grid.loadRange) loaded.add(key);
  }
  return loaded;
}

export function outlinerPartitionState(view: OutlinerPartitionView, id: string): OutlinerPartitionState {
  const cell = view.cells.get(id);
  if (cell === undefined) return "persistent";
  return view.loadedCells.has(cell) ? "loaded" : "unloaded";
}

/** "Loaded" includes persistent elements, which are always loaded. */
export function matchesOutlinerPartitionFilter(
  view: OutlinerPartitionView,
  id: string,
  filter: OutlinerPartitionFilter,
): boolean {
  if (filter === "all") return true;
  const state = outlinerPartitionState(view, id);
  if (filter === "loaded") return state !== "unloaded";
  return state === filter;
}
