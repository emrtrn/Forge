/** Filesystem adapter and shared formatting for offline world-data reports. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { formatByteSize } from "../engine/perf/perfBudget";
import { foliageDataPath } from "../engine/scene/foliage";
import {
  checkWorldData,
  isLevelDocument,
  isSidecarJsonPath,
  type WorldDataLevelReport,
  type WorldDataReport,
  type WorldDataSource,
} from "./worldDataCheck";

interface WorldDataScan extends WorldDataReport {
  readonly scanned: number;
  /** Existing referenced cell files, counted once across all levels. */
  readonly cellFiles: readonly { readonly path: string; readonly bytes: number }[];
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Discovers levels under a public/dist root and checks their world-data references. */
export function scanWorldData(root: string): WorldDataScan {
  if (!statSync(root).isDirectory()) throw new Error(`not a directory: ${root}`);
  const levelPaths: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && path.endsWith(".json") && !isSidecarJsonPath(path)) {
        try {
          if (isLevelDocument(JSON.parse(readFileSync(resolve(root, path), "utf8")))) levelPaths.push(path);
        } catch {
          // Non-level JSON and unreadable candidates do not establish a level reference.
        }
      }
    }
  };
  walk("");
  const measured = new Map<string, number>();
  const source: WorldDataSource = {
    size(path) {
      try {
        const file = statSync(resolve(root, path));
        if (!file.isFile()) return null;
        measured.set(path, file.size);
        return file.size;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    readJson(path) {
      try {
        return JSON.parse(readFileSync(resolve(root, path), "utf8")) as unknown;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
  };
  const report = checkWorldData(levelPaths, source);
  const indices = new Set(levelPaths.map(foliageDataPath));
  const cellFiles = [...measured].filter(([path]) =>
    path.endsWith(".cell.json") || (path.endsWith(".foliage.json") && !indices.has(path)),
  ).map(([path, bytes]) => ({ path, bytes }));
  cellFiles.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { ...report, scanned: levelPaths.length, cellFiles };
}

/** One compact line per level, shared by the CLI and advisory asset report. */
export function formatWorldDataLevel(report: WorldDataLevelReport): string {
  const base = `${report.level}: cells ${report.cells.count} (${formatByteSize(report.cells.bytes)}), ` +
    `foliage cells ${report.foliageCells.count} (${formatByteSize(report.foliageCells.bytes)}), ` +
    `hlod ${report.hlod.count} (${formatByteSize(report.hlod.bytes)})`;
  return base + report.terrains.map((terrain) =>
    `, terrain ${terrain.definition} tiles ${terrain.tiles.count} (${formatByteSize(terrain.tiles.bytes)}) ` +
    `global ${terrain.globalBytes === null ? "none" : formatByteSize(terrain.globalBytes)}`,
  ).join("");
}
