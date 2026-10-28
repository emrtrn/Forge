import { COLLIDER_COMPONENT, TRANSFORM_COMPONENT, type ColliderComponent, type ColliderPrimitive } from "../scene/components";
import type { Entity, EntityComponentData } from "../scene/entity";
import type { LayoutLandscape, Vec3 } from "../scene/layout";
import type { WorldTerrainDocument } from "./terrainLoader";
import { parseTileKey, terrainTileWorldBounds, terrainTileWorldSize, type TerrainTileData, type WorldTerrainDef } from "./terrainTypes";

/**
 * A Landscape actor references a World Terrain (OPEN_WORLD_PLAN Faz 2, one
 * tile or many): it is drawn straight from its tiles, collides per tile and is
 * sculpted/painted in the editor through `terrainEdit.ts`.
 *
 * Frame: `def.origin` is the world position of tile (0, 0)'s min corner at the
 * height datum, and the actor sits at the centre of the whole tile grid
 * (`origin = position − half extent`). A World Terrain has no rotation.
 */

type TerrainFrameDef = Pick<WorldTerrainDef, "tileQuads" | "spacing" | "tilesX" | "tilesZ" | "origin">;

/** True unless the document is exactly one (0, 0) tile (the single-tile tools: resample, resize, Expand). */
export function isMultiTileTerrain(def: Pick<WorldTerrainDef, "tilesX" | "tilesZ" | "tiles">): boolean {
  return def.tilesX !== 1 || def.tilesZ !== 1 || def.tiles.length !== 1 || def.tiles[0]!.key !== "0_0";
}

/** World X/Z edge lengths of the whole tile grid (holes included). */
export function worldTerrainExtent(def: Omit<TerrainFrameDef, "origin">): [number, number] {
  const size = terrainTileWorldSize(def);
  return [def.tilesX * size, def.tilesZ * size];
}

/** The actor position of a World Terrain: the grid centre at the height datum. */
export function worldTerrainActorPosition(def: TerrainFrameDef): Vec3 {
  const [width, depth] = worldTerrainExtent(def);
  return [def.origin[0] + width / 2, def.origin[1], def.origin[2] + depth / 2];
}

/**
 * Differences between an actor's authored placement and its definition. The
 * definition wins: the editor snaps the actor onto it and the runtime ignores
 * the actor transform, so a stale level cannot draw the terrain somewhere its
 * collider is not.
 */
export function worldTerrainPlacementIssues(actor: Pick<LayoutLandscape, "position" | "rotation">, def: TerrainFrameDef): string[] {
  const issues: string[] = [];
  const expected = worldTerrainActorPosition(def);
  if (expected.some((value, axis) => Math.abs(value - actor.position[axis]!) > 1e-4)) {
    issues.push(`position [${actor.position.join(", ")}] differs from the terrain definition centre [${expected.join(", ")}]`);
  }
  if (actor.rotation?.some((value) => value !== 0)) issues.push("World Terrain cannot be rotated; rotation is ignored");
  return issues;
}

/**
 * One tile as a heightfield collider primitive (OPEN_WORLD_PLAN Faz 3), in the
 * frame centred on the tile at the height datum. Quads split along the same
 * b–c diagonal as the renderer and `terrainHeightAt` (K3a). The tile's height
 * array is shared, not copied, so the tile must not be edited while a body
 * uses it (runtime tiles never are).
 */
export function terrainTileHeightfield(
  def: Pick<WorldTerrainDef, "tileQuads" | "spacing" | "origin">,
  tile: TerrainTileData,
): { translation: Vec3; primitive: ColliderPrimitive & { center: Vec3 } } {
  const quads = tile.size - 1;
  const extent = quads * def.spacing;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const height of tile.heights) {
    if (height < minY) minY = height;
    if (height > maxY) maxY = height;
  }
  const bounds = terrainTileWorldBounds(def, tile.x, tile.z);
  return {
    translation: [(bounds.minX + bounds.maxX) / 2, def.origin[1], (bounds.minZ + bounds.maxZ) / 2],
    primitive: {
      shape: "heightfield",
      size: [extent, maxY - minY, extent],
      center: [0, (minY + maxY) / 2, 0],
      heightfield: { quadsX: quads, quadsZ: quads, spacing: def.spacing, heights: tile.heights },
    },
  };
}

/** Entity id of one tile's collider: `landscape:<actor id>:<tile key>`. */
export function worldTerrainColliderEntityId(actorId: string, key: string): string {
  return `landscape:${actorId}:${key}`;
}

/**
 * Landscape actor id behind a terrain collider entity — a tile collider
 * (`landscape:<actor id>:<tile key>`) or a 1×1 Landscape (`landscape:<actor id>`);
 * `null` for any other entity.
 */
export function landscapeColliderActorId(entityId: string): string | null {
  if (!entityId.startsWith("landscape:")) return null;
  const rest = entityId.slice("landscape:".length);
  const split = rest.lastIndexOf(":");
  return split >= 0 && parseTileKey(rest.slice(split + 1)) ? rest.slice(0, split) : rest;
}

/**
 * Static collider entities for a collidable World Terrain actor, one per
 * existing tile (holes get none). Callers pass the actor's resolved collision
 * flag, the toggle the Details panel edits.
 */
export function worldTerrainColliderEntities(
  actor: Pick<LayoutLandscape, "id"> & { name: string; collision: boolean },
  { def, tiles }: WorldTerrainDocument,
): Entity[] {
  if (!actor.collision) return [];
  const entities: Entity[] = [];
  for (const { key } of def.tiles) {
    const tile = tiles.get(key);
    if (!tile || !parseTileKey(key)) continue;
    const { translation, primitive } = terrainTileHeightfield(def, tile);
    const collider: ColliderComponent = {
      shape: "box",
      size: [...primitive.size],
      center: [...primitive.center],
      isStatic: true,
      isSensor: false,
      navigationRole: "walkable",
      primitives: [primitive],
    };
    entities.push({
      id: worldTerrainColliderEntityId(actor.id, key),
      name: `${actor.name} Collider ${key}`,
      components: {
        [TRANSFORM_COMPONENT]: { position: translation, rotation: [0, 0, 0], scale: [1, 1, 1] },
        [COLLIDER_COMPONENT]: collider as unknown as EntityComponentData,
      },
    });
  }
  return entities;
}
