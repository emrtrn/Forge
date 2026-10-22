import { publicFileUrl } from "./publicUrl";

export interface ProjectManifest {
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
    /** Optional project-relative path to a gameplay metadata schema (Details panel). */
    metadataSchema?: string;
    /** Optional URL of the project's runtime dev server, opened by Play/Test (P). */
    previewUrl?: string;
    gridSize?: number;
    gridEnabled?: boolean;
    snapRotationDeg?: number;
    snapRotationEnabled?: boolean;
    snapScale?: number;
    snapScaleEnabled?: boolean;
  };
  scripts: {
    preview?: string;
    build?: string;
    package?: string;
  };
  output: {
    distDir: string;
  };
}

export interface ActiveProject {
  manifest: ProjectManifest;
  manifestPath: string;
  rootName: string;
}

let activeProjectPromise: Promise<ActiveProject> | null = null;

/**
 * Loads this project's manifest. Single-codebase template: the manifest is a
 * static file bundled in `public/`, fetched directly (works in dev and in the
 * packaged game) — no external-project dev middleware involved.
 */
export async function loadActiveProject(): Promise<ActiveProject> {
  activeProjectPromise ??= fetch(projectFileUrl("project.3dgame.json")).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Project manifest failed: ${response.status} ${response.statusText}`);
    }
    const manifest = (await response.json()) as ProjectManifest;
    return {
      manifest,
      manifestPath: "project.3dgame.json",
      rootName: manifest.name,
    };
  });
  return activeProjectPromise;
}

/**
 * Authored paths stay relative to public/. The deployment base belongs to the
 * build, so the same project data works at / and at a configured subpath.
 */
export function projectFileUrl(publicRelativePath: string): string {
  // Node-side engine tools also use the loaders, without Vite's env injection.
  return publicFileUrl(publicRelativePath, import.meta.env?.BASE_URL ?? "/");
}

export function projectPublicFileUrl(
  _manifest: ProjectManifest,
  publicRelativePath: string,
): string {
  // Manifest paths are already relative to the public root in the single
  // codebase, so publicDir no longer needs to be prepended.
  return projectFileUrl(publicRelativePath);
}

export function dirnameProjectPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : "";
}
