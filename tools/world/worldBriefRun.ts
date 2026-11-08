/**
 * File side of `npm run world:brief` (`build-world-brief.mjs` parses the
 * arguments and calls `runWorldBrief`). Reads the brief, its region profile, the
 * asset manifest and the level it replaces from a public root; writes what
 * `buildWorldFromBrief` returns in the editor's save order: cells, then the
 * level, then stale cells removed, so a failure never leaves the level naming a
 * missing cell. A new level is registered in the manifest as `assetType: "level"`.
 */
import { mkdir, readdir, readFile, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { normalizeRegionProfile } from "../../engine/worldbuilder/regionProfile";
import { normalizeGroundCover } from "../../engine/worldbuilder/groundCover";
import { normalizeWorldBrief, worldBriefLevelPath } from "../../engine/worldbuilder/worldBrief";
import { buildImportedAssetRecord } from "../saveValidator";
import { buildWorldFromBrief, levelCellDirs, type WorldBriefBuild } from "./worldBriefBuild";

export interface WorldBriefRunOptions {
  /** Absolute public root. */
  root: string;
  /** Public-root-relative `*.worldbrief.json`. */
  brief: string;
  /** Public-root-relative `.level.json`; defaults to the brief's sibling level. */
  out?: string;
  /** Replace an existing level. */
  force?: boolean;
  /** `worldSettings.partition` of a new level; a replaced level keeps its own. */
  partition?: unknown;
}

export interface WorldBriefRunResult {
  level: string;
  build: WorldBriefBuild;
  written: number;
  removedCells: string[];
  /** Manifest id when the level was registered by this run. */
  registered: string | null;
}

function publicRelative(path: string, label: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || isAbsolute(path) || /^[a-z][a-z\d+.-]*:/i.test(path) || normalized.split("/").some((part) => part === ".." || part === "" || part === ".")) {
    throw new Error(`${label} must be a path under the public root: ${path}`);
  }
  return normalized;
}

function within(root: string, path: string): string {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error(`Path escapes the public root: ${path}`);
  return absolute;
}

async function readJson(root: string, path: string, label: string): Promise<unknown> {
  const text = await readFile(within(root, path), "utf8").catch((error: NodeJS.ErrnoException) => {
    throw new Error(error.code === "ENOENT" ? `${label} not found: ${path}` : `${label}: ${error.message}`);
  });
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${label} is not JSON (${path}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function exists(path: string): Promise<boolean> {
  return readFile(path).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}

/** Removes `*<suffix>` files of `dir` not in `keep`, then the directory and its parent when empty. */
async function pruneCells(root: string, dir: string, suffix: string, keep: readonly string[]): Promise<string[]> {
  const absolute = within(root, dir);
  const entries = await readdir(absolute, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(suffix) || keep.includes(entry.name.slice(0, -suffix.length))) continue;
    await unlink(resolve(absolute, entry.name));
    removed.push(`${dir}/${entry.name}`);
  }
  for (const directory of [absolute, resolve(absolute, "..")]) {
    await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
    });
  }
  return removed;
}

export async function runWorldBrief(options: WorldBriefRunOptions): Promise<WorldBriefRunResult> {
  const { root } = options;
  const briefPath = publicRelative(options.brief, "brief");
  const level = publicRelative(options.out ?? worldBriefLevelPath(briefPath), "--out");
  if (!/\.level\.json$/i.test(level)) throw new Error(`--out must be a .level.json path: ${level}`);
  const { brief, issues } = normalizeWorldBrief(await readJson(root, briefPath, "world brief"));
  if (!brief) throw new Error(`invalid world brief ${briefPath}:\n  ${issues.join("\n  ")}`);

  const levelAbs = within(root, level);
  let partition: unknown = options.partition;
  if (await exists(levelAbs)) {
    if (!options.force) throw new Error(`${level} exists; it may hold editor changes. Rerun with --force to rebuild it from the brief.`);
    const current = await readJson(root, level, "existing level") as { worldSettings?: { partition?: unknown } };
    partition = current.worldSettings?.partition;
  }

  let profile = null;
  if (brief.regionProfile) {
    const normalized = normalizeRegionProfile(await readJson(root, brief.regionProfile, "region profile"));
    if (!normalized.profile || normalized.issues.length) {
      throw new Error(`region profile ${brief.regionProfile}: ${normalized.issues.join("; ")}`);
    }
    profile = normalized.profile;
  }
  let cover = null;
  if (brief.cover) {
    const normalized = normalizeGroundCover(await readJson(root, brief.cover.file, "ground cover"));
    if (!normalized.cover) throw new Error(`ground cover ${brief.cover.file}: ${normalized.issues.join("; ")}`);
    cover = normalized.cover;
  }
  const project = await readJson(root, "project.3dgame.json", "project manifest") as { editor?: { assetManifest?: string } };
  const manifestPath = publicRelative(project.editor?.assetManifest ?? "assets/manifest.json", "editor.assetManifest");
  const manifest = await readJson(root, manifestPath, "asset manifest") as { assets?: Array<Record<string, unknown>> };
  if (!Array.isArray(manifest.assets)) throw new Error(`${manifestPath} has no assets list`);
  const idByPath = new Map(manifest.assets.map((asset) => [asset.path, asset.id]));
  const assetIdForFile = (file: string): string | null => {
    const id = idByPath.get(file);
    return typeof id === "string" ? id : null;
  };

  const build = buildWorldFromBrief({ brief, levelPath: level, profile, cover, assetIdForFile, partition });

  const write = async (path: string, data: string | Uint8Array): Promise<void> => {
    const absolute = within(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
  };
  const dirs = levelCellDirs(level);
  const isCell = (path: string): boolean => path.startsWith(`${dirs.main}/`);
  // Terrain first (its tile directory starts empty), then the editor's order: cells, level, cleanup.
  await rm(within(root, build.tilesDir), { recursive: true, force: true });
  const rank = (path: string): number => (isCell(path) ? 0 : path === level ? 2 : 1);
  const ordered = [...build.files].sort(([a], [b]) => rank(a) - rank(b));
  for (const [path, data] of ordered) await write(path, data);
  const removedCells = [
    ...await pruneCells(root, dirs.main, ".cell.json", build.cellKeys),
    ...await pruneCells(root, dirs.foliage, ".foliage.json", build.foliageCellKeys ?? []),
  ];

  let registered: string | null = null;
  if (!manifest.assets.some((asset) => asset.path === level || asset.file === level)) {
    const ids = manifest.assets.map((asset) => asset.id).filter((id): id is string => typeof id === "string");
    const bytes = Buffer.byteLength(build.files.get(level) as string, "utf8");
    const record = buildImportedAssetRecord(level, bytes, ids, "level");
    if (!record) throw new Error(`cannot register ${level} in ${manifestPath}`);
    manifest.assets.push(record as unknown as Record<string, unknown>);
    await write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    registered = record.id;
  }
  return { level, build, written: build.files.size, removedCells, registered };
}
