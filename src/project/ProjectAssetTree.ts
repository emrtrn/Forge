import type { ForgeMaterialPreset } from "@engine/assets/material";
import type { ParticleEffectPreset } from "@engine/vfx/particleEffectPresets";

export interface ProjectDirNode {
  name: string;
  path: string;
  type: "dir" | "file";
  ext?: string;
  size?: number;
  children?: ProjectDirNode[];
}

export interface ProjectDirResponse {
  root: string;
  children: ProjectDirNode[];
}

export async function fetchProjectDir(projectPath: string): Promise<ProjectDirResponse> {
  const normalized = normalizeProjectPath(projectPath);
  const response = await fetch(`/__project-dir/${encodeURIComponent(normalized)}`);
  if (!response.ok) {
    throw new Error(`Project directory failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as ProjectDirResponse;
}

export function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function flattenProjectFiles(nodes: readonly ProjectDirNode[]): ProjectDirNode[] {
  const files: ProjectDirNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      files.push(node);
    } else if (node.children) {
      files.push(...flattenProjectFiles(node.children));
    }
  }
  return files;
}

export function findProjectDir(
  nodes: readonly ProjectDirNode[],
  path: string,
): ProjectDirNode | null {
  const normalized = normalizeProjectPath(path);
  for (const node of nodes) {
    if (node.path === normalized && node.type === "dir") return node;
    if (node.children) {
      const match = findProjectDir(node.children, normalized);
      if (match) return match;
    }
  }
  return null;
}

export function isModelFile(node: ProjectDirNode): boolean {
  return node.type === "file" && (node.ext === "glb" || node.ext === "gltf");
}

/** Content Browser "new content" kinds the `/__content-new` endpoint can create. */
export type ContentNewKind =
  | "folder"
  | "level"
  | "material"
  | "particle"
  | "script"
  | "sound"
  | "soundCue"
  | "dialogueVoice"
  | "dialogueLine"
  | "ui"
  | "blackboard"
  | "behaviorTree"
  | "aiQuery"
  | "stateTree";

/** Parent class picked for a `kind: "script"` Actor Script (Unreal-style). */
export type ScriptParentClass =
  | "actor"
  | "pawn"
  | "character"
  | "playerController"
  | "gameMode";

export interface ContentNewRequest {
  kind: ContentNewKind;
  /** Public-root-relative directory the new folder/file is created inside. */
  dir: string;
  /** User-entered base name (sanitized server-side). */
  name: string;
  /** For `kind: "script"`, the picked Actor Script parent class. */
  parentClass?: ScriptParentClass;
  /** For `kind: "material"`, the initial material template. */
  materialPreset?: ForgeMaterialPreset;
  /** For `kind: "particle"`, the picked VFX Lite starter preset. */
  particlePreset?: ParticleEffectPreset;
}

/**
 * Creates a folder or a typed stub asset under `dir`. Hits the localhost-only
 * `/__content-new` dev endpoint; returns the created public-relative path.
 */
export async function createProjectContent(
  request: ContentNewRequest,
): Promise<{ path: string; registeredId: string | null }> {
  const response = await fetch("/__content-new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    path?: string;
    registeredId?: string | null;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? `Create failed: ${response.status} ${response.statusText}`);
  }
  return { path: data.path ?? "", registeredId: data.registeredId ?? null };
}

/**
 * Uploads a single file into `dir` via the localhost-only `/__import-asset`
 * endpoint. The raw bytes are the POST body; target dir + filename ride the
 * query string. Returns the created public-relative path.
 */
export async function importProjectAsset(
  dir: string,
  file: File,
): Promise<{ path: string; registeredId: string | null }> {
  const query = `dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`;
  const response = await fetch(`/__import-asset?${query}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    path?: string;
    registeredId?: string | null;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? `Import failed: ${response.status} ${response.statusText}`);
  }
  return { path: data.path ?? "", registeredId: data.registeredId ?? null };
}

/**
 * Replaces an existing GLB/GLTF at its current public-relative path. Unlike
 * import, this intentionally retains the existing manifest record and asset id
 * so placed instances do not need to be recreated after a Blender export.
 */
export async function reimportProjectAsset(
  path: string,
  file: File,
): Promise<{ path: string; bytes: number }> {
  const query = `path=${encodeURIComponent(path)}&name=${encodeURIComponent(file.name)}`;
  const response = await fetch(`/__reimport-asset?${query}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    path?: string;
    bytes?: number;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? `Reimport failed: ${response.status} ${response.statusText}`);
  }
  return { path: data.path ?? path, bytes: data.bytes ?? file.size };
}

/**
 * Promotes an existing layout JSON to the project's active scene via the
 * localhost-only `/__open-level` endpoint: it rewrites
 * `project.3dgame.json` `editor.defaultScene` to `path`, so the editor loads
 * and saves that level. Callers reload the editor afterwards to rebuild the
 * scene from the new default. Returns the stored path and whether the manifest
 * actually changed.
 */
export async function openProjectLevel(
  path: string,
): Promise<{ path: string; changed: boolean }> {
  const response = await fetch("/__open-level", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    path?: string;
    changed?: boolean;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? `Open level failed: ${response.status} ${response.statusText}`);
  }
  return { path: data.path ?? path, changed: Boolean(data.changed) };
}

/**
 * Renames a single asset file or folder via the localhost-only
 * `/__content-rename` endpoint. For files, `name` is the new base name (no
 * extension); the server preserves the file's extension chain and repoints the
 * manifest entry. For folders, descendants keep their relative paths while
 * manifest/default-scene/path references are rewritten.
 */
export async function renameProjectContent(
  path: string,
  name: string,
): Promise<{ path: string; registered: boolean; kind: "file" | "folder" }> {
  const response = await fetch("/__content-rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, name }),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    path?: string;
    registered?: boolean;
    kind?: "file" | "folder";
    error?: string;
  } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? `Rename failed: ${response.status} ${response.statusText}`);
  }
  return {
    path: data.path ?? "",
    registered: Boolean(data.registered),
    kind: data.kind ?? "file",
  };
}

/**
 * Deletes a single asset file or folder via the localhost-only
 * `/__content-delete` endpoint. Folder deletes remove descendant manifest
 * entries and scrub layout references to the removed asset ids / class paths.
 */
export async function deleteProjectContent(
  path: string,
): Promise<{
  path: string;
  registered: boolean;
  kind: "file" | "folder";
  deletedFiles: number;
  removedAssets: number;
  cleanedLayouts: number;
  preservedLevelData: string[];
}> {
  const response = await fetch("/__content-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    path?: string;
    registered?: boolean;
    kind?: "file" | "folder";
    deletedFiles?: number;
    removedAssets?: number;
    cleanedLayouts?: number;
    preservedLevelData?: string[];
    error?: string;
  } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? `Delete failed: ${response.status} ${response.statusText}`);
  }
  return {
    path: data.path ?? "",
    registered: Boolean(data.registered),
    kind: data.kind ?? "file",
    deletedFiles: data.deletedFiles ?? 1,
    removedAssets: data.removedAssets ?? (data.registered ? 1 : 0),
    cleanedLayouts: data.cleanedLayouts ?? 0,
    preservedLevelData: data.preservedLevelData ?? [],
  };
}

export type ContentTransferOperation = "copy" | "move";

/**
 * Copies or moves one Content Browser file into an existing project folder.
 * Copy creates a distinct manifest identity when the source is registered;
 * move preserves the source identity so placed instances keep resolving.
 */
export async function transferProjectContent(
  source: string,
  destinationDir: string,
  operation: ContentTransferOperation,
): Promise<{ path: string; registered: boolean; registeredId: string | null }> {
  const response = await fetch("/__content-transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, destinationDir, operation }),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    path?: string;
    registered?: boolean;
    registeredId?: string | null;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? `Content ${operation} failed: ${response.status} ${response.statusText}`);
  }
  return {
    path: data.path ?? "",
    registered: Boolean(data.registered),
    registeredId: data.registeredId ?? null,
  };
}
