/** Pure painted-foliage cell documents and partition transforms. */
import { normalizeFoliageInstance, type LayoutFoliageData, type LayoutFoliageInstance } from "../scene/foliage";
import { compareWorldCellKeys, worldCellPath, type WorldPartitionGridSettings } from "./worldPartition";
import { parseWorldCellKey, worldCellAt, worldCellKey } from "./worldGrid";

export interface FoliageCellGroup {
  id: string;
  instances: LayoutFoliageInstance[];
}

export interface FoliageCellDocument {
  schema: 1;
  type: "foliageCell";
  key: string;
  groups: FoliageCellGroup[];
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

/** Validates cell headers and groups; malformed instances are dropped. */
export function normalizeFoliageCellDocument(value: unknown): FoliageCellDocument {
  const input = record(value, "foliageCell");
  if (input.schema !== 1) throw new Error("Invalid foliageCell.schema");
  if (input.type !== "foliageCell") throw new Error("Invalid foliageCell.type");
  if (typeof input.key !== "string" || !parseWorldCellKey(input.key)) throw new Error("Invalid foliageCell.key");
  if (!Array.isArray(input.groups)) throw new Error("foliageCell.groups must be an array");
  const seen = new Set<string>();
  const groups = input.groups.map((value): FoliageCellGroup => {
    const group = record(value, "foliageCell group");
    if (typeof group.id !== "string" || !group.id.length) throw new Error("Invalid foliageCell group id");
    if (seen.has(group.id)) throw new Error(`duplicate foliageCell group id ${group.id}`);
    seen.add(group.id);
    if (!Array.isArray(group.instances)) throw new Error("foliageCell group instances must be an array");
    const instances: LayoutFoliageInstance[] = [];
    for (const value of group.instances) {
      const instance = normalizeFoliageInstance(value);
      if (instance) instances.push(instance);
    }
    return { id: group.id, instances };
  });
  return { schema: 1, type: "foliageCell", key: input.key, groups };
}

/** Level-owned foliage sidecar path, sharing the main cell path's base. */
export function foliageCellPath(levelPath: string, key: string): string {
  return worldCellPath(levelPath, "main", key).replace(/\/main\/([^/]+)\.cell\.json$/, "/foliage/$1.foliage.json");
}

/** Splits painted instances by position, retaining every group in the index. */
export function partitionFoliageData(data: LayoutFoliageData, grid: WorldPartitionGridSettings): {
  index: LayoutFoliageData;
  cells: FoliageCellDocument[];
} {
  const byKey = new Map<string, FoliageCellDocument>();
  const groups = data.groups.map((group) => {
    const targets = new Map<string, FoliageCellGroup>();
    for (const instance of group.instances) {
      const coord = worldCellAt(grid, instance.position[0], instance.position[2]);
      const key = worldCellKey(coord.x, coord.z);
      let cell = byKey.get(key);
      if (!cell) {
        cell = { schema: 1, type: "foliageCell", key, groups: [] };
        byKey.set(key, cell);
      }
      let target = targets.get(key);
      if (!target) {
        target = { id: group.id, instances: [] };
        targets.set(key, target);
        cell.groups.push(target);
      }
      target.instances.push(structuredClone(instance));
    }
    return { id: group.id, foliageTypeId: group.foliageTypeId, target: structuredClone(group.target), instances: [] };
  });
  const cells = [...byKey.values()].sort((a, b) => compareWorldCellKeys(a.key, b.key));
  return {
    index: { schema: 1, type: "foliage", groups, landscapeRules: structuredClone(data.landscapeRules ?? []),
      foliageCells: cells.map((cell) => cell.key) },
    cells,
  };
}

/** Merges cells in key order into a detached, non-partitioned foliage document. */
export function mergeFoliageCells(index: LayoutFoliageData, cells: Iterable<FoliageCellDocument>): LayoutFoliageData {
  const groups = structuredClone(index.groups);
  const byId = new Map(groups.map((group) => [group.id, group]));
  const ordered = [...cells].sort((a, b) => compareWorldCellKeys(a.key, b.key));
  const seen = new Set<string>();
  for (const cell of ordered) {
    if (seen.has(cell.key)) throw new Error(`duplicate cell key ${cell.key}`);
    seen.add(cell.key);
    if (index.foliageCells && !index.foliageCells.includes(cell.key)) throw new Error(`cell key ${cell.key} is not in foliageCells`);
    for (const group of cell.groups) {
      const target = byId.get(group.id);
      if (!target) throw new Error(`unknown foliage group id ${group.id}`);
      target.instances.push(...structuredClone(group.instances));
    }
  }
  return { schema: 1, type: "foliage", groups, landscapeRules: structuredClone(index.landscapeRules ?? []) };
}

/** Counts painted instances across a cell's groups. */
export function countFoliageCellInstances(cell: FoliageCellDocument): number {
  return cell.groups.reduce((count, group) => count + group.instances.length, 0);
}
