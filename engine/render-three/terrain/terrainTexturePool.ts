import {
  ClampToEdgeWrapping,
  DataArrayTexture,
  DataTexture,
  FloatType,
  LinearFilter,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  UnsignedByteType,
  type Texture,
} from "three";

import type { TerrainDirtyRect } from "@engine/terrain/terrainEdit";
import type { TerrainGlobalMap } from "@engine/terrain/terrainGlobalMap";
import { TerrainSlotPool } from "@engine/terrain/terrainSlotPool";
import { terrainWeightBlockCount, tileKey, type TerrainTileData } from "@engine/terrain/terrainTypes";

/**
 * GPU residency for World Terrain tiles (OPEN_WORLD_PLAN K2, Faz 2): resident
 * tiles' heights and RGBA8 paint weights live in fixed-size `DataArrayTexture`
 * layers, one layer per slot (weights: `weightBlocks` layers per slot), plus a
 * small always-resident global height map for nodes coarser than a tile.
 *
 * Heights are `R32F` metres, read unfiltered with `texelFetch` (the shader
 * interpolates by hand): no float-linear extension, and the editor's float
 * heights reach the GPU bit-for-bit — the same surface the collider uses.
 * Weights are filterable `RGBA8`.
 *
 * Uploads go through three's `addLayerUpdate`, so a tile load or an edit
 * re-sends only that slot's layers (S3: ~0.34 ms per 257² tile).
 */
export class TerrainTexturePool {
  readonly heights: DataArrayTexture;
  readonly weights: DataArrayTexture;
  readonly globalHeights: DataTexture;
  readonly weightBlocks: number;
  private readonly slots: TerrainSlotPool;
  private readonly heightData: Float32Array;
  private readonly weightData: Uint8Array;
  private readonly texels: number;

  constructor(
    /** Vertices per tile side (`tileQuads + 1`). */
    readonly size: number,
    readonly capacity: number,
    layerCount: number,
    private readonly global: TerrainGlobalMap,
  ) {
    if (!Number.isSafeInteger(size) || size < 2) throw new Error("Terrain texture pool needs a tile size of at least 2");
    this.slots = new TerrainSlotPool(capacity);
    this.texels = size * size;
    // An unpainted terrain still binds one (zero) weight layer per slot.
    this.weightBlocks = Math.max(1, terrainWeightBlockCount(layerCount));
    this.heightData = new Float32Array(this.texels * capacity);
    this.weightData = new Uint8Array(this.texels * 4 * capacity * this.weightBlocks);
    this.heights = new DataArrayTexture(this.heightData, size, size, capacity);
    configureTexture(this.heights, RedFormat, FloatType, NearestFilter);
    this.weights = new DataArrayTexture(this.weightData, size, size, capacity * this.weightBlocks);
    configureTexture(this.weights, RGBAFormat, UnsignedByteType, LinearFilter);
    this.globalHeights = new DataTexture(new Float32Array(global.width * global.height), global.width, global.height);
    configureTexture(this.globalHeights, RedFormat, FloatType, NearestFilter);
    this.updateGlobal();
  }

  get resident(): number {
    return this.slots.size;
  }

  /** Slot holding a tile's data, or -1 when it is not resident. */
  slotOf(x: number, z: number): number {
    return this.slots.slotOf(tileKey(x, z)) ?? -1;
  }

  /**
   * Makes a tile resident (a cached slot skips the upload). Returns its slot,
   * or -1 when every slot is in active use.
   */
  acquire(tile: TerrainTileData): number {
    if (tile.size !== this.size) throw new Error(`Terrain tile ${tileKey(tile.x, tile.z)} is ${tile.size}² but the pool holds ${this.size}²`);
    const acquired = this.slots.acquire(tileKey(tile.x, tile.z));
    if (!acquired) return -1;
    if (!acquired.cached) this.writeTile(acquired.slot, tile);
    return acquired.slot;
  }

  /** Keeps the data cached until slot pressure evicts it. */
  release(x: number, z: number): void {
    this.slots.release(tileKey(x, z));
  }

  /**
   * Re-sends an edited resident tile. `rect` narrows the CPU copy; the GPU
   * upload is still the slot's whole layer (three uploads layers, not rects).
   */
  update(tile: TerrainTileData, rect?: TerrainDirtyRect): void {
    const slot = this.slots.slotOf(tileKey(tile.x, tile.z));
    if (slot === undefined) return;
    this.writeTile(slot, tile, rect);
  }

  /** Copies the CPU global map into its texture (call after `updateTerrainGlobalMap`). */
  updateGlobal(): void {
    (this.globalHeights.image.data as Float32Array).set(this.global.heights);
    this.globalHeights.needsUpdate = true;
  }

  dispose(): void {
    this.heights.dispose();
    this.weights.dispose();
    this.globalHeights.dispose();
  }

  private writeTile(slot: number, tile: TerrainTileData, rect?: TerrainDirtyRect): void {
    const { size, texels } = this;
    const x0 = rect ? Math.max(0, rect.x0) : 0;
    const z0 = rect ? Math.max(0, rect.z0) : 0;
    const x1 = rect ? Math.min(size - 1, rect.x1) : size - 1;
    const z1 = rect ? Math.min(size - 1, rect.z1) : size - 1;
    if (x0 > x1 || z0 > z1) return;
    const blocks = Math.min(this.weightBlocks, terrainWeightBlockCount(tile.layerCount));
    for (let z = z0; z <= z1; z += 1) {
      const row = z * size;
      this.heightData.set(tile.heights.subarray(row + x0, row + x1 + 1), slot * texels + row + x0);
      for (let block = 0; block < this.weightBlocks; block += 1) {
        const target = ((slot * this.weightBlocks + block) * texels + row + x0) * 4;
        if (block < blocks) {
          const from = (block * texels + row + x0) * 4;
          this.weightData.set(tile.weights.subarray(from, from + (x1 - x0 + 1) * 4), target);
        } else {
          this.weightData.fill(0, target, target + (x1 - x0 + 1) * 4);
        }
      }
    }
    this.heights.addLayerUpdate(slot);
    this.heights.needsUpdate = true;
    for (let block = 0; block < this.weightBlocks; block += 1) this.weights.addLayerUpdate(slot * this.weightBlocks + block);
    this.weights.needsUpdate = true;
  }
}

function configureTexture(
  texture: Texture,
  format: typeof RedFormat | typeof RGBAFormat,
  type: typeof FloatType | typeof UnsignedByteType,
  filter: typeof NearestFilter | typeof LinearFilter,
): void {
  texture.format = format;
  texture.type = type;
  texture.minFilter = filter;
  texture.magFilter = filter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
}
