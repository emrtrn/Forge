/**
 * Terrain regions kept loaded in the editor (World Partition panel, OPEN_WORLD_PLAN
 * Faz 8), remembered per terrain definition so a reload streams them in again.
 *
 * Like the viewport pose (`editorCameraPose.ts`) this is a per-machine authoring
 * preference in `localStorage`, never level data: keeping tiles loaded must not
 * dirty the level, and a teammate's checkout starts with none.
 */

const STORAGE_PREFIX = "forge.editor.keptTerrainTiles.";
const TILE_KEY = /^\d+_\d+$/;

/** Tile keys from stored JSON; anything malformed reads as none. */
export function parseKeptTerrainTiles(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((key): key is string => typeof key === "string" && TILE_KEY.test(key)))];
  } catch {
    return [];
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export class KeptTerrainTilesStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = browserStorage()) {}

  /** Kept tile keys for the terrain at `terrainPath` (public-root relative). */
  read(terrainPath: string): string[] {
    try {
      return parseKeptTerrainTiles(this.storage?.getItem(STORAGE_PREFIX + encodeURIComponent(terrainPath)) ?? null);
    } catch {
      return [];
    }
  }

  write(terrainPath: string, keys: readonly string[]): void {
    try {
      const key = STORAGE_PREFIX + encodeURIComponent(terrainPath);
      if (keys.length === 0) this.storage?.removeItem(key);
      else this.storage?.setItem(key, JSON.stringify([...keys].sort()));
    } catch {
      // Storage full or blocked (private window): the region stays kept for this session only.
    }
  }
}
