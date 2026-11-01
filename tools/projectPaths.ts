import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Server-owned selection. HTTP payloads never select a project root. */
export interface ProjectPaths {
  readonly root: string;
  readonly name: string;
  readonly publicDir: string;
  readonly behaviorScriptsDir: string;
  readonly gameModulePath: string;
  readonly editorCatalogPath: string;
  readonly gameSourceDir: string;
  publicPath(path: string): string;
  sourcePath(path: string): string;
}

/**
 * Check existing ancestors as well as the leaf, including for new files. Links
 * below an authorized root are refused rather than granting their target access.
 * This is a local authoring boundary, not isolation from concurrent OS writers.
 */
export function resolveProjectPath(root: string, path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (isAbsolute(normalized) || normalized.includes(":") || normalized.includes("\0")) {
    throw new Error(`Expected a project-relative path: ${path}`);
  }
  const target = resolve(root, normalized);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${path}`);
  }
  const check = (candidate: string): boolean => {
    try {
      if (lstatSync(candidate).isSymbolicLink()) throw new Error(`Project links are not allowed: ${candidate}`);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  };
  if (!check(root)) throw new Error(`Project root no longer exists: ${root}`);
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (!check(current)) break;
  }
  return target;
}

export function createProjectPaths(options: {
  forgeRoot: string;
  projectRoot?: string | undefined;
}): ProjectPaths {
  if (options.projectRoot !== undefined && !options.projectRoot.trim()) {
    throw new Error("FORGE_PROJECT_ROOT must not be empty");
  }
  const root = realpathSync(resolve(options.projectRoot ?? options.forgeRoot));
  if (!lstatSync(root).isDirectory()) throw new Error(`Not a project directory: ${root}`);
  const publicDir = resolveProjectPath(root, "public");
  if (!lstatSync(publicDir).isDirectory()) throw new Error(`Missing project public directory: ${publicDir}`);
  const manifestPath = resolveProjectPath(publicDir, "project.3dgame.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  // P1-A supports the existing public/ convention. Other layouts need an
  // explicit contract, never a silent fallback to Forge's own public directory.
  if (manifest.schema !== 1 || manifest.publicDir !== "public" || typeof manifest.name !== "string" || !manifest.name.trim()) {
    throw new Error(`Invalid project manifest (schema 1, name and publicDir=public required): ${manifestPath}`);
  }
  const behaviorScriptsDir = resolveProjectPath(root, "src/game/scripts");
  const game = manifest.game;
  const entryPath = (value: unknown): string => {
    if (typeof value !== "string" || !value.startsWith("src/game/") || !value.endsWith(".ts")) {
      throw new Error("Game entry must be a src/game/*.ts project-relative path");
    }
    const target = resolveProjectPath(root, value);
    if (!target.startsWith(`${resolve(root, "src/game")}${sep}`) || !lstatSync(target).isFile()) {
      throw new Error(`Invalid game entry: ${value}`);
    }
    return target;
  };
  if (game !== undefined && (!game || typeof game !== "object" || Array.isArray(game))) {
    throw new Error("Project game must declare module and editorCatalog entries");
  }
  const entries = game as Record<string, unknown> | undefined;
  // A data-only project retains the template module (existing smoke fixtures).
  // Declared entries must both exist; a broken game never falls back to Forge.
  const gameModulePath = entries ? entryPath(entries.module) : resolve(options.forgeRoot, "src/game/gameModule.ts");
  const editorCatalogPath = entries ? entryPath(entries.editorCatalog) : resolve(options.forgeRoot, "src/game/editorCatalog.ts");
  return {
    root,
    name: manifest.name,
    publicDir,
    behaviorScriptsDir,
    gameModulePath,
    editorCatalogPath,
    gameSourceDir: entries ? resolve(root, "src/game") : resolve(options.forgeRoot, "src/game"),
    publicPath: (path) => resolveProjectPath(publicDir, path),
    sourcePath: (path) => {
      const normalized = path.replace(/\\/g, "/");
      if (!normalized.startsWith("src/game/scripts/") || !normalized.endsWith(".ts")) {
        throw new Error(`Behavior path must be under src/game/scripts/: ${path}`);
      }
      const target = resolveProjectPath(root, normalized);
      if (!target.startsWith(`${behaviorScriptsDir}${sep}`)) {
        throw new Error(`Behavior path escapes src/game/scripts/: ${path}`);
      }
      return target;
    },
  };
}
