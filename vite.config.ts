import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  buildImportedAssetRecord,
  inferImportedAssetTypeFromContent,
  resolveContentNewFile,
  resolveContentRenameTarget,
  resolveImportPath,
  validateReimportAssetMeta,
  validateContentDeletePayload,
  validateContentNewPayload,
  validateContentRenamePayload,
  validateContentTransferPayload,
  validateImportAssetMeta,
  validateNewBehaviorPayload,
  resolveBehaviorStub,
  BEHAVIOR_SCRIPTS_DIR,
  validateSaveActorPayload,
  validateSaveCollisionPayload,
  validateSaveMaterialPayload,
  validateSaveMaterialSlotsPayload,
  validateSavePayload,
  validateSaveSkeletonPayload,
  validateSaveLandscapePayload,
  validateSaveUiPayload,
  validateSaveUvwPayload,
  validateSaveSoundCuePayload,
  validateSaveEffectPayload,
  validateSaveFoliagePayload,
  validateSaveMeshPaintPayload,
  validateSaveAssetVertexColorsPayload,
  validateSaveFoliageTypePayload,
  validateSaveDialogueVoicePayload,
  validateSaveDialogueLinePayload,
  validateSaveAiBlackboardPayload,
  validateSaveAiBehaviorPayload,
  validateSaveAiQueryPayload,
  validateSaveAiStateTreePayload,
  validateOpenLevelPayload,
} from "./tools/saveValidator";
import { collectDroppedFields, formatDroppedFieldWarning } from "./tools/droppedFields";

// Single-codebase template: this repo's own public/ is the project root that
// both the game (static fetch) and the editor (authoring middleware) read/write.
const PUBLIC_DIR = resolve("public");
const PROJECT_MANIFEST_PATH = resolve("public/project.3dgame.json");
// Generated behavior stubs (Actor Script editor -> New Behavior) land here. Unlike
// the public/ authoring endpoints this writes a source file, so it is fenced to
// exactly this directory and to the `.ts` extension (see resolveBehaviorScriptPath).
const BEHAVIOR_SCRIPTS_ABS = resolve(BEHAVIOR_SCRIPTS_DIR);

interface ProjectManifest {
  schema: 1;
  name: string;
  type: string;
  version: string;
  entry: string;
  publicDir: string;
  editor: {
    defaultScene: string;
    assetCatalog?: string;
    assetManifest: string;
    gridSize?: number;
    gridEnabled?: boolean;
    snapRotationDeg?: number;
    snapRotationEnabled?: boolean;
    snapScale?: number;
    snapScaleEnabled?: boolean;
    metadataSchema?: string;
    previewUrl?: string;
  };
  scripts: Record<string, string | undefined>;
  output: {
    distDir: string;
  };
}

async function readProjectManifest(): Promise<ProjectManifest> {
  return JSON.parse(await readFile(PROJECT_MANIFEST_PATH, "utf8")) as ProjectManifest;
}

/**
 * Resolves a public-root-relative path to an absolute path under public/,
 * refusing anything that escapes the public directory (path-traversal guard).
 */
function resolvePublicPath(publicRelativePath: string): string {
  const normalized = publicRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = resolve(PUBLIC_DIR, normalized);
  const rootWithSep = PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : `${PUBLIC_DIR}${sep}`;
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(rootWithSep)) {
    throw new Error(`path escapes public root: ${publicRelativePath}`);
  }
  return resolved;
}

/**
 * Resolves a generated behavior stub's project-relative path to an absolute path,
 * refusing anything that escapes `src/game/scripts/` or is not a `.ts` file. This
 * is the only write endpoint that touches source outside public/, so the guard is
 * deliberately strict.
 */
function resolveBehaviorScriptPath(projectRelativePath: string): string {
  const normalized = projectRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.endsWith(".ts")) {
    throw new Error(`behavior stub must be a .ts file: ${projectRelativePath}`);
  }
  const resolved = resolve(normalized);
  const rootWithSep = BEHAVIOR_SCRIPTS_ABS.endsWith(sep)
    ? BEHAVIOR_SCRIPTS_ABS
    : `${BEHAVIOR_SCRIPTS_ABS}${sep}`;
  if (!resolved.startsWith(rootWithSep)) {
    throw new Error(`path escapes ${BEHAVIOR_SCRIPTS_DIR}: ${projectRelativePath}`);
  }
  return resolved;
}

interface DirTreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  ext?: string;
  size?: number;
  children?: DirTreeNode[];
}

// Read-only recursive listing of a project directory. Used by the editor's
// Content Drawer to mirror the live asset folders. Depth and entry count are
// capped so a stray symlink loop or huge tree cannot stall the dev server.
async function readDirTree(
  absDir: string,
  relDir: string,
  depth: number,
  budget: { remaining: number },
): Promise<DirTreeNode[]> {
  if (depth <= 0 || budget.remaining <= 0) return [];
  const entries = await readdir(absDir, { withFileTypes: true });
  const nodes: DirTreeNode[] = [];
  for (const entry of entries) {
    if (budget.remaining <= 0) break;
    if (entry.name.startsWith(".")) continue;
    budget.remaining -= 1;
    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: childRel,
        type: "dir",
        children: await readDirTree(
          resolve(absDir, entry.name),
          childRel,
          depth - 1,
          budget,
        ),
      });
    } else if (entry.isFile()) {
      const fileStat = await stat(resolve(absDir, entry.name));
      nodes.push({
        name: entry.name,
        path: childRel,
        type: "file",
        ext: extname(entry.name).toLowerCase().replace(/^\./, ""),
        size: fileStat.size,
      });
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

// The /__save-layout payload validator (allowlist) lives in
// tools/saveValidator.ts so it can be unit-tested headlessly; imported above.

// Default cap for structured JSON save bodies. Landscape sidecars carry a full
// heightfield + per-vertex paint weights, so they use a much larger cap below.
const JSON_BODY_MAX_BYTES = 256 * 1024;

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number = JSON_BODY_MAX_BYTES,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/**
 * Reports (to the dev console) any field the allowlist validator did not copy
 * through, and hands the same list back so the endpoint can return it to the
 * editor. Silent data loss is the failure mode the allowlist design invites, so
 * every structured save that can afford the comparison runs it (plan I5).
 */
function reportDroppedFields(input: unknown, output: unknown, subject: string): string[] {
  const report = collectDroppedFields(input, output, subject);
  const warning = formatDroppedFieldWarning(report, subject);
  if (warning) console.warn(`[save] ${warning}`);
  return [...report.paths];
}

// A 257x257 landscape serializes to well over 1 MB (heights + 4 paint layers of
// per-vertex weights), and the compact payload for even a 129x129 heightmap sits
// right at the 256 KB default. Give landscape saves generous headroom so imported
// terrain always persists instead of silently failing to save.
const LANDSCAPE_BODY_MAX_BYTES = 32 * 1024 * 1024;

// Collects a raw request body (binary uploads) into a Buffer, capped at maxBytes.
async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("import file too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Appends a manifest entry for a just-imported asset so it isn't a "loose file".
 * Best-effort: returns the new asset id, or null when the type can't be inferred
 * or the path is already registered. Errors propagate to the caller, which keeps
 * the imported file even if registration fails.
 */
async function registerImportedAsset(
  rel: string,
  bytes: number,
  detectedType?: ReturnType<typeof inferImportedAssetTypeFromContent>,
): Promise<string | null> {
  const project = await readProjectManifest();
  const manifestAbs = resolvePublicPath(project.editor.assetManifest);
  const manifest = JSON.parse(await readFile(manifestAbs, "utf8")) as {
    assets?: unknown[];
  } & Record<string, unknown>;
  if (!Array.isArray(manifest.assets)) return null;

  const entries = manifest.assets.filter(
    (asset): asset is Record<string, unknown> => Boolean(asset) && typeof asset === "object",
  );
  if (
    entries.some((asset) => {
      const path = typeof asset.path === "string" ? asset.path : undefined;
      const file = typeof asset.file === "string" ? asset.file : undefined;
      return path === rel || file === rel;
    })
  ) {
    return null;
  }

  const existingIds = entries
    .map((asset) => asset.id)
    .filter((id): id is string => typeof id === "string");
  const record = buildImportedAssetRecord(rel, bytes, existingIds, detectedType);
  if (!record) return null;

  manifest.assets.push(record);
  await writeFile(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return record.id;
}

/** Refreshes the manifest's optional runtime byte count without changing asset identity. */
async function updateImportedAssetBytes(rel: string, bytes: number): Promise<boolean> {
  const project = await readProjectManifest();
  const manifestAbs = resolvePublicPath(project.editor.assetManifest);
  const manifest = JSON.parse(await readFile(manifestAbs, "utf8")) as {
    assets?: unknown[];
  } & Record<string, unknown>;
  if (!Array.isArray(manifest.assets)) return false;

  const entries = manifest.assets.filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
  );
  const asset = entries.find((entry) => entry.path === rel || entry.file === rel);
  if (!asset || !asset.runtime || typeof asset.runtime !== "object") return false;
  const runtime = asset.runtime as Record<string, unknown>;
  if (runtime.bytes === bytes) return false;
  runtime.bytes = bytes;
  await writeFile(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return true;
}

// Model assets carry editor sidecars that share the file's base name. Renaming or
// deleting the model must move/remove these too, or they orphan.
const MODEL_EXTS = new Set([".glb", ".gltf"]);
const MODEL_SIDECAR_SUFFIXES = [".collision.json", ".materials.json", ".uvw.json", ".skeleton.json", ".vertexcolors.json"];

async function pathExists(absPath: string): Promise<boolean> {
  return stat(absPath).then(
    () => true,
    () => false,
  );
}

/** Strips the last extension from a public-relative path: `a/b.glb` -> `a/b`. */
function stripLastExt(path: string): string {
  return path.replace(/\.[^./]+$/, "");
}

/** Moves any existing model sidecars alongside a renamed model file. */
async function moveModelSidecars(from: string, to: string): Promise<void> {
  const fromBase = stripLastExt(from);
  const toBase = stripLastExt(to);
  for (const suffix of MODEL_SIDECAR_SUFFIXES) {
    const fromAbs = resolvePublicPath(`${fromBase}${suffix}`);
    if (!(await pathExists(fromAbs))) continue;
    await rename(fromAbs, resolvePublicPath(`${toBase}${suffix}`));
  }
}

/** Removes any existing model sidecars for a deleted model file. */
async function deleteModelSidecars(path: string): Promise<void> {
  const base = stripLastExt(path);
  for (const suffix of MODEL_SIDECAR_SUFFIXES) {
    const abs = resolvePublicPath(`${base}${suffix}`);
    if (await pathExists(abs)) await unlink(abs);
  }
}

/** Copies model sidecars alongside a copied GLB/GLTF without overwriting any target file. */
async function copyModelSidecars(from: string, to: string): Promise<void> {
  const fromBase = stripLastExt(from);
  const toBase = stripLastExt(to);
  for (const suffix of MODEL_SIDECAR_SUFFIXES) {
    const fromAbs = resolvePublicPath(`${fromBase}${suffix}`);
    if (!(await pathExists(fromAbs))) continue;
    await copyFile(fromAbs, resolvePublicPath(`${toBase}${suffix}`));
  }
}

function contentParentDir(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

function contentFileBaseAndExtension(path: string): { base: string; extension: string } {
  const fileName = path.split("/").at(-1) ?? path;
  const dot = fileName.indexOf(".");
  return dot >= 0
    ? { base: fileName.slice(0, dot), extension: fileName.slice(dot) }
    : { base: fileName, extension: "" };
}

function contentCopyDestination(source: string, destinationDir: string, copyNumber: number): string {
  const { base, extension } = contentFileBaseAndExtension(source);
  const suffix = copyNumber === 1 ? " Copy" : ` Copy ${copyNumber}`;
  return `${destinationDir}/${base}${suffix}${extension}`;
}

async function transferTargetConflicts(source: string, target: string): Promise<boolean> {
  if (await pathExists(resolvePublicPath(target))) return true;
  if (!MODEL_EXTS.has(extname(source).toLowerCase())) return false;
  const sourceBase = stripLastExt(source);
  const targetBase = stripLastExt(target);
  for (const suffix of MODEL_SIDECAR_SUFFIXES) {
    if (
      (await pathExists(resolvePublicPath(`${sourceBase}${suffix}`))) &&
      (await pathExists(resolvePublicPath(`${targetBase}${suffix}`)))
    ) {
      return true;
    }
  }
  return false;
}

async function findAvailableContentCopyDestination(source: string, destinationDir: string): Promise<string> {
  for (let copyNumber = 1; copyNumber <= 1000; copyNumber += 1) {
    const target = contentCopyDestination(source, destinationDir, copyNumber);
    if (!(await transferTargetConflicts(source, target))) return target;
  }
  throw new Error("unable to find an available copy name");
}

/**
 * Repoints the manifest entry whose `path`/`file` matches `from` to `to`,
 * refreshing its display name. The asset id is kept stable so existing layout
 * placements (which reference assets by id) still resolve. Returns true when an
 * entry was updated.
 */
async function renameManifestEntry(from: string, to: string, name: string): Promise<boolean> {
  const project = await readProjectManifest();
  const manifestAbs = resolvePublicPath(project.editor.assetManifest);
  const manifest = JSON.parse(await readFile(manifestAbs, "utf8")) as {
    assets?: unknown[];
  } & Record<string, unknown>;
  if (!Array.isArray(manifest.assets)) return false;
  let changed = false;
  for (const asset of manifest.assets) {
    if (!asset || typeof asset !== "object") continue;
    const record = asset as Record<string, unknown>;
    if (record.path !== from && record.file !== from) continue;
    if (record.path === from) record.path = to;
    if (record.file === from) record.file = to;
    record.name = name;
    changed = true;
  }
  if (changed) await writeFile(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return changed;
}

/**
 * Clones a registered asset's manifest record for a file copy. The clone gets a
 * unique id, while its authored metadata (placement, collision, tags, runtime)
 * stays intact. Unregistered source files deliberately remain unregistered.
 */
async function copyManifestEntry(from: string, to: string): Promise<string | null> {
  const project = await readProjectManifest();
  const manifestAbs = resolvePublicPath(project.editor.assetManifest);
  const manifest = JSON.parse(await readFile(manifestAbs, "utf8")) as {
    assets?: unknown[];
  } & Record<string, unknown>;
  if (!Array.isArray(manifest.assets)) return null;
  const source = manifest.assets.find((asset): asset is Record<string, unknown> => {
    if (!asset || typeof asset !== "object") return false;
    const record = asset as Record<string, unknown>;
    return record.path === from || record.file === from;
  });
  if (!source) return null;

  const copied = structuredClone(source);
  if (copied.path === from) copied.path = to;
  if (copied.file === from) copied.file = to;
  const existingIds = new Set(
    manifest.assets
      .map((asset) => (asset && typeof asset === "object" ? (asset as Record<string, unknown>).id : null))
      .filter((id): id is string => typeof id === "string"),
  );
  const sourceId = typeof copied.id === "string" && copied.id ? copied.id : "asset";
  let id = `${sourceId}-copy`;
  for (let number = 2; existingIds.has(id); number += 1) id = `${sourceId}-copy-${number}`;
  copied.id = id;
  const sourceName = typeof source.name === "string" && source.name ? source.name : contentFileBaseAndExtension(from).base;
  copied.name = `${sourceName} Copy`;
  manifest.assets.push(copied);
  await writeFile(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return id;
}

/** Drops the manifest entry referencing `path`. Returns true when one was removed. */
async function removeManifestEntry(path: string): Promise<boolean> {
  const project = await readProjectManifest();
  const manifestAbs = resolvePublicPath(project.editor.assetManifest);
  const manifest = JSON.parse(await readFile(manifestAbs, "utf8")) as {
    assets?: unknown[];
  } & Record<string, unknown>;
  if (!Array.isArray(manifest.assets)) return false;
  const before = manifest.assets.length;
  manifest.assets = manifest.assets.filter((asset) => {
    if (!asset || typeof asset !== "object") return true;
    const record = asset as Record<string, unknown>;
    return record.path !== path && record.file !== path;
  });
  if (manifest.assets.length === before) return false;
  await writeFile(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return true;
}

function normalizePublicRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function isPathInFolder(path: string, folder: string): boolean {
  const normalizedPath = normalizePublicRelativePath(path);
  const normalizedFolder = normalizePublicRelativePath(folder);
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

function replaceFolderPrefix(path: string, fromFolder: string, toFolder: string): string {
  const normalizedPath = normalizePublicRelativePath(path);
  const normalizedFrom = normalizePublicRelativePath(fromFolder);
  const normalizedTo = normalizePublicRelativePath(toFolder);
  if (normalizedPath === normalizedFrom) return normalizedTo;
  if (!normalizedPath.startsWith(`${normalizedFrom}/`)) return normalizedPath;
  return `${normalizedTo}/${normalizedPath.slice(normalizedFrom.length + 1)}`;
}

interface ManifestFolderMutationResult {
  changed: boolean;
  removedIds: string[];
  removedLoadGroups: string[];
  remainingLoadGroups: string[];
  removedCount: number;
}

async function mutateAssetManifest(
  mutate: (manifest: { assets?: unknown[] } & Record<string, unknown>) => ManifestFolderMutationResult,
): Promise<ManifestFolderMutationResult> {
  const project = await readProjectManifest();
  const manifestAbs = resolvePublicPath(project.editor.assetManifest);
  const manifest = JSON.parse(await readFile(manifestAbs, "utf8")) as {
    assets?: unknown[];
  } & Record<string, unknown>;
  const result = mutate(manifest);
  if (result.changed) await writeFile(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return result;
}

async function renameManifestFolderEntries(fromFolder: string, toFolder: string): Promise<boolean> {
  const result = await mutateAssetManifest((manifest) => {
    let changed = false;
    if (Array.isArray(manifest.assets)) {
      for (const asset of manifest.assets) {
        if (!asset || typeof asset !== "object") continue;
        const record = asset as Record<string, unknown>;
        for (const key of ["path", "file", "thumbnail"] as const) {
          if (typeof record[key] !== "string" || !isPathInFolder(record[key], fromFolder)) continue;
          record[key] = replaceFolderPrefix(record[key], fromFolder, toFolder);
          changed = true;
        }
      }
    }
    return {
      changed,
      removedIds: [],
      removedLoadGroups: [],
      remainingLoadGroups: [],
      removedCount: 0,
    };
  });
  return result.changed;
}

async function removeManifestFolderEntries(folder: string): Promise<ManifestFolderMutationResult> {
  return mutateAssetManifest((manifest) => {
    const removedIds: string[] = [];
    const removedLoadGroups = new Set<string>();
    const remainingLoadGroups = new Set<string>();
    if (!Array.isArray(manifest.assets)) {
      return {
        changed: false,
        removedIds,
        removedLoadGroups: [],
        remainingLoadGroups: [],
        removedCount: 0,
      };
    }

    const before = manifest.assets.length;
    manifest.assets = manifest.assets.filter((asset) => {
      if (!asset || typeof asset !== "object") return true;
      const record = asset as Record<string, unknown>;
      const path = typeof record.path === "string"
        ? record.path
        : typeof record.file === "string"
          ? record.file
          : "";
      const loadGroup = typeof (record.runtime as Record<string, unknown> | undefined)?.loadGroup === "string"
        ? String((record.runtime as Record<string, unknown>).loadGroup)
        : typeof record.loadGroup === "string"
          ? record.loadGroup
          : "";
      if (!isPathInFolder(path, folder)) {
        if (loadGroup) remainingLoadGroups.add(loadGroup);
        return true;
      }
      if (typeof record.id === "string") removedIds.push(record.id);
      if (loadGroup) removedLoadGroups.add(loadGroup);
      return false;
    });

    return {
      changed: manifest.assets.length !== before,
      removedIds,
      removedLoadGroups: [...removedLoadGroups],
      remainingLoadGroups: [...remainingLoadGroups],
      removedCount: before - manifest.assets.length,
    };
  });
}

async function listFilesRecursive(absDir: string, relDir: string): Promise<string[]> {
  const entries = await readdir(absDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const childAbs = resolve(absDir, entry.name);
    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(childAbs, childRel));
    } else if (entry.isFile()) {
      files.push(childRel);
    }
  }
  return files;
}

function isLayoutJsonPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".level.json") || lower.endsWith(".layout.json");
}

function replaceJsonStringPrefixes(value: unknown, fromFolder: string, toFolder: string): {
  value: unknown;
  changed: boolean;
} {
  if (typeof value === "string") {
    if (!isPathInFolder(value, fromFolder)) return { value, changed: false };
    return { value: replaceFolderPrefix(value, fromFolder, toFolder), changed: true };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = replaceJsonStringPrefixes(item, fromFolder, toFolder);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const result = replaceJsonStringPrefixes(child, fromFolder, toFolder);
      changed ||= result.changed;
      next[key] = result.value;
    }
    return { value: next, changed };
  }
  return { value, changed: false };
}

async function rewriteJsonPathReferences(fromFolder: string, toFolder: string): Promise<number> {
  const files = await listFilesRecursive(PUBLIC_DIR, "");
  let changedFiles = 0;
  for (const rel of files.filter((file) => file.toLowerCase().endsWith(".json"))) {
    const abs = resolvePublicPath(rel);
    const raw = await readFile(abs, "utf8").catch(() => null);
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const result = replaceJsonStringPrefixes(parsed, fromFolder, toFolder);
    if (!result.changed) continue;
    await writeFile(abs, `${JSON.stringify(result.value, null, 2)}\n`, "utf8");
    changedFiles += 1;
  }
  return changedFiles;
}

function replaceJsonExactPath(value: unknown, from: string, to: string): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    return value === from ? { value: to, changed: true } : { value, changed: false };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = replaceJsonExactPath(item, from, to);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const result = replaceJsonExactPath(child, from, to);
      changed ||= result.changed;
      next[key] = result.value;
    }
    return { value: next, changed };
  }
  return { value, changed: false };
}

/** Keeps exact file-path references valid after a Cut/Paste move. */
async function rewriteJsonExactPathReferences(from: string, to: string): Promise<number> {
  const files = await listFilesRecursive(PUBLIC_DIR, "");
  let changedFiles = 0;
  for (const rel of files.filter((file) => file.toLowerCase().endsWith(".json"))) {
    const abs = resolvePublicPath(rel);
    const raw = await readFile(abs, "utf8").catch(() => null);
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const result = replaceJsonExactPath(parsed, from, to);
    if (!result.changed) continue;
    await writeFile(abs, `${JSON.stringify(result.value, null, 2)}\n`, "utf8");
    changedFiles += 1;
  }
  return changedFiles;
}

function cleanDeletedAssetReferences(
  layout: Record<string, unknown>,
  removedIds: Set<string>,
  removedPathsFolder: string,
  removedLoadGroups: Set<string>,
  remainingLoadGroups: Set<string>,
): boolean {
  let changed = false;
  const isRemovedRef = (value: unknown): boolean =>
    typeof value === "string" && (removedIds.has(value) || isPathInFolder(value, removedPathsFolder));

  if (Array.isArray(layout.instances)) {
    const next = layout.instances.filter((entry) => {
      const assetId = (entry as Record<string, unknown> | null)?.assetId;
      return !isRemovedRef(assetId);
    });
    changed ||= next.length !== layout.instances.length;
    layout.instances = next.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const record = entry as Record<string, unknown>;
      if (!Array.isArray(record.placements)) return record;
      for (const placement of record.placements) {
        if (!placement || typeof placement !== "object") continue;
        const item = placement as Record<string, unknown>;
        if (isRemovedRef(item.materialSlot)) {
          delete item.materialSlot;
          changed = true;
        }
      }
      return record;
    });
  }

  if (Array.isArray(layout.characters)) {
    const next = layout.characters.filter((entry) => {
      const assetId = (entry as Record<string, unknown> | null)?.assetId;
      return !isRemovedRef(assetId);
    });
    changed ||= next.length !== layout.characters.length;
    layout.characters = next;
  }

  if (Array.isArray(layout.actors)) {
    const next = layout.actors.filter((entry) => {
      const classRef = (entry as Record<string, unknown> | null)?.classRef;
      return !isRemovedRef(classRef);
    });
    changed ||= next.length !== layout.actors.length;
    layout.actors = next;
  }

  if (Array.isArray(layout.worldWidgets)) {
    const next = layout.worldWidgets.filter((entry) => {
      const widget = (entry as Record<string, unknown> | null)?.widget;
      return !isRemovedRef(widget);
    });
    changed ||= next.length !== layout.worldWidgets.length;
    layout.worldWidgets = next;
  }

  if (Array.isArray(layout.reflectiveSurfaces)) {
    for (const surface of layout.reflectiveSurfaces) {
      if (!surface || typeof surface !== "object") continue;
      const record = surface as Record<string, unknown>;
      if (isRemovedRef(record.material)) {
        record.material = null;
        changed = true;
      }
    }
  }

  if (Array.isArray(layout.loadGroups)) {
    const next = layout.loadGroups.filter(
      (group) =>
        typeof group !== "string" ||
        !removedLoadGroups.has(group) ||
        remainingLoadGroups.has(group),
    );
    changed ||= next.length !== layout.loadGroups.length;
    layout.loadGroups = next;
  }

  if (layout.worldSettings && typeof layout.worldSettings === "object") {
    const worldSettings = layout.worldSettings as Record<string, unknown>;
    for (const key of ["hudWidget", "pauseMenuWidget", "winScreenWidget", "loseScreenWidget"]) {
      if (isRemovedRef(worldSettings[key])) {
        delete worldSettings[key];
        changed = true;
      }
    }
  }

  return changed;
}

async function cleanLayoutReferencesAfterFolderDelete(
  folder: string,
  removedIds: readonly string[],
  removedLoadGroups: readonly string[],
  remainingLoadGroups: readonly string[],
): Promise<number> {
  const files = await listFilesRecursive(PUBLIC_DIR, "");
  const removedIdSet = new Set(removedIds);
  const removedLoadGroupSet = new Set(removedLoadGroups);
  const remainingLoadGroupSet = new Set(remainingLoadGroups);
  let changedFiles = 0;
  for (const rel of files.filter(isLayoutJsonPath)) {
    if (isPathInFolder(rel, folder)) continue;
    const abs = resolvePublicPath(rel);
    const raw = await readFile(abs, "utf8").catch(() => null);
    if (!raw) continue;
    let layout: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") continue;
      layout = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!cleanDeletedAssetReferences(layout, removedIdSet, folder, removedLoadGroupSet, remainingLoadGroupSet)) {
      continue;
    }
    await writeFile(abs, `${JSON.stringify(layout, null, 2)}\n`, "utf8");
    changedFiles += 1;
  }
  return changedFiles;
}

async function updateProjectDefaultSceneForRename(fromFolder: string, toFolder: string): Promise<boolean> {
  const project = await readProjectManifest();
  if (!isPathInFolder(project.editor.defaultScene, fromFolder)) return false;
  project.editor = {
    ...project.editor,
    defaultScene: replaceFolderPrefix(project.editor.defaultScene, fromFolder, toFolder),
  };
  await writeFile(PROJECT_MANIFEST_PATH, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  return true;
}

async function ensureDefaultSceneSurvivesFolderDelete(folder: string): Promise<void> {
  const project = await readProjectManifest();
  if (!isPathInFolder(project.editor.defaultScene, folder)) return;
  const manifestAbs = resolvePublicPath(project.editor.assetManifest);
  const manifest = JSON.parse(await readFile(manifestAbs, "utf8")) as {
    assets?: unknown[];
  };
  const fallback = Array.isArray(manifest.assets)
    ? manifest.assets.find((asset) => {
        if (!asset || typeof asset !== "object") return false;
        const record = asset as Record<string, unknown>;
        const path = typeof record.path === "string"
          ? record.path
          : typeof record.file === "string"
            ? record.file
            : "";
        return !isPathInFolder(path, folder) && isLayoutJsonPath(path);
      })
    : null;
  if (!fallback || typeof fallback !== "object") {
    throw new Error("cannot delete the folder containing the active level because no fallback level exists");
  }
  const record = fallback as Record<string, unknown>;
  const next = typeof record.path === "string" ? record.path : String(record.file);
  project.editor = { ...project.editor, defaultScene: next };
  await writeFile(PROJECT_MANIFEST_PATH, `${JSON.stringify(project, null, 2)}\n`, "utf8");
}

// Endpoints that write files. These must never be reachable from the LAN even
// when `server.host` is true; the read-only directory listing (/__project-dir)
// stays open so real-device (LAN) testing can still render scenes.
const PRIVILEGED_URLS = new Set([
  "/__save-layout",
  "/__save-collision",
  "/__save-material-slots",
  "/__save-skeleton",
  "/__save-landscape",
  "/__save-soundcue",
  "/__save-effect",
  "/__save-foliage",
  "/__save-foliage-type",
  "/__save-dialogue-voice",
  "/__save-dialogue-line",
  "/__save-blackboard",
  "/__save-behavior",
  "/__save-query",
  "/__save-state-tree",
  "/__save-ui",
  "/__save-uvw",
  "/__save-meshpaint",
  "/__save-vertexcolors",
  "/__content-new",
  "/__content-rename",
  "/__content-delete",
  "/__content-transfer",
  "/__import-asset",
  "/__reimport-asset",
  "/__new-behavior",
  "/__open-level",
]);

// Cap a single imported asset (binary models/textures/audio are larger than the
// 256 KB JSON bodies, but a stray huge upload should not exhaust dev-server RAM).
const IMPORT_MAX_BYTES = 64 * 1024 * 1024;

function isPrivilegedUrl(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split("?")[0] ?? url;
  return PRIVILEGED_URLS.has(path);
}

// Trust only the real peer socket address, never spoofable forwarded headers.
function isLocalRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? "";
  return (
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.startsWith("127.")
  );
}

function layoutEditorPlugin(): Plugin {
  return {
    name: "3dgamedev-layout-editor",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (isPrivilegedUrl(req.url) && !isLocalRequest(req)) {
          res.statusCode = 403;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              error: "Forbidden: authoring endpoints are restricted to localhost.",
            }),
          );
          return;
        }

        // Read-only directory listing for the editor's Content Browser tree.
        // Scoped to this project's public/ folder (the asset/layout root).
        if (req.url?.startsWith("/__project-dir/")) {
          try {
            const encodedPath = req.url.slice("/__project-dir/".length).split("?")[0] ?? "";
            const projectPath = decodeURIComponent(encodedPath);
            const dirPath = resolvePublicPath(projectPath);
            const dirStat = await stat(dirPath);
            if (!dirStat.isDirectory()) throw new Error(`not a directory: ${projectPath}`);
            const normalizedRoot = projectPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
            const children = await readDirTree(dirPath, normalizedRoot, 12, {
              remaining: 5000,
            });
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ root: normalizedRoot, children }));
          } catch (error) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
          return;
        }

        // Asset-level collision sidecar writes (`*.collision.json`). Reads go
        // through Vite's static serving of public/, so only writes need an
        // endpoint. The path is validated to stay a collision sidecar; the
        // resolvePublicPath guard keeps it inside public/.
        if (req.url === "/__save-collision") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveCollisionPayload(await readJsonBody(req));
            const sidecarPath = resolvePublicPath(payload.path);
            const previous = await readFile(sidecarPath, "utf8").catch(() => null);
            const nextSidecar = `${JSON.stringify(payload.collision, null, 2)}\n`;
            await writeFile(sidecarPath, nextSidecar, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== nextSidecar }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Actor Script editor save: writes a `<name>.actor.json` class-asset.
        // Validated/normalized server-side (validateSaveActorPayload), kept inside
        // public/ by resolvePublicPath.
        if (req.url === "/__save-actor") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveActorPayload(await readJsonBody(req));
            const filePath = resolvePublicPath(payload.path);
            const previous = await readFile(filePath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.actor, null, 2)}\n`;
            await writeFile(filePath, next, "utf8");
            // Register newly-authored Actor classes in the manifest, same as
            // materials/UI/sound cues. Without this an actor saved outside the
            // Content Browser "New" flow stays a loose file: it shows the amber
            // "not registered in the manifest" dot and never reaches the asset
            // pickers. Idempotent: registerImportedAsset no-ops on a known path.
            let registeredId: string | null = null;
            try {
              registeredId = await registerImportedAsset(
                payload.path,
                Buffer.byteLength(next, "utf8"),
                inferImportedAssetTypeFromContent(payload.path, next),
              );
            } catch {
              registeredId = null;
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: true, path: payload.path, changed: previous !== next, registeredId }),
            );
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Actor Script editor "New Behavior": scaffolds a typed behavior stub at
        // `src/game/scripts/<slug>.ts` for an event-binding scriptId so AI/devs can
        // fill in the logic and register it. Localhost-only; fenced to the scripts
        // dir; never overwrites an existing file (409). The data lives in the
        // *.actor.json; this only generates the source signature.
        if (req.url === "/__new-behavior") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateNewBehaviorPayload(await readJsonBody(req));
            const stub = resolveBehaviorStub(payload.scriptId);
            const absPath = resolveBehaviorScriptPath(stub.path);
            const exists = await stat(absPath).then(
              () => true,
              () => false,
            );
            if (exists) {
              res.statusCode = 409;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(
                JSON.stringify({ ok: false, error: `already exists: ${stub.path}`, path: stub.path }),
              );
              return;
            }
            await mkdir(BEHAVIOR_SCRIPTS_ABS, { recursive: true });
            await writeFile(absPath, stub.source, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: stub.path, exportName: stub.exportName }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        if (req.url === "/__save-material-slots") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveMaterialSlotsPayload(await readJsonBody(req));
            const sidecarPath = resolvePublicPath(payload.path);
            const previous = await readFile(sidecarPath, "utf8").catch(() => null);
            const nextSidecar = `${JSON.stringify(payload.materialSlots, null, 2)}\n`;
            await writeFile(sidecarPath, nextSidecar, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== nextSidecar }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        if (req.url === "/__save-skeleton") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const body = await readJsonBody(req);
            const payload = validateSaveSkeletonPayload(body);
            const dropped = reportDroppedFields(
              (body as { skeleton?: unknown } | null)?.skeleton,
              payload.skeleton,
              "skeleton",
            );
            const sidecarPath = resolvePublicPath(payload.path);
            const previous = await readFile(sidecarPath, "utf8").catch(() => null);
            const nextSidecar = `${JSON.stringify(payload.skeleton, null, 2)}\n`;
            await writeFile(sidecarPath, nextSidecar, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                ok: true,
                path: payload.path,
                changed: previous !== nextSidecar,
                dropped,
              }),
            );
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Landscape editor save: writes a `<id>.landscape.json` height/layer
        // sidecar. Validated/normalized server-side (validateSaveLandscapePayload),
        // kept inside public/ by resolvePublicPath.
        if (req.url === "/__save-landscape") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveLandscapePayload(
              await readJsonBody(req, LANDSCAPE_BODY_MAX_BYTES),
            );
            const sidecarPath = resolvePublicPath(payload.path);
            await mkdir(resolve(sidecarPath, ".."), { recursive: true });
            const previous = await readFile(sidecarPath, "utf8").catch(() => null);
            const nextSidecar = `${JSON.stringify(payload.landscape, null, 2)}\n`;
            await writeFile(sidecarPath, nextSidecar, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== nextSidecar }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        if (req.url === "/__save-material") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveMaterialPayload(await readJsonBody(req));
            const filePath = resolvePublicPath(payload.path);
            const previous = await readFile(filePath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.material, null, 2)}\n`;
            await writeFile(filePath, next, "utf8");
            // Register newly-authored materials in the manifest so they appear in
            // asset pickers (Details material slots, landscape paint layers, ...).
            // Idempotent: registerImportedAsset no-ops when the path already exists.
            let registeredId: string | null = null;
            try {
              registeredId = await registerImportedAsset(
                payload.path,
                Buffer.byteLength(next, "utf8"),
                inferImportedAssetTypeFromContent(payload.path, next),
              );
            } catch {
              registeredId = null;
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: true, path: payload.path, changed: previous !== next, registeredId }),
            );
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // UI Widget editor save: writes a `<name>.ui.json` widget asset.
        // Validated/normalized server-side (validateSaveUiPayload), kept inside
        // public/ by resolvePublicPath.
        if (req.url === "/__save-ui") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveUiPayload(await readJsonBody(req));
            const filePath = resolvePublicPath(payload.path);
            const previous = await readFile(filePath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.ui, null, 2)}\n`;
            await writeFile(filePath, next, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== next }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Sound Cue editor save: writes a `<name>.soundcue.json` asset.
        // Validated/normalized server-side (validateSaveSoundCuePayload), kept
        // inside public/ by resolvePublicPath.
        if (req.url === "/__save-soundcue") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveSoundCuePayload(await readJsonBody(req));
            const filePath = resolvePublicPath(payload.path);
            const previous = await readFile(filePath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.cue, null, 2)}\n`;
            await writeFile(filePath, next, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== next }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // VFX Lite particle effect editor save: writes a `<name>.effect.json`
        // asset. Validated/normalized server-side (validateSaveEffectPayload),
        // kept inside public/ by resolvePublicPath.
        if (req.url === "/__save-effect") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const body = await readJsonBody(req);
            const payload = validateSaveEffectPayload(body);
            const dropped = reportDroppedFields(
              (body as { effect?: unknown } | null)?.effect,
              payload.effect,
              "effect",
            );
            const filePath = resolvePublicPath(payload.path);
            const previous = await readFile(filePath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.effect, null, 2)}\n`;
            await writeFile(filePath, next, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: true, path: payload.path, changed: previous !== next, dropped }),
            );
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Foliage Type editor save: writes a `<name>.foliagetype.json` asset and
        // registers it in the manifest so it appears in Foliage Mode's type list.
        // Validated/normalized server-side (validateSaveFoliageTypePayload).
        if (req.url === "/__save-foliage-type") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveFoliageTypePayload(await readJsonBody(req));
            const filePath = resolvePublicPath(payload.path);
            await mkdir(resolve(filePath, ".."), { recursive: true });
            const previous = await readFile(filePath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.foliageType, null, 2)}\n`;
            await writeFile(filePath, next, "utf8");
            let registeredId: string | null = null;
            try {
              registeredId = await registerImportedAsset(
                payload.path,
                Buffer.byteLength(next, "utf8"),
                inferImportedAssetTypeFromContent(payload.path, next),
              );
            } catch {
              registeredId = null;
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: true, path: payload.path, changed: previous !== next, registeredId }),
            );
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Foliage Mode save: writes a `<layout>.foliage.json` instance sidecar
        // (can hold thousands of instances, so it uses the larger landscape body
        // cap). Validated/normalized server-side (validateSaveFoliagePayload).
        if (req.url === "/__save-foliage") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveFoliagePayload(
              await readJsonBody(req, LANDSCAPE_BODY_MAX_BYTES),
            );
            const sidecarPath = resolvePublicPath(payload.path);
            await mkdir(resolve(sidecarPath, ".."), { recursive: true });
            const previous = await readFile(sidecarPath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.foliage, null, 2)}\n`;
            await writeFile(sidecarPath, next, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== next }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Mesh Paint stores placement-scoped RGBA vertex arrays beside the
        // level, never mutating the source GLB. The validator rejects partial
        // arrays/topology mismatches before data reaches disk.
        if (req.url === "/__save-meshpaint") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveMeshPaintPayload(
              await readJsonBody(req, LANDSCAPE_BODY_MAX_BYTES),
            );
            const sidecarPath = resolvePublicPath(payload.path);
            await mkdir(resolve(sidecarPath, ".."), { recursive: true });
            const previous = await readFile(sidecarPath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.meshPaint, null, 2)}\n`;
            await writeFile(sidecarPath, next, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== next }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Asset defaults produced by Mesh Paint > To Mesh. They travel with
        // their model during Content Drawer rename/copy/delete operations.
        if (req.url === "/__save-vertexcolors") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveAssetVertexColorsPayload(
              await readJsonBody(req, LANDSCAPE_BODY_MAX_BYTES),
            );
            const sidecarPath = resolvePublicPath(payload.path);
            await mkdir(resolve(sidecarPath, ".."), { recursive: true });
            const previous = await readFile(sidecarPath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.vertexColors, null, 2)}\n`;
            await writeFile(sidecarPath, next, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== next }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        if (req.url === "/__save-dialogue-voice") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveDialogueVoicePayload(await readJsonBody(req));
            const filePath = resolvePublicPath(payload.path);
            const previous = await readFile(filePath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.voice, null, 2)}\n`;
            await writeFile(filePath, next, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== next }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        if (req.url === "/__save-dialogue-line") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveDialogueLinePayload(await readJsonBody(req));
            const filePath = resolvePublicPath(payload.path);
            const previous = await readFile(filePath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.line, null, 2)}\n`;
            await writeFile(filePath, next, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== next }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        if (req.url === "/__save-blackboard") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveAiBlackboardPayload(await readJsonBody(req));
            const filePath = resolvePublicPath(payload.path);
            const previous = await readFile(filePath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.blackboard, null, 2)}\n`;
            await writeFile(filePath, next, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== next }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        if (req.url === "/__save-behavior") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveAiBehaviorPayload(await readJsonBody(req));
            const filePath = resolvePublicPath(payload.path);
            const previous = await readFile(filePath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.behavior, null, 2)}\n`;
            await writeFile(filePath, next, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== next }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        if (req.url === "/__save-query") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveAiQueryPayload(await readJsonBody(req));
            const filePath = resolvePublicPath(payload.path);
            const previous = await readFile(filePath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.query, null, 2)}\n`;
            await writeFile(filePath, next, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== next }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        if (req.url === "/__save-state-tree") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveAiStateTreePayload(await readJsonBody(req));
            const filePath = resolvePublicPath(payload.path);
            const previous = await readFile(filePath, "utf8").catch(() => null);
            const next = `${JSON.stringify(payload.stateTree, null, 2)}\n`;
            await writeFile(filePath, next, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== next }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        if (req.url === "/__save-uvw") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateSaveUvwPayload(await readJsonBody(req));
            const sidecarPath = resolvePublicPath(payload.path);
            const previous = await readFile(sidecarPath, "utf8").catch(() => null);
            const nextSidecar = `${JSON.stringify(payload.uvw, null, 2)}\n`;
            await writeFile(sidecarPath, nextSidecar, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed: previous !== nextSidecar }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Content Browser "new content": create a folder or a typed stub asset
        // (`<name>.<kind>.json`) inside a public-scoped directory. The path stays
        // inside public/ via resolvePublicPath; existing targets are never
        // overwritten (409). Real per-type editors come later.
        if (req.url === "/__content-new") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateContentNewPayload(await readJsonBody(req));
            const target = resolveContentNewFile(payload);
            const absPath = resolvePublicPath(target.path);
            const exists = await stat(absPath).then(
              () => true,
              () => false,
            );
            if (exists) {
              res.statusCode = 409;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: `already exists: ${target.path}` }));
              return;
            }
            if (target.content === null) {
              await mkdir(absPath);
            } else {
              await writeFile(absPath, target.content, "utf8");
            }
            let registeredId: string | null = null;
            if (target.content !== null) {
              try {
                const contentBytes = Buffer.byteLength(target.content, "utf8");
                registeredId = await registerImportedAsset(
                  target.path,
                  contentBytes,
                  inferImportedAssetTypeFromContent(target.path, target.content),
                );
              } catch {
                registeredId = null;
              }
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: true, path: target.path, kind: payload.kind, registeredId }),
            );
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Content Browser Rename: rename a single asset file/folder. File
        // renames preserve extension chains and keep asset ids stable. Folder
        // renames rewrite public-relative path prefixes in manifest/project JSON.
        if (req.url === "/__content-rename") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateContentRenamePayload(await readJsonBody(req));
            const target = resolveContentRenameTarget(payload);
            if (target.from === target.to) {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: true, path: target.to, registered: false }));
              return;
            }
            const fromAbs = resolvePublicPath(target.from);
            const fromStat = await stat(fromAbs).catch(() => null);
            if (!fromStat) {
              res.statusCode = 404;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: `not found: ${target.from}` }));
              return;
            }
            const finalTarget = fromStat.isDirectory()
              ? (() => {
                  const slash = target.from.lastIndexOf("/");
                  const dir = slash >= 0 ? target.from.slice(0, slash) : "";
                  return {
                    from: target.from,
                    to: dir ? `${dir}/${payload.name}` : payload.name,
                    ext: "",
                  };
                })()
              : target;
            if (finalTarget.from === finalTarget.to) {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({
                ok: true,
                path: finalTarget.to,
                kind: fromStat.isDirectory() ? "folder" : "file",
                registered: false,
              }));
              return;
            }
            const finalToAbs = resolvePublicPath(finalTarget.to);
            if (await pathExists(finalToAbs)) {
              res.statusCode = 409;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: `already exists: ${finalTarget.to}` }));
              return;
            }
            await rename(fromAbs, finalToAbs);
            const registered = fromStat.isDirectory()
              ? await renameManifestFolderEntries(finalTarget.from, finalTarget.to).catch(() => false)
              : await renameManifestEntry(finalTarget.from, finalTarget.to, payload.name).catch(() => false);
            let rewrittenJsonFiles = 0;
            if (fromStat.isDirectory()) {
              await updateProjectDefaultSceneForRename(finalTarget.from, finalTarget.to).catch(() => false);
              rewrittenJsonFiles = await rewriteJsonPathReferences(finalTarget.from, finalTarget.to).catch(() => 0);
            } else if (MODEL_EXTS.has(finalTarget.ext.toLowerCase())) {
              await moveModelSidecars(finalTarget.from, finalTarget.to);
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({
              ok: true,
              path: finalTarget.to,
              kind: fromStat.isDirectory() ? "folder" : "file",
              registered,
              rewrittenJsonFiles,
            }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Content Browser Delete: remove a single asset file/folder. Folder
        // deletes also remove descendant manifest entries and scrub level
        // references so stale asset ids/class paths do not break project load.
        if (req.url === "/__content-delete") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateContentDeletePayload(await readJsonBody(req));
            const absPath = resolvePublicPath(payload.path);
            const fileStat = await stat(absPath).catch(() => null);
            if (!fileStat) {
              res.statusCode = 404;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: `not found: ${payload.path}` }));
              return;
            }
            if (fileStat.isDirectory() && normalizePublicRelativePath(payload.path) === "assets") {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: "cannot delete the asset root folder" }));
              return;
            }
            let registered = false;
            let deletedFiles = 1;
            let removedAssets = 0;
            let cleanedLayouts = 0;
            if (fileStat.isDirectory()) {
              const deletedPaths = await listFilesRecursive(absPath, payload.path);
              deletedFiles = deletedPaths.length;
              await ensureDefaultSceneSurvivesFolderDelete(payload.path);
              const removed = await removeManifestFolderEntries(payload.path).catch(() => ({
                changed: false,
                removedIds: [],
                removedLoadGroups: [],
                remainingLoadGroups: [],
                removedCount: 0,
              }));
              registered = removed.changed;
              removedAssets = removed.removedCount;
              cleanedLayouts = await cleanLayoutReferencesAfterFolderDelete(
                payload.path,
                removed.removedIds,
                removed.removedLoadGroups,
                removed.remainingLoadGroups,
              ).catch(() => 0);
              await rm(absPath, { recursive: true });
            } else if (fileStat.isFile()) {
              await unlink(absPath);
              if (MODEL_EXTS.has(extname(payload.path).toLowerCase())) {
                await deleteModelSidecars(payload.path);
              }
              registered = await removeManifestEntry(payload.path).catch(() => false);
              removedAssets = registered ? 1 : 0;
            } else {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: `unsupported content type: ${payload.path}` }));
              return;
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({
              ok: true,
              path: payload.path,
              kind: fileStat.isDirectory() ? "folder" : "file",
              registered,
              deletedFiles,
              removedAssets,
              cleanedLayouts,
            }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Content Browser Cut/Copy/Paste: transfers one file to an existing
        // public-scoped folder. Folder copying is deliberately deferred because
        // it needs recursive manifest-id and internal-reference remapping.
        if (req.url === "/__content-transfer") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateContentTransferPayload(await readJsonBody(req));
            const sourceAbs = resolvePublicPath(payload.source);
            const sourceStat = await stat(sourceAbs).catch(() => null);
            if (!sourceStat) throw new Error(`not found: ${payload.source}`);
            if (!sourceStat.isFile()) throw new Error("folder transfer is not available in Content Browser V1");

            const destinationAbs = resolvePublicPath(payload.destinationDir);
            const destinationStat = await stat(destinationAbs).catch(() => null);
            if (!destinationStat?.isDirectory()) {
              throw new Error(`destination folder not found: ${payload.destinationDir}`);
            }

            const sourceParent = contentParentDir(payload.source);
            if (payload.operation === "move" && sourceParent === payload.destinationDir) {
              throw new Error("source is already in the target folder");
            }
            if (
              payload.operation === "move" &&
              extname(payload.source).toLowerCase() === ".gltf"
            ) {
              throw new Error("moving .gltf files is not available in Content Browser V1");
            }

            const project = await readProjectManifest();
            if (
              payload.operation === "move" &&
              normalizePublicRelativePath(project.editor.defaultScene) === payload.source
            ) {
              throw new Error("cannot move the active level; set another level as default first");
            }

            const fileName = payload.source.split("/").at(-1) ?? payload.source;
            const target =
              payload.operation === "copy"
                ? await findAvailableContentCopyDestination(payload.source, payload.destinationDir)
                : `${payload.destinationDir}/${fileName}`;
            if (payload.operation === "move" && (await transferTargetConflicts(payload.source, target))) {
              throw new Error(`already exists: ${target}`);
            }

            if (payload.operation === "move") {
              await rename(sourceAbs, resolvePublicPath(target));
              if (MODEL_EXTS.has(extname(payload.source).toLowerCase())) {
                await moveModelSidecars(payload.source, target);
              }
              const registered = await renameManifestEntry(
                payload.source,
                target,
                contentFileBaseAndExtension(target).base,
              ).catch(() => false);
              await rewriteJsonExactPathReferences(payload.source, target).catch(() => 0);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: true, path: target, registered, registeredId: null }));
              return;
            }

            let copied = false;
            try {
              await copyFile(sourceAbs, resolvePublicPath(target));
              copied = true;
              if (MODEL_EXTS.has(extname(payload.source).toLowerCase())) {
                await copyModelSidecars(payload.source, target);
              }
              const registeredId = await copyManifestEntry(payload.source, target);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(
                JSON.stringify({
                  ok: true,
                  path: target,
                  registered: registeredId !== null,
                  registeredId,
                }),
              );
            } catch (error) {
              if (copied) {
                await unlink(resolvePublicPath(target)).catch(() => undefined);
                if (MODEL_EXTS.has(extname(payload.source).toLowerCase())) {
                  await deleteModelSidecars(target).catch(() => undefined);
                }
              }
              throw error;
            }
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Content Browser Import: write an uploaded asset's raw bytes into a
        // public-scoped folder. Metadata (target dir + filename) travels in the
        // query string; the body is the raw file. Extension is allowlisted and
        // existing files are never overwritten (409).
        if (req.url?.split("?")[0] === "/__import-asset") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const params = new URL(req.url, "http://localhost").searchParams;
            const meta = validateImportAssetMeta({
              dir: params.get("dir") ?? "",
              name: params.get("name") ?? "",
            });
            const rel = resolveImportPath(meta);
            const absPath = resolvePublicPath(rel);
            const exists = await stat(absPath).then(
              () => true,
              () => false,
            );
            if (exists) {
              res.statusCode = 409;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: `already exists: ${rel}` }));
              return;
            }
            const body = await readRawBody(req, IMPORT_MAX_BYTES);
            await mkdir(resolve(absPath, ".."), { recursive: true });
            await writeFile(absPath, body);
            // Best-effort manifest registration so the file isn't a loose file.
            // The import itself still succeeds if registration throws.
            let registeredId: string | null = null;
            try {
              registeredId = await registerImportedAsset(
                rel,
                body.length,
                inferImportedAssetTypeFromContent(rel, body),
              );
            } catch {
              registeredId = null;
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: rel, bytes: body.length, registeredId }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // Content Browser Reimport: replace an existing GLB/GLTF while keeping
        // its public path and manifest id stable. Existing scene placements can
        // therefore keep referring to the asset after a Blender export.
        if (req.url?.split("?")[0] === "/__reimport-asset") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const params = new URL(req.url, "http://localhost").searchParams;
            const meta = validateReimportAssetMeta({
              path: params.get("path") ?? "",
              name: params.get("name") ?? "",
            });
            const absPath = resolvePublicPath(meta.path);
            const existing = await stat(absPath);
            if (!existing.isFile()) throw new Error(`not a file: ${meta.path}`);

            const body = await readRawBody(req, IMPORT_MAX_BYTES);
            // Write the complete upload beside the live model before swapping
            // it in, so a failed upload never leaves a partial GLB in place.
            const tempPath = `${absPath}.reimport-${process.pid}-${Date.now()}`;
            try {
              await writeFile(tempPath, body);
              await rename(tempPath, absPath);
            } finally {
              await unlink(tempPath).catch(() => undefined);
            }

            // Keep loading-progress metadata honest, but never roll back a
            // successful reimport if a hand-authored manifest cannot be updated.
            const manifestUpdated = await updateImportedAssetBytes(meta.path, body.length).catch(
              () => false,
            );

            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: true, path: meta.path, bytes: body.length, manifestUpdated }),
            );
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        // "Open Level": promote an existing public-relative layout JSON to
        // `manifest.editor.defaultScene` so the editor loads + saves it. The
        // editor reloads after this; boot then builds the scene from the new
        // default. Guards: the path must stay inside public/ and exist.
        if (req.url === "/__open-level") {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          try {
            const payload = validateOpenLevelPayload(await readJsonBody(req));
            const targetAbs = resolvePublicPath(payload.path);
            const targetStat = await stat(targetAbs);
            if (!targetStat.isFile()) throw new Error(`not a file: ${payload.path}`);
            const manifest = await readProjectManifest();
            const previousManifest = `${JSON.stringify(manifest, null, 2)}\n`;
            manifest.editor = { ...manifest.editor, defaultScene: payload.path };
            const nextManifest = `${JSON.stringify(manifest, null, 2)}\n`;
            const changed = previousManifest !== nextManifest;
            if (changed) await writeFile(PROJECT_MANIFEST_PATH, nextManifest, "utf8");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, path: payload.path, changed }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
          }
          return;
        }

        if (req.url !== "/__save-layout") {
          next();
          return;
        }

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        try {
          const body = await readJsonBody(req);
          const payload = validateSavePayload(body);
          const submitted =
            body && typeof body === "object" && "layout" in body
              ? (body as { layout: unknown }).layout
              : body;
          const dropped = reportDroppedFields(submitted, payload.layout, "layout");
          const manifest = await readProjectManifest();
          const layoutPath = resolvePublicPath(manifest.editor.defaultScene);
          const previous = await readFile(layoutPath, "utf8").catch(() => null);
          const nextLayout = `${JSON.stringify(payload.layout, null, 2)}\n`;
          await writeFile(layoutPath, nextLayout, "utf8");
          let manifestChanged = false;
          if (payload.editor) {
            const previousManifest = `${JSON.stringify(manifest, null, 2)}\n`;
            manifest.editor = { ...manifest.editor, ...payload.editor };
            const nextManifest = `${JSON.stringify(manifest, null, 2)}\n`;
            manifestChanged = previousManifest !== nextManifest;
            if (manifestChanged) await writeFile(PROJECT_MANIFEST_PATH, nextManifest, "utf8");
          }
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              ok: true,
              path: layoutPath,
              changed: previous !== nextLayout || manifestChanged,
              dropped,
            }),
          );
        } catch (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [layoutEditorPlugin()],
  resolve: {
    alias: {
      // Keep in sync with tsconfig.json "paths"
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@engine": fileURLToPath(new URL("./engine", import.meta.url)),
      "@editor": fileURLToPath(new URL("./editor", import.meta.url)),
      "@builder": fileURLToPath(new URL("./builder", import.meta.url)),
      "@game": fileURLToPath(new URL("./game", import.meta.url)),
      "@project": fileURLToPath(new URL("./project", import.meta.url)),
    },
  },
  build: {
    // Mobile target: WebGL2-capable browsers all support ES2022 baseline features we use.
    target: "es2022",
    // Rapier's compat/WASM runtime is intentionally isolated in vendor-physics
    // and is much larger than the game entry. Keep Vite's global chunk warning
    // above that known lazy chunk while verify:dist guards runtime-only output.
    chunkSizeWarningLimit: 2400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (normalized.includes("/node_modules/three/")) return "vendor-three";
          if (normalized.includes("/node_modules/meshoptimizer/")) return "vendor-meshoptimizer";
          // When Rapier lands, keep its WASM-backed runtime behind the same
          // vendor split pattern instead of folding it into the game entry.
          if (normalized.includes("/node_modules/@dimforge/")) return "vendor-physics";
          return undefined;
        },
      },
    },
  },
  server: {
    // Expose on LAN for real-device (Android/Chrome) testing.
    host: true,
  },
});
