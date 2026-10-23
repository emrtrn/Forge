import { normalizeWorldTerrain } from "../engine/terrain/terrainDefinition";
import { decodeTerrainGlobalMap } from "../engine/terrain/terrainGlobalMapFile";
export { TERRAIN_GLOBAL_BODY_MAX_BYTES } from "../engine/terrain/terrainGlobalMapFile";
import { decodeTerrainTile, terrainTileByteLength } from "../engine/terrain/terrainTileCodec";
import { parseTileKey, terrainGlobalMapPath, terrainTilePath, TERRAIN_MAX_TILES_PER_AXIS, type WorldTerrainDef } from "../engine/terrain/terrainTypes";

export const TERRAIN_JSON_BODY_MAX_BYTES = 4 * 1024 * 1024;
export const TERRAIN_TILE_BODY_MAX_BYTES = terrainTileByteLength(513, 8, "f32");

export function validateTerrainPath(value: unknown): string {
  if (typeof value !== "string" || !value.endsWith(".terrain.json") ||
      /[\\:%?#\u0000-\u001f<>"|*]/.test(value) ||
      value.split("/").some((part) => !part || part === "." || part === ".." || part.endsWith(".") || part.endsWith(" ")) || value.includes("..")) {
    throw new Error("invalid public-relative .terrain.json path");
  }
  return value;
}

export function validateSaveTerrainPayload(value: unknown): { path: string; terrain: WorldTerrainDef } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("terrain payload must be an object");
  const input = value as Record<string, unknown>;
  return { path: validateTerrainPath(input.path), terrain: normalizeWorldTerrain(input.terrain) };
}

/** Tile destinations are derived, never a client filename; definition commit cross-checks every tile. */
export function validateSaveTerrainTile(path: unknown, key: string, bytes: Uint8Array): string {
  const defPath = validateTerrainPath(path);
  const target = terrainTilePath(defPath, key);
  const coord = parseTileKey(key)!;
  const tile = decodeTerrainTile(bytes);
  if (coord.x >= TERRAIN_MAX_TILES_PER_AXIS || coord.z >= TERRAIN_MAX_TILES_PER_AXIS ||
      tile.x !== coord.x || tile.z !== coord.z || !tile.heights.every(Number.isFinite) ||
      tile.heights.some((height) => height < tile.heightMin - 1e-4 || height > tile.heightMax + 1e-4)) {
    throw new Error("tile header, coordinates or heights invalid");
  }
  return target;
}

/** The new definition may not exist yet (create/expand); commit checks its shape. */
export function validateSaveTerrainGlobal(path: unknown, bytes: Uint8Array): string {
  const target = terrainGlobalMapPath(validateTerrainPath(path));
  decodeTerrainGlobalMap(bytes);
  return target;
}
