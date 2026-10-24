/** Pure world-data reference checks; file access belongs to the caller. */
import { foliageDataPath } from "../engine/scene/foliage";
import {
  isWorldTerrainPath,
  terrainGlobalMapPath,
  terrainTilePath,
} from "../engine/terrain/terrainTypes";
import { foliageCellPath } from "../engine/world/foliageCells";
import { hlodCellPath, hlodIndexPath, normalizeHlodIndex } from "../engine/world/hlod";
import { worldCellPath } from "../engine/world/worldPartition";

/** Read-only view of a file tree; paths are root-relative with forward slashes (no leading "/"). */
export interface WorldDataSource {
  /** File size in bytes, or null when the file does not exist. */
  size(path: string): number | null;
  /** Parsed JSON, or null when missing; throws on unparsable JSON. */
  readJson(path: string): unknown | null;
}

export type WorldDataSeverity = "fail" | "warn";

export interface WorldDataIssue {
  readonly severity: WorldDataSeverity;
  /** The level the reference came from. */
  readonly level: string;
  /** The missing / broken file. */
  readonly path: string;
  readonly reason: string;
}

export interface WorldDataFileStats {
  readonly count: number;
  readonly bytes: number;
  /** Largest file (path + bytes), null when count is 0. */
  readonly largest: { readonly path: string; readonly bytes: number } | null;
}

export interface WorldTerrainStats {
  readonly definition: string;
  readonly tiles: WorldDataFileStats;
  /** Global map bytes, or null when absent. */
  readonly globalBytes: number | null;
}

export interface WorldDataLevelReport {
  readonly level: string;
  readonly cells: WorldDataFileStats;
  readonly foliageCells: WorldDataFileStats;
  /** HLOD proxies listed by `<Level>.hlod.json` (Faz 7f). */
  readonly hlod: WorldDataFileStats;
  readonly terrains: readonly WorldTerrainStats[];
}

export interface WorldDataReport {
  /** Only levels that reference any world data (cells, foliage cells or a World Terrain). */
  readonly levels: readonly WorldDataLevelReport[];
  readonly issues: readonly WorldDataIssue[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

/** True for a level document (a RoomLayout): an object with `instances` and `loadGroups` arrays. */
export function isLevelDocument(json: unknown): boolean {
  const value = record(json);
  return value !== null && Array.isArray(value.instances) && Array.isArray(value.loadGroups);
}

/** True for JSON paths that can never be a level (sidecars and manifests). */
export function isSidecarJsonPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name === "manifest.json" || name === "project.3dgame.json" || [
    ".cell.json", ".foliage.json", ".terrain.json", ".effect.json", ".vehicle.json",
    ".skeleton.json", ".foliagetype.json", ".landscape.json",
  ].some((suffix) => name.endsWith(suffix));
}

function emptyStats(): WorldDataFileStats {
  return { count: 0, bytes: 0, largest: null };
}

function addFile(stats: WorldDataFileStats, path: string, bytes: number): WorldDataFileStats {
  const largest = stats.largest;
  return {
    count: stats.count + 1,
    bytes: stats.bytes + bytes,
    largest: largest === null || bytes > largest.bytes || (bytes === largest.bytes && path < largest.path)
      ? { path, bytes }
      : largest,
  };
}

function comparePath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Checks every level's world-data references against `source`. */
export function checkWorldData(levelPaths: readonly string[], source: WorldDataSource): WorldDataReport {
  const levels: WorldDataLevelReport[] = [];
  const issues: WorldDataIssue[] = [];
  for (const level of levelPaths) {
    const issue = (path: string, reason: string, severity: WorldDataSeverity = "fail"): void => {
      issues.push({ severity, level, path, reason });
    };
    const readJson = (path: string): unknown | null => {
      try {
        return source.readJson(path);
      } catch (error) {
        issue(path, `unreadable JSON: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    };
    const derive = (path: string, reason: string, helper: () => string): string | null => {
      try {
        return helper();
      } catch {
        issue(path, reason);
        return null;
      }
    };
    const size = (path: string, missingReason?: string): number | null => {
      try {
        const bytes = source.size(path);
        if (bytes === null && missingReason) issue(path, missingReason);
        return bytes;
      } catch (error) {
        issue(path, `unreadable file: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    };

    const beforeRead = issues.length;
    const json = readJson(level);
    if (json === null) {
      if (issues.length === beforeRead) issue(level, "missing level file");
      continue;
    }
    const layout = record(json);
    if (!layout || !isLevelDocument(json)) {
      issue(level, "invalid level document");
      continue;
    }

    const cellKeys = strings(layout.worldCells);
    let cells = emptyStats();
    for (const key of cellKeys) {
      const path = derive(key, "invalid world cell key", () => worldCellPath(level, "main", key));
      if (path === null) continue;
      const bytes = size(path, "missing world cell file");
      if (bytes !== null) cells = addFile(cells, path, bytes);
    }

    let foliageKeys: string[] = [];
    let foliageCells = emptyStats();
    const indexPath = derive(level, "invalid foliage index path", () => foliageDataPath(level));
    if (indexPath !== null && size(indexPath) !== null) {
      foliageKeys = strings(record(readJson(indexPath))?.foliageCells);
      for (const key of foliageKeys) {
        const path = derive(key, "invalid foliage cell key", () => foliageCellPath(level, key));
        if (path === null) continue;
        const bytes = size(path, "missing foliage cell file");
        if (bytes !== null) foliageCells = addFile(foliageCells, path, bytes);
      }
    }

    let hlod = emptyStats();
    const hlodPath = derive(level, "invalid HLOD index path", () => hlodIndexPath(level));
    if (hlodPath !== null && size(hlodPath) !== null) {
      let entries: readonly { key: string }[] = [];
      try {
        const raw = readJson(hlodPath);
        if (raw !== null) entries = normalizeHlodIndex(raw).cells;
      } catch (error) {
        issue(hlodPath, `invalid HLOD index: ${error instanceof Error ? error.message : String(error)}`);
      }
      for (const { key } of entries) {
        const path = derive(key, "invalid HLOD cell key", () => hlodCellPath(level, key));
        if (path === null) continue;
        const bytes = size(path, "missing HLOD proxy");
        if (bytes !== null) hlod = addFile(hlod, path, bytes);
      }
    }

    const terrains: WorldTerrainStats[] = [];
    for (const entry of Array.isArray(layout.landscapes) ? layout.landscapes : []) {
      const dataRef = record(entry)?.dataRef;
      if (typeof dataRef !== "string") continue;
      const exists = size(dataRef, "missing terrain data") !== null;
      if (!isWorldTerrainPath(dataRef)) continue;
      let tiles = emptyStats();
      let globalBytes: number | null = null;
      if (exists) {
        const beforeDefinition = issues.length;
        const definition = record(readJson(dataRef));
        if (!definition && issues.length === beforeDefinition) issue(dataRef, "invalid terrain definition");
        if (definition) {
          for (const tile of Array.isArray(definition.tiles) ? definition.tiles : []) {
            const key = record(tile)?.key;
            if (typeof key !== "string") {
              issue(dataRef, "invalid terrain tile key");
              continue;
            }
            const path = derive(key, "invalid terrain tile key", () => terrainTilePath(dataRef, key));
            if (path === null) continue;
            const bytes = size(path, "missing terrain tile");
            if (bytes !== null) tiles = addFile(tiles, path, bytes);
          }
          const globalPath = derive(dataRef, "invalid terrain global map path", () => terrainGlobalMapPath(dataRef));
          if (globalPath !== null) {
            globalBytes = size(globalPath);
            if (globalBytes === null && typeof definition.tilesX === "number" &&
              typeof definition.tilesZ === "number" && definition.tilesX * definition.tilesZ > 1) {
              issue(globalPath, "missing terrain global map (computed from tiles at load)", "warn");
            }
          }
        }
      }
      terrains.push({ definition: dataRef, tiles, globalBytes });
    }
    if (cellKeys.length > 0 || foliageKeys.length > 0 || hlod.count > 0 || terrains.length > 0) {
      terrains.sort((a, b) => comparePath(a.definition, b.definition));
      levels.push({ level, cells, foliageCells, hlod, terrains });
    }
  }
  levels.sort((a, b) => comparePath(a.level, b.level));
  issues.sort((a, b) => comparePath(a.level, b.level) || comparePath(a.path, b.path));
  return { levels, issues };
}
