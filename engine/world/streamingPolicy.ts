/** Pure per-grid streaming decisions (OPEN_WORLD_PLAN K4); no IO or lifecycle execution. */
import {
  distanceToWorldCell,
  parseWorldCellKey,
  worldCellBounds,
  worldCellKey,
  type WorldCellBounds,
  type WorldCellCoord,
  type WorldGridDef,
} from "./worldGrid";

export interface StreamingSource {
  position: readonly [number, number];
  velocity?: readonly [number, number];
  /** Positive values raise priority, in world distance units. */
  priorityBias?: number;
}

export interface GridStreamingSettings extends WorldGridDef {
  /** Infinity covers the bounded world (e.g. the HLOD grid). */
  loadRange: number;
  /** Defaults to loadRange; clamped to it so Activated stays within Loaded. */
  activateRange?: number;
  /** Defaults to 1.25; applies to both loaded and active retention. */
  unloadHysteresisFactor?: number;
  /** QualityExtensions input; scales ranges, not cell geometry. Defaults to 1. */
  viewDistanceMultiplier?: number;
}

export interface StreamingState {
  /** Includes active cells. Only completed loads belong here. */
  loaded: ReadonlySet<string>;
  active: ReadonlySet<string>;
}

export interface StreamingTargets {
  toLoad: string[];
  /** Only previously loaded cells, ordered by priority like toLoad. */
  toActivate: string[];
  toDeactivate: string[];
  /** Execute deactivation before unloading, including when work is budgeted. */
  toUnload: string[];
}

const compareKeys = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function nonnegative(value: number, name: string): number {
  if (!(value >= 0)) throw new RangeError(`${name} must be nonnegative`);
  return value;
}

function overlapsWorld(cell: WorldCellBounds, bounds: WorldCellBounds): boolean {
  return cell.minX < bounds.maxX && cell.maxX > bounds.minX
    && cell.minZ < bounds.maxZ && cell.maxZ > bounds.minZ;
}

/** Distance to the cell box, with at most one cell's bonus in the velocity direction. */
function sourcePriority(grid: WorldGridDef, cell: WorldCellCoord, source: StreamingSource, distance: number): number {
  const bounds = worldCellBounds(grid, cell.x, cell.z);
  const dx = (bounds.minX + bounds.maxX) / 2 - source.position[0];
  const dz = (bounds.minZ + bounds.maxZ) / 2 - source.position[1];
  const [vx, vz] = source.velocity ?? [0, 0];
  const length = Math.hypot(dx, dz) * Math.hypot(vx, vz);
  const ahead = length > 0 ? Math.max(0, (dx * vx + dz * vz) / length) : 0;
  return distance - ahead * grid.cellSize - (source.priorityBias ?? 0);
}

/**
 * Sources contribute a union; the best qualifying source determines priority.
 * New requests use the nominal ranges, existing residency uses hysteresis.
 * Applying loads does not activate them in this call: report completed loads
 * in the next state. Inputs are never mutated and no pending work is stored.
 */
export function computeStreamingTargets(
  prev: StreamingState,
  sources: readonly StreamingSource[],
  settings: GridStreamingSettings,
  bounds: WorldCellBounds,
): StreamingTargets {
  const multiplier = settings.viewDistanceMultiplier ?? 1;
  const hysteresis = settings.unloadHysteresisFactor ?? 1.25;
  if (!Number.isFinite(settings.cellSize) || settings.cellSize <= 0
    || !Number.isFinite(multiplier) || multiplier < 0
    || !Number.isFinite(hysteresis) || hysteresis < 1
    || !(settings.origin ?? [0, 0]).every(Number.isFinite)) {
    throw new RangeError("Invalid streaming grid, multiplier or hysteresis");
  }
  if (![bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ].every(Number.isFinite)
    || bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) {
    throw new RangeError("Streaming bounds must have finite positive area");
  }
  for (const source of sources) {
    if (!source.position.every(Number.isFinite) || !(source.velocity ?? [0, 0]).every(Number.isFinite)
      || !Number.isFinite(source.priorityBias ?? 0)) throw new RangeError("Invalid streaming source");
  }
  const baseLoadRange = nonnegative(settings.loadRange, "loadRange");
  const baseActivateRange = Math.min(baseLoadRange, nonnegative(settings.activateRange ?? baseLoadRange, "activateRange"));
  const loadRange = multiplier === 0 ? 0 : baseLoadRange * multiplier;
  const activateRange = multiplier === 0 ? 0 : baseActivateRange * multiplier;
  const [originX, originZ] = settings.origin ?? [0, 0];
  const size = settings.cellSize;
  const firstX = Math.floor((bounds.minX - originX) / size);
  const firstZ = Math.floor((bounds.minZ - originZ) / size);
  const lastX = Math.ceil((bounds.maxX - originX) / size) - 1;
  const lastZ = Math.ceil((bounds.maxZ - originZ) / size) - 1;
  const wanted = new Map<string, number>();
  for (const source of sources) {
    const [px, pz] = source.position;
    // Closed range edges, but positive-area overlap with the bounded world.
    const minX = Math.max(firstX, Math.ceil((px - loadRange - originX) / size - 1));
    const minZ = Math.max(firstZ, Math.ceil((pz - loadRange - originZ) / size - 1));
    const maxX = Math.min(lastX, Math.floor((px + loadRange - originX) / size));
    const maxZ = Math.min(lastZ, Math.floor((pz + loadRange - originZ) / size));
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const distance = distanceToWorldCell(settings, x, z, px, pz);
        if (distance > loadRange) continue;
        const key = worldCellKey(x, z);
        const priority = sourcePriority(settings, { x, z }, source, distance);
        wanted.set(key, Math.min(wanted.get(key) ?? Infinity, priority));
      }
    }
  }
  const inRange = (key: string, range: number): boolean => {
    const cell = parseWorldCellKey(key);
    return cell !== null && overlapsWorld(worldCellBounds(settings, cell.x, cell.z), bounds)
      && sources.some((source) => distanceToWorldCell(settings, cell.x, cell.z, ...source.position) <= range);
  };
  const toLoad = [...wanted.keys()].filter((key) => !prev.loaded.has(key));
  const activationPriorities = new Map<string, number>();
  const toUnload: string[] = [];
  for (const key of prev.loaded) {
    if (!inRange(key, loadRange * hysteresis)) {
      toUnload.push(key);
      continue;
    }
    if (prev.active.has(key)) continue;
    const cell = parseWorldCellKey(key)!;
    for (const source of sources) {
      const distance = distanceToWorldCell(settings, cell.x, cell.z, ...source.position);
      if (distance <= activateRange) {
        const priority = sourcePriority(settings, cell, source, distance);
        activationPriorities.set(key, Math.min(activationPriorities.get(key) ?? Infinity, priority));
      }
    }
  }
  const toDeactivate = [...prev.active].filter((key) => !prev.loaded.has(key) || !inRange(key, activateRange * hysteresis));
  const ordered = (priorities: ReadonlyMap<string, number>) => (a: string, b: string): number =>
    priorities.get(a)! - priorities.get(b)! || compareKeys(a, b);
  return {
    toLoad: toLoad.sort(ordered(wanted)),
    toActivate: [...activationPriorities.keys()].sort(ordered(activationPriorities)),
    toDeactivate: toDeactivate.sort(compareKeys),
    toUnload: toUnload.sort(compareKeys),
  };
}

export interface StreamingWorkBudget {
  maxCount?: number;
  maxMs?: number;
  /** Constant cost estimate; defaults to 1 ms per item. No clock is read. */
  estimateMsPerItem?: number;
}

/** Take a priority-preserving prefix; never force an item over either budget. */
export function budgetStreamingWork<T>(
  candidates: readonly T[],
  budget: StreamingWorkBudget,
): { selected: T[]; deferred: T[] } {
  const maxCount = nonnegative(budget.maxCount ?? Infinity, "maxCount");
  const maxMs = nonnegative(budget.maxMs ?? Infinity, "maxMs");
  const estimate = nonnegative(budget.estimateMsPerItem ?? 1, "estimateMsPerItem");
  if (!Number.isFinite(estimate)) throw new RangeError("estimateMsPerItem must be finite");
  const count = Math.min(candidates.length, Math.floor(maxCount), estimate === 0 ? Infinity : Math.floor(maxMs / estimate));
  return { selected: candidates.slice(0, count), deferred: candidates.slice(count) };
}
