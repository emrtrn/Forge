import {
  exponentialFogDensityFor,
  FAR_VIEW_MODE_THRESHOLD,
  VIEW_DISTANCE_MAX,
  VIEW_DISTANCE_MIN,
} from "./viewDistance";
import { normalizeWorldPartitionSettings, type WorldPartitionSettings } from "./worldPartition";

/**
 * New Open World setup (OPEN_WORLD_PLAN Faz 8): the level-wide settings the New
 * Landscape dialog offers next to a multi-tile grid, applied with the new
 * terrain as one undo step. Pure: the dialog validates and previews through
 * these, the editor turns the result into world settings and a Height Fog.
 */
export interface OpenWorldSetup {
  partition: { enabled: boolean; cellSize: number; loadRange: number };
  /** Play camera far plane; null leaves it unset (each camera's own Far Clip). */
  viewDistance: number | null;
  /** Fit (or add) the level's Height Fog so terrain fades out at the view distance. */
  fitFog: boolean;
}

/** The setup the dialog opens with: the level's current values, nothing new switched on. */
export function openWorldSetupFromLevel(
  partition: unknown,
  viewDistance: number | undefined,
): OpenWorldSetup {
  const current = normalizeWorldPartitionSettings(partition);
  return {
    partition: { enabled: current.enabled, ...current.grids.main },
    viewDistance: viewDistance ?? null,
    fitFog: false,
  };
}

/**
 * A view distance that sees across the whole world: its longest side, rounded
 * up to 100 m, within the authored limits.
 */
export function suggestedViewDistance(extent: readonly [number, number]): number {
  const longest = Math.max(extent[0], extent[1]);
  return Math.max(VIEW_DISTANCE_MIN, Math.min(VIEW_DISTANCE_MAX, Math.ceil(longest / 100) * 100));
}

/** Problems that block creation, as short sentences for the dialog; empty when valid. */
export function openWorldSetupProblems(setup: OpenWorldSetup): string[] {
  const problems: string[] = [];
  if (setup.partition.enabled) {
    if (!(Number.isFinite(setup.partition.cellSize) && setup.partition.cellSize > 0)) problems.push("Cell size must be a positive number of metres.");
    if (!(Number.isFinite(setup.partition.loadRange) && setup.partition.loadRange > 0)) problems.push("Loading range must be a positive number of metres.");
  }
  if (setup.viewDistance !== null
    && !(Number.isFinite(setup.viewDistance) && setup.viewDistance >= VIEW_DISTANCE_MIN && setup.viewDistance <= VIEW_DISTANCE_MAX)) {
    problems.push(`View distance must be between ${VIEW_DISTANCE_MIN} and ${VIEW_DISTANCE_MAX} m, or empty.`);
  }
  if (setup.fitFog && setup.viewDistance === null) problems.push("Set a view distance to fit the fog to.");
  return problems;
}

/**
 * The level's partition settings after the setup. A disabled setup over a level
 * that never had partition settings stays absent; the foliage grid is kept.
 */
export function openWorldPartitionSettings(setup: OpenWorldSetup, current: unknown): WorldPartitionSettings | undefined {
  if (!setup.partition.enabled && current === undefined) return undefined;
  const base = normalizeWorldPartitionSettings(current);
  return normalizeWorldPartitionSettings({
    ...base,
    enabled: setup.partition.enabled,
    grids: setup.partition.enabled
      ? { ...base.grids, main: { cellSize: setup.partition.cellSize, loadRange: setup.partition.loadRange } }
      : base.grids,
  });
}

/** The Height Fog fields "Fit to View Distance" writes: exponential, 98% opaque at the far plane. */
export function openWorldFogPatch(viewDistance: number): { mode: "exp"; density: number } {
  return { mode: "exp", density: Number(exponentialFogDensityFor(viewDistance).toFixed(6)) };
}

/** Informational lines for the dialog (not problems). */
export function openWorldSetupNotes(setup: OpenWorldSetup, extent: readonly [number, number]): string[] {
  const notes: string[] = [];
  const longest = Math.max(extent[0], extent[1]);
  if (setup.partition.enabled && Number.isFinite(setup.partition.cellSize) && setup.partition.cellSize > 0) {
    const cells = Math.ceil(extent[0] / setup.partition.cellSize) * Math.ceil(extent[1] / setup.partition.cellSize);
    notes.push(`About ${cells} actor cell${cells === 1 ? "" : "s"} over the terrain.`);
  }
  if (setup.viewDistance !== null && setup.viewDistance > FAR_VIEW_MODE_THRESHOLD) {
    notes.push(`Beyond ${FAR_VIEW_MODE_THRESHOLD} m Play runs in far view mode (reversed depth, sun shadow follows the camera).`);
    if (!setup.fitFog) notes.push("Without a fitted Height Fog the terrain ends in a hard edge at the view distance.");
  }
  if (setup.viewDistance !== null && setup.viewDistance < longest) {
    notes.push(`The world is ${Math.round(longest)} m across: terrain farther than the view distance is not drawn.`);
  }
  return notes;
}
