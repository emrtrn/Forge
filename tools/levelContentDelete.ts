/** Level-owned files, with a reference preflight before any destructive operation. */
import { readFile, readdir, stat } from "node:fs/promises";
import { posix } from "node:path";
import { collectJsonStrings } from "./terrainOrphans";
import { isLevelDocument } from "./worldDataCheck";

export interface LevelDeleteRoot {
  path: string;
  directory: boolean;
  files: string[];
}

export interface LevelContentDeletePlan {
  remove: LevelDeleteRoot[];
  /** Whole dependency groups kept because another document uses them. */
  preserved: string[];
}

const SIDECARS = [".foliage.json", ".meshpaint.json", ".worldbrief.json", ".worldrecipe.json", ".hlod.json"];
const DIRECTORIES = [".landscapes", ".cells", ".foam"];

function key(path: string): string {
  return posix.normalize(path.replace(/\\/g, "/").split(/[?#]/)[0]!).replace(/^\/+/, "").toLowerCase();
}

function within(path: string, folder: string): boolean {
  return key(path) === key(folder) || key(path).startsWith(`${key(folder)}/`);
}

function levelBase(path: string): string {
  if (!/\.json$/i.test(path)) throw new Error(`Level requires a JSON path: ${path}`);
  const base = path.replace(/(\.level|\.layout)?\.json$/i, "");
  if (!base || base.endsWith("/")) throw new Error(`Invalid level path: ${path}`);
  return base;
}

/** Do not follow references to models/materials: only these sibling roots are owned. */
function ownedRoots(level: string): LevelDeleteRoot[] {
  const base = levelBase(level);
  return [
    ...SIDECARS.map((suffix) => ({ path: `${base}${suffix}`, directory: false, files: [] })),
    ...DIRECTORIES.map((suffix) => ({ path: `${base}${suffix}`, directory: true, files: [] })),
  ];
}

/**
 * Conservative dependency groups: a shared terrain keeps its definition, tile
 * binaries and global map together. A shared cell/foam file keeps its directory.
 * No files are moved or rewritten under surviving levels.
 */
export async function prepareLevelContentDelete(
  publicPath: (path: string) => string,
  levels: readonly string[],
  deletingFolder?: string,
): Promise<LevelContentDeletePlan> {
  const roots = [...new Map(levels.flatMap(ownedRoots).map((root) => [key(root.path), root])).values()];
  if (roots.length === 0) return { remove: [], preserved: [] };
  const removedLevels = new Set(levels.map(key));
  const removedDocument = (path: string): boolean => removedLevels.has(key(path))
    || (deletingFolder !== undefined && within(path, deletingFolder));
  // Validate every descendant through the project's resolver, including hidden
  // files and links. Finish this preflight before deleting the level itself.
  const files: string[] = [];
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await readdir(publicPath(folder), { withFileTypes: true })) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      publicPath(path);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Cannot inspect linked or special content: ${path}`);
    }
  };
  await walk("");
  const existing: LevelDeleteRoot[] = [];
  for (const root of roots) {
    let info;
    try { info = await stat(publicPath(root.path)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (root.directory ? !info.isDirectory() : !info.isFile()) {
      throw new Error(`Unexpected level data type: ${root.path}`);
    }
    root.files = root.directory ? files.filter((path) => within(path, root.path)) : [root.path];
    existing.push(root);
  }
  if (existing.length === 0) return { remove: [], preserved: [] };
  const owner = (path: string): LevelDeleteRoot | undefined => existing.find((root) => root.directory
    ? within(path, root.path) : key(path) === key(root.path));
  const documents = new Map<string, unknown>();
  for (const path of files.filter((path) => /\.json$/i.test(path) && !removedDocument(path))) {
    // Unreadable external JSON must not silently grant permission to delete.
    try { documents.set(path, JSON.parse((await readFile(publicPath(path), "utf8")).replace(/^\uFEFF/, ""))); }
    catch (error) { throw new Error(`Cannot check level data references in ${path}: ${String(error)}`); }
  }
  const kept = new Set<LevelDeleteRoot>();
  const protect = (value: unknown): void => {
    for (const reference of collectJsonStrings(value)) {
      const root = owner(reference);
      if (root) kept.add(root);
    }
  };
  // Only surviving documents seed reachability; files being deleted must not
  // keep each other alive just because a recipe points to its own terrain.
  for (const [path, document] of documents) {
    if (owner(path)) continue;
    protect(document);
    // Alternate .json/.layout.json levels can share the same implicit siblings.
    if (isLevelDocument(document)) {
      const implicit = new Set(ownedRoots(path).map((root) => key(root.path)));
      for (const root of existing) if (implicit.has(key(root.path))) kept.add(root);
    }
  }
  let previous = -1;
  while (previous !== kept.size) {
    previous = kept.size;
    for (const [path, document] of documents) {
      const root = owner(path);
      if (root && kept.has(root)) protect(document);
    }
    // These indices derive cell paths implicitly from their own level stem.
    for (const root of kept) if (/\.(foliage|hlod)\.json$/i.test(root.path)) {
      const cells = existing.find((candidate) => key(candidate.path) === key(root.path.replace(/\.(foliage|hlod)\.json$/i, ".cells")));
      if (cells) kept.add(cells);
    }
  }
  return { remove: existing.filter((root) => !kept.has(root)), preserved: [...kept].map((root) => root.path).sort() };
}
