export type {
  LayoutCharacter,
  LayoutLightActor,
  LayoutLightType,
  LayoutMetadata,
  LayoutModelInstances,
  LayoutPlacement,
  LayoutTargetPoint,
  LayoutWorldSettings,
  MetadataValue,
  RoomLayout,
  Vec3,
} from "@engine/scene/layout";

export {
  degreesToRadians,
  readPivot,
  readRotation,
  readScale,
} from "@engine/scene/transform";

import type { RoomLayout } from "@engine/scene/layout";
import { readContentJson } from "@/project/contentLoader";
import { readRoomLayout } from "@engine/scene/layoutValidation";
import { ContentLoadError } from "@engine/assets/contentValidation";
import { mergeWorldCells, normalizeWorldCellDocument, worldCellPath } from "@engine/world/worldPartition";

type LegacyReflection = {
  hidden?: boolean;
  intensity?: number;
};

type LegacyReflectionLayout = RoomLayout & {
  reflection?: LegacyReflection;
};

export async function loadRoomLayout(pathOrName: string): Promise<RoomLayout> {
  // A ".json" value is a public-relative path (served by Vite from public/);
  // a bare name resolves to the bundled layouts/ folder.
  const path = pathOrName.endsWith(".json")
    ? pathOrName
    : `layouts/${pathOrName}.json`;
  const level = readRoomLayout(await readContentJson(path), path);
  const cells = await Promise.all((level.worldCells ?? []).map(async (key) => {
    const cellPath = worldCellPath(path, "main", key);
    const raw = await readContentJson(cellPath);
    try {
      const cell = normalizeWorldCellDocument(raw);
      if (cell.key !== key) throw new Error(`expected cell key ${key}, got ${cell.key}`);
      readRoomLayout({ ...cell, name: "cell", loadGroups: [], instances: cell.instances ?? [], characters: cell.characters ?? [] }, cellPath);
      return cell;
    } catch (cause) {
      throw new ContentLoadError(cellPath, "invalid-data", cause instanceof Error ? cause.message : String(cause), { cause });
    }
  }));
  const merged = cells.length ? mergeWorldCells(level, cells) : level;
  delete merged.worldCells;
  return normalizeLoadedRoomLayout(merged);
}

/**
 * Keeps old saved scenes working after the editor-facing Reflection Environment
 * actor moved under Sky Atmosphere as `skyLightCapture`. The legacy field is
 * intentionally dropped from the in-memory layout so the next save writes only
 * the Sky Atmosphere-owned shape.
 */
export function normalizeLoadedRoomLayout(layout: RoomLayout): RoomLayout {
  const legacy = (layout as LegacyReflectionLayout).reflection;
  const legacyIntensity = legacy?.intensity;
  if (legacy && !legacy.hidden && typeof legacyIntensity === "number" && Number.isFinite(legacyIntensity)) {
    layout.skyAtmosphere ??= {};
    layout.skyAtmosphere.skyLightCapture ??= {};
    layout.skyAtmosphere.skyLightCapture.intensity ??= legacyIntensity;
  }
  delete (layout as LegacyReflectionLayout).reflection;
  return layout;
}
