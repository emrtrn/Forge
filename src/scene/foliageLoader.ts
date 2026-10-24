/**
 * Foliage asset loaders (runtime + editor scene load).
 *
 * Two static fetches from `public/`: the per-layout `<layout>.foliage.json`
 * instance sidecar, and the `*.foliagetype.json` Foliage Type assets its groups
 * reference (resolved id → path via the manifest). Both normalize through
 * `engine/scene/foliage` so a malformed/older file degrades gracefully instead of
 * crashing scene boot. Editor-only writes go through `src/editor/foliageStore.ts`.
 */
import type { AssetManifest } from "@engine/assets/manifest";
import { assetPath, assetRecordById } from "@engine/assets/manifest";
import {
  createEmptyFoliageData,
  foliageDataPath,
  normalizeFoliageData,
  normalizeFoliageType,
  type ForgeFoliageTypeDef,
  type LayoutFoliageData,
} from "@engine/scene/foliage";
import {
  foliageCellFootprints,
  foliageCellPath,
  mergeFoliageCells,
  normalizeFoliageCellDocument,
  type FoliageCellDocument,
  type FoliageCellFootprint,
} from "@engine/world/foliageCells";
import { projectFileUrl } from "@/project/ProjectSystem";

/** A level's foliage as one document, plus what its partitioned files looked like. */
export interface LoadedFoliageDocument {
  /** Merged foliage (no `foliageCells`): every painted instance, in cell-key order when partitioned. */
  data: LayoutFoliageData;
  /** Footprints of the cell files the sidecar listed; null for a single, unpartitioned sidecar. */
  cells: FoliageCellFootprint[] | null;
}

/** Fetches the raw sidecar: null when absent or unreadable (no foliage). */
async function fetchFoliageSidecar(scenePath: string): Promise<LayoutFoliageData | null> {
  try {
    const response = await fetch(projectFileUrl(foliageDataPath(scenePath)), { cache: "no-cache" });
    if (!response.ok) return null;
    return normalizeFoliageData(await response.json());
  } catch {
    return null;
  }
}

/** Fetches one listed foliage cell file (OPEN_WORLD_PLAN Faz 6 F2); throws with its path on failure. */
export async function fetchFoliageCell(scenePath: string, key: string): Promise<FoliageCellDocument> {
  const path = foliageCellPath(scenePath, key);
  try {
    const response = await fetch(projectFileUrl(path), { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const cell = normalizeFoliageCellDocument(await response.json());
    if (cell.key !== key) throw new Error(`file holds cell ${cell.key}`);
    return cell;
  } catch (error) {
    throw new Error(`[foliage] cell ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Loads a level's foliage and merges the cell files a partitioned sidecar lists.
 * `missingCells: "throw"` (the editor) fails the load on an unreadable cell, so a
 * later Save can never write over instances it did not read; `"skip"` (Play)
 * warns and leaves that cell's foliage out.
 */
export async function loadFoliageDocument(
  scenePath: string,
  missingCells: "throw" | "skip" = "throw",
): Promise<LoadedFoliageDocument> {
  const sidecar = await fetchFoliageSidecar(scenePath);
  if (!sidecar) return { data: createEmptyFoliageData(), cells: null };
  if (!sidecar.foliageCells) return { data: sidecar, cells: null };
  const results = await Promise.allSettled(sidecar.foliageCells.map((key) => fetchFoliageCell(scenePath, key)));
  const cells: FoliageCellDocument[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") cells.push(result.value);
    else if (missingCells === "throw") throw result.reason;
    else console.warn(String(result.reason instanceof Error ? result.reason.message : result.reason));
  }
  return { data: mergeFoliageCells(sidecar, cells), cells: foliageCellFootprints(cells) };
}

/** Loads a level's foliage as one merged document; empty when there is none (Play: unreadable cells skipped). */
export async function loadFoliageData(scenePath: string): Promise<LayoutFoliageData> {
  return (await loadFoliageDocument(scenePath, "skip")).data;
}

/** Loads a single Foliage Type asset from its public-relative path; null on failure. */
export async function loadFoliageTypeByPath(path: string): Promise<ForgeFoliageTypeDef | null> {
  try {
    const response = await fetch(projectFileUrl(path), { cache: "no-cache" });
    if (!response.ok) return null;
    return normalizeFoliageType(await response.json());
  } catch {
    return null;
  }
}

/**
 * Loads every Foliage Type referenced by a foliage sidecar, keyed by asset id.
 * Types whose asset is missing from the manifest or fails to load are omitted;
 * the render binding then skips those groups (a missing type = nothing drawn).
 */
export async function loadFoliageTypesForData(
  data: LayoutFoliageData,
  manifest: AssetManifest,
): Promise<Map<string, ForgeFoliageTypeDef>> {
  const ids = new Set([
    ...data.groups.map((group) => group.foliageTypeId),
    ...(data.landscapeRules ?? []).map((rule) => rule.foliageTypeId),
  ]);
  const map = new Map<string, ForgeFoliageTypeDef>();
  await Promise.all(
    [...ids].map(async (id) => {
      const record = assetRecordById(manifest, id);
      if (!record) return;
      const type = await loadFoliageTypeByPath(assetPath(record));
      if (type) map.set(id, type);
    }),
  );
  return map;
}
