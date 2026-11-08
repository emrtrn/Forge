/**
 * `npm run world:random` (docs/world-builder/RANDOM_WORLD_PLAN.md): a few
 * choices become a world brief (`engine/worldbuilder/randomWorld.ts`), written
 * beside the level as `<Level>.worldbrief.json`, and the `world:brief` runner
 * builds the level from it. A large world is split into World Partition cells.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DEFAULT_WORLD_PARTITION } from "../../engine/world/worldPartition";
import { randomWorldBrief, type RandomWorldOptions } from "../../engine/worldbuilder/randomWorld";
import { normalizeWorldBrief, worldBriefPath } from "../../engine/worldbuilder/worldBrief";
import type { WorldBuildStep } from "./worldBriefBuild";
import { runWorldBrief, type WorldBriefRunResult } from "./worldBriefRun";

export interface RandomWorldRunOptions {
  /** Absolute public root. */
  root: string;
  /** Public-root-relative `.level.json`. */
  out: string;
  world: Omit<RandomWorldOptions, "id" | "name"> & { name?: string };
  force?: boolean;
  onProgress?: (step: WorldBuildStep) => void;
}

export interface RandomWorldRunResult extends WorldBriefRunResult {
  brief: string;
  notes: string[];
}

export async function runRandomWorld(options: RandomWorldRunOptions): Promise<RandomWorldRunResult> {
  const level = options.out.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!/\.level\.json$/i.test(level)) throw new Error(`--out must be a .level.json path: ${level}`);
  const base = level.split("/").pop()!.replace(/\.level\.json$/i, "");
  const id = base.replace(/[^A-Za-z0-9_-]/g, "_") || "random_world";
  const { brief, notes } = randomWorldBrief({ ...options.world, id, name: options.world.name ?? base });
  const { issues } = normalizeWorldBrief(structuredClone(brief));
  if (issues.length) throw new Error(`random world brief is invalid:\n  ${issues.join("\n  ")}`);
  const briefPath = worldBriefPath(level);
  const absolute = resolve(options.root, briefPath);
  const existing = await readFile(absolute).then(() => true, () => false);
  if (existing && !options.force) throw new Error(`${briefPath} exists; rerun with --force to replace it and its level.`);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(brief, null, 2)}\n`);
  const partition = options.world.size === "large" ? { ...structuredClone(DEFAULT_WORLD_PARTITION), enabled: true } : undefined;
  // The size decides partitioning, also for a level this replaces.
  const result = await runWorldBrief({
    root: options.root, brief: briefPath, out: level, force: options.force, partition, replacePartition: true, onProgress: options.onProgress,
  });
  return { ...result, brief: briefPath, notes };
}
