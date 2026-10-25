import { worldCellsInRadius } from "../world/worldGrid";
import { terrainTileWorldSize, tileKey, type WorldTerrainDef } from "./terrainTypes";

/** CDLOD selection in world coordinates; level 0 is one patch over a leaf. */
export type TerrainLodWorld = Pick<WorldTerrainDef, "tileQuads" | "spacing" | "tilesX" | "tilesZ" | "origin">;

export interface TerrainLodOptions {
  patchQuads?: number;
  leafSize?: number;
  range0?: number;
  levels?: number;
  morphStartRatio?: number;
  /** Drawn X/Z footprint; padded legacy tiles can be larger than the authored grid. */
  extent?: readonly [number, number];
}

export interface TerrainLodSettings {
  patchQuads: number;
  leafSize: number;
  range0: number;
  levels: number;
  morphStartRatio: number;
  tileLevel: number;
}

export interface TerrainLodBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Heights relative to world.origin[1]; bounds must contain every child/sample. */
export type TerrainNodeHeights = (level: number, ix: number, iz: number) => { min: number; max: number };
export type TerrainLodVisibility = (box: TerrainLodBox) => boolean;
export type TerrainMorphRange = readonly [start: number, end: number];

/**
 * Track-detail refinement (TERRAIN_DEFORMATION Faz 3, research A5): inside this
 * rectangle a level-0 node may split into up to `levels` finer levels (each
 * halves the vertex spacing; level −k has `leafSize / 2^k` nodes), still by
 * camera distance with the usual doubling ranges. Outside it the selection is
 * unchanged. Rectangle in the selector's world frame (X/Z).
 */
export interface TerrainLodDetail {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  /** Extra levels below 0, at most {@link TERRAIN_LOD_MAX_DETAIL_LEVELS}; 0 turns refinement off. */
  readonly levels: number;
  /** Metres the drawn surface may move off the authored heights here (track depth, berm); widens node boxes. */
  readonly margin?: number;
}

/** Deepest track refinement: 1 m tiles reach 0.125 m, the deformation field's cell. */
export const TERRAIN_LOD_MAX_DETAIL_LEVELS = 3;

export interface TerrainLodNode {
  /** Quadtree level; negative inside a {@link TerrainLodDetail} rectangle. */
  level: number;
  ix: number;
  iz: number;
  offsetX: number;
  offsetZ: number;
  /** Nominal square size. At world edges, the renderer clips to `box`. */
  size: number;
  box: TerrainLodBox;
  morphRange: TerrainMorphRange;
  /** False for a child outside its own range, drawn at its parent's resolution. */
  inRange: boolean;
  /** Fully morphed tile-level nodes already match the global map's grid. */
  needsTileSlot: boolean;
  tileKey: string | null;
}

export function createTerrainLodSettings(world: TerrainLodWorld, options: TerrainLodOptions = {}): TerrainLodSettings {
  const patchQuads = options.patchQuads ?? 32;
  const leafSize = options.leafSize ?? patchQuads * world.spacing;
  const tileSize = terrainTileWorldSize(world);
  const tileLevel = Math.log2(tileSize / leafSize);
  const levels = options.levels ?? Math.max(tileLevel + 2, Math.ceil(Math.log2(Math.max(world.tilesX, world.tilesZ) * tileSize / leafSize)) + 1);
  const range0 = options.range0 ?? 4 * leafSize;
  const morphStartRatio = options.morphStartRatio ?? 0.7;
  if (!Number.isInteger(patchQuads) || patchQuads < 2 || !Number.isInteger(Math.log2(patchQuads)) || patchQuads > world.tileQuads) {
    throw new Error("Terrain LOD patchQuads must be a power of two in 2..tileQuads");
  }
  if (!Number.isFinite(leafSize) || leafSize <= 0 || !Number.isInteger(tileLevel) || tileLevel < 0) {
    throw new Error("Terrain LOD leafSize must divide the tile size by a power of two");
  }
  if (![world.tilesX, world.tilesZ].every((count) => Number.isSafeInteger(count) && count > 0)
    || !Number.isInteger(levels) || levels < tileLevel + 2 || levels > 32) {
    throw new Error("Terrain LOD needs positive tile counts and tileLevel + 2..32 levels (including a global root)");
  }
  if (!Number.isFinite(range0 * 2 ** (levels - 1)) || range0 <= 0 || !(morphStartRatio >= 0 && morphStartRatio < 1)) {
    throw new Error("Terrain LOD ranges must be finite and positive; morphStartRatio must be in [0, 1)");
  }
  return { patchQuads, leafSize, range0, levels, morphStartRatio, tileLevel };
}

/** Non-throwing warning for OPEN_WORLD_PLAN K2's strict 3D diagonal bound. */
export function validateTerrainLodRange(
  settings: Pick<TerrainLodSettings, "leafSize" | "range0">,
  maxRelief: number,
  nodeSize = settings.leafSize,
): string | null {
  if (![settings.leafSize, settings.range0, nodeSize].every((value) => Number.isFinite(value) && value > 0)
    || !Number.isFinite(maxRelief) || maxRelief < 0) {
    return "Terrain LOD range validation needs positive finite sizes/range0 and non-negative finite relief";
  }
  const ratio = settings.range0 / settings.leafSize;
  const minimum = 2 * Math.sqrt(2 + (maxRelief / nodeSize) ** 2);
  return ratio > minimum ? null
    : `Terrain LOD range0/leaf (${ratio}) must be > ${minimum} for H/size = ${maxRelief / nodeSize}; neighbouring LODs may differ by more than 1`;
}

export function terrainLodRanges(settings: Pick<TerrainLodSettings, "range0" | "levels">): number[] {
  return Array.from({ length: settings.levels }, (_, level) => settings.range0 * 2 ** level);
}

/** Matches the spike: end just inside the range, with no morph on the root. */
export function terrainLodMorphRanges(settings: TerrainLodSettings): TerrainMorphRange[] {
  const ranges = terrainLodRanges(settings);
  return ranges.map((range, level) => {
    if (level === settings.levels - 1) return [1e9, 1e9 + 1];
    const previous = level > 0 ? ranges[level - 1]! : 0;
    const end = range * 0.99;
    return [previous + (end - previous) * settings.morphStartRatio, end];
  });
}

/**
 * Morph range of detail level `level` (−1 … −`detailLevels`): the doubling
 * ranges continue below level 0 (`range0 × 2^level`), and the finest detail
 * level starts its morph from 0 the way level 0 does without detail. Level 0
 * keeps its own range, so a node outside the rectangle draws exactly as before.
 */
export function terrainLodDetailMorphRange(
  settings: Pick<TerrainLodSettings, "range0" | "morphStartRatio">,
  level: number,
  detailLevels: number,
): TerrainMorphRange {
  const end = settings.range0 * 2 ** level * 0.99;
  const previous = level > -detailLevels ? settings.range0 * 2 ** (level - 1) : 0;
  return [previous + (end - previous) * settings.morphStartRatio, end];
}

/** Vertex shader's clamped linear factor, using the unmorphed vertex distance. */
export function terrainMorphFactor(distance: number, [start, end]: TerrainMorphRange): number {
  return Math.max(0, Math.min(1, (distance - start) / (end - start)));
}

function boxDistanceSquared(box: TerrainLodBox, camera: readonly [number, number, number]): number {
  const dx = Math.max(box.minX - camera[0], 0, camera[0] - box.maxX);
  const dy = Math.max(box.minY - camera[1], 0, camera[1] - box.maxY);
  const dz = Math.max(box.minZ - camera[2], 0, camera[2] - box.maxZ);
  return dx * dx + dy * dy + dz * dz;
}

export class TerrainLodSelector {
  readonly settings: TerrainLodSettings;
  readonly ranges: readonly number[];
  readonly morphRanges: readonly TerrainMorphRange[];
  readonly extentX: number;
  readonly extentZ: number;

  constructor(
    readonly world: TerrainLodWorld,
    private readonly heights: TerrainNodeHeights,
    options: TerrainLodOptions = {},
  ) {
    this.settings = createTerrainLodSettings(world, options);
    this.ranges = terrainLodRanges(this.settings);
    this.morphRanges = terrainLodMorphRanges(this.settings);
    const tileSize = terrainTileWorldSize(world);
    const [extentX, extentZ] = options.extent ?? [world.tilesX * tileSize, world.tilesZ * tileSize];
    if (![extentX, extentZ].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("Terrain LOD extent must be finite and positive");
    }
    this.extentX = Math.min(extentX, world.tilesX * tileSize);
    this.extentZ = Math.min(extentZ, world.tilesZ * tileSize);
  }

  /** Detail levels (< 0) take their level-0 ancestor's height bounds. */
  nodeBox(level: number, ix: number, iz: number): TerrainLodBox {
    const size = this.settings.leafSize * 2 ** level;
    const height = level < 0
      ? this.heights(0, Math.floor(ix / 2 ** -level), Math.floor(iz / 2 ** -level))
      : this.heights(level, ix, iz);
    return {
      minX: this.world.origin[0] + ix * size,
      minY: this.world.origin[1] + height.min,
      minZ: this.world.origin[2] + iz * size,
      maxX: this.world.origin[0] + Math.min((ix + 1) * size, this.extentX),
      maxY: this.world.origin[1] + height.max,
      maxZ: this.world.origin[2] + Math.min((iz + 1) * size, this.extentZ),
    };
  }

  select(
    camera: readonly [number, number, number],
    visible: TerrainLodVisibility = () => true,
    detail: TerrainLodDetail | null = null,
  ): TerrainLodNode[] {
    const nodes: TerrainLodNode[] = [];
    const { leafSize, levels, tileLevel, range0 } = this.settings;
    const tileSize = terrainTileWorldSize(this.world);
    const width = this.extentX;
    const depth = this.extentZ;
    const detailLevels = detail && [detail.minX, detail.minZ, detail.maxX, detail.maxZ].every(Number.isFinite)
      && detail.maxX > detail.minX && detail.maxZ > detail.minZ
      ? Math.max(0, Math.min(TERRAIN_LOD_MAX_DETAIL_LEVELS, Math.floor(detail.levels))) : 0;
    const margin = detail && Number.isFinite(detail.margin) ? Math.max(0, detail.margin!) : 0;
    const inDetail = (box: TerrainLodBox): boolean => detailLevels > 0
      && box.minX < detail!.maxX && box.maxX > detail!.minX && box.minZ < detail!.maxZ && box.maxZ > detail!.minZ;
    const range = (level: number): number => level >= 0 ? this.ranges[level]! : range0 * 2 ** level;
    const emit = (level: number, ix: number, iz: number, box: TerrainLodBox, inRange: boolean): void => {
      const needsTileSlot = level <= tileLevel && (level < tileLevel || inRange);
      const size = leafSize * 2 ** level;
      nodes.push({
        level, ix, iz, offsetX: box.minX, offsetZ: box.minZ, size, box,
        morphRange: level >= 0 ? this.morphRanges[level]! : terrainLodDetailMorphRange(this.settings, level, detailLevels),
        inRange, needsTileSlot,
        tileKey: needsTileSlot ? tileKey(Math.floor(ix * size / tileSize), Math.floor(iz * size / tileSize)) : null,
      });
    };
    const visit = (level: number, ix: number, iz: number): void => {
      const size = leafSize * 2 ** level;
      if (ix * size >= width || iz * size >= depth) return;
      let box = this.nodeBox(level, ix, iz);
      const refinable = inDetail(box);
      if (refinable && margin > 0) box = { ...box, minY: box.minY - margin, maxY: box.maxY + margin };
      if (!visible(box)) return;
      const distanceSquared = boxDistanceSquared(box, camera);
      const inRange = distanceSquared <= range(level) ** 2;
      // A detail child that misses the rectangle stops at its own level.
      const finest = level <= (refinable ? -detailLevels : 0);
      if (finest || distanceSquared > range(level - 1) ** 2) {
        // Roots always cover the horizon, even outside the finite top range.
        emit(level, ix, iz, box, level === levels - 1 || inRange);
        return;
      }
      for (let child = 0; child < 4; child += 1) {
        visit(level - 1, ix * 2 + (child & 1), iz * 2 + (child >> 1));
      }
    };
    const top = levels - 1;
    const rootSize = leafSize * 2 ** top;
    for (let iz = 0; iz < Math.ceil(depth / rootSize); iz += 1) {
      for (let ix = 0; ix < Math.ceil(width / rootSize); ix += 1) visit(top, ix, iz);
    }
    return nodes;
  }
}

/**
 * Conservative horizontal tile-box distance, independent of camera altitude or
 * visibility. Ordered near to far (ties by Z/X), ready for a loading queue.
 * Radius 4 tiles gives about 67 tiles; the exact count varies within a tile.
 */
export function terrainResidentTileKeys(
  world: TerrainLodWorld,
  settings: TerrainLodSettings,
  camera: readonly [number, number, number],
): string[] {
  const grid = { cellSize: terrainTileWorldSize(world), origin: [world.origin[0], world.origin[2]] as const };
  const radius = settings.range0 * 2 ** settings.tileLevel;
  return worldCellsInRadius(grid, camera[0], camera[2], radius)
    .filter(({ x, z }) => x >= 0 && z >= 0 && x < world.tilesX && z < world.tilesZ)
    .map(({ x, z }) => tileKey(x, z));
}
