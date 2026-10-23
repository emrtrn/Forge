import { levelTerrainDir, TERRAIN_DEF_SUFFIX } from "../engine/terrain/terrainTypes";

const TILES_DIR_SUFFIX = ".tiles";

export interface TerrainOrphan {
  /** Public-relative definition path the files belong to (may already be missing on disk). */
  definition: string;
  /** Public-relative entries of the level terrain folder to remove: the definition and/or its `.tiles` folder. */
  entries: string[];
}

/**
 * Level-owned terrain the saved layout no longer references. A deleted Landscape
 * only leaves the layout; its `<level>.landscapes/<id>.terrain.json` and tiles stay
 * on disk until this runs after the level is saved. `entryNames` is the folder's
 * listing; anything that is not a definition or tile folder is left alone.
 */
export function findOrphanedLevelTerrain(
  scenePath: string,
  dataRefs: readonly string[],
  entryNames: readonly string[],
): TerrainOrphan[] {
  const dir = levelTerrainDir(scenePath);
  const referenced = new Set(dataRefs);
  const byDefinition = new Map<string, string[]>();
  for (const name of entryNames) {
    const id = name.endsWith(TERRAIN_DEF_SUFFIX)
      ? name.slice(0, -TERRAIN_DEF_SUFFIX.length)
      : name.endsWith(TILES_DIR_SUFFIX) ? name.slice(0, -TILES_DIR_SUFFIX.length) : "";
    if (!id) continue;
    const definition = `${dir}/${id}${TERRAIN_DEF_SUFFIX}`;
    if (referenced.has(definition)) continue;
    const entries = byDefinition.get(definition) ?? [];
    entries.push(`${dir}/${name}`);
    byDefinition.set(definition, entries);
  }
  return [...byDefinition].map(([definition, entries]) => ({ definition, entries: entries.sort() }));
}

/** Every string value in a parsed JSON document; another level can still point at an orphan candidate. */
export function collectJsonStrings(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string") into.add(value);
  else if (Array.isArray(value)) for (const item of value) collectJsonStrings(item, into);
  else if (value && typeof value === "object") for (const child of Object.values(value)) collectJsonStrings(child, into);
  return into;
}
