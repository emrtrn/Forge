import {
  ClampToEdgeWrapping,
  DataArrayTexture,
  DataTexture,
  DataUtils,
  FloatType,
  HalfFloatType,
  LinearFilter,
  RedFormat,
  RGBAFormat,
  UnsignedByteType,
  UnsignedShortType,
  type Texture,
  type WebGLRenderer,
} from "three";

/**
 * Residency slot pool (spike of `engine/render-three/terrain/terrainTexturePool.ts`):
 * fixed-size `DataArrayTexture`s holding resident tiles' heights and RGBA8
 * paint weights, one layer per slot, filled with `addLayerUpdate`.
 *
 * Heights are uploaded normalized (0..1 over the world's height range).
 * Preferred format is `R16` (EXT_texture_norm16): the tile file's Uint16
 * samples upload as-is, filterable, 2 bytes/texel. Fallbacks: `R32F` when
 * float textures are filterable (4 bytes/texel), else `R16F` (≈0.5 m steps
 * over a 1 km range — visibly lossy, reported in the HUD).
 */

export type HeightTextureFormat = "r16-norm" | "r32f" | "r16f";

export function pickHeightFormat(renderer: WebGLRenderer): HeightTextureFormat {
  const forced = new URLSearchParams(location.search).get("heightFormat");
  if (forced === "r16-norm" || forced === "r32f" || forced === "r16f") return forced;
  if (renderer.extensions.has("EXT_texture_norm16")) return "r16-norm";
  if (renderer.extensions.has("OES_texture_float_linear")) return "r32f";
  return "r16f";
}

export function heightBytesPerTexel(format: HeightTextureFormat): number {
  return format === "r32f" ? 4 : 2;
}

type HeightArray = Uint16Array | Float32Array;

function allocHeights(format: HeightTextureFormat, length: number): HeightArray {
  return format === "r32f" ? new Float32Array(length) : new Uint16Array(length);
}

/** Copies Uint16 tile samples into `target` at `offset`, converting per format. */
function writeHeights(format: HeightTextureFormat, target: HeightArray, offset: number, source: Uint16Array): void {
  if (format === "r16-norm") {
    (target as Uint16Array).set(source, offset);
    return;
  }
  if (format === "r32f") {
    const out = target as Float32Array;
    for (let i = 0; i < source.length; i += 1) out[offset + i] = source[i]! / 65535;
    return;
  }
  const out = target as Uint16Array;
  for (let i = 0; i < source.length; i += 1) out[offset + i] = DataUtils.toHalfFloat(source[i]! / 65535);
}

function configureHeightTexture(texture: Texture, format: HeightTextureFormat): void {
  texture.format = RedFormat;
  texture.type = format === "r32f" ? FloatType : format === "r16f" ? HalfFloatType : UnsignedShortType;
  texture.normalized = format === "r16-norm";
  configureLinear(texture);
}

function configureLinear(texture: Texture): void {
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
}

export function createGlobalHeightTexture(format: HeightTextureFormat, size: number, heights: Uint16Array): DataTexture {
  const data = allocHeights(format, size * size);
  writeHeights(format, data, 0, heights);
  const texture = new DataTexture(data, size, size);
  configureHeightTexture(texture, format);
  texture.needsUpdate = true;
  return texture;
}

export function createGlobalWeightTexture(size: number, weights: Uint8Array): DataTexture {
  const texture = new DataTexture(weights, size, size, RGBAFormat, UnsignedByteType);
  configureLinear(texture);
  texture.needsUpdate = true;
  return texture;
}

export interface SlotUploadTiming {
  copyMs: number;
  uploadMs: number;
}

export class TerrainTexturePool {
  readonly heights: DataArrayTexture;
  readonly weights: DataArrayTexture;
  private readonly heightData: HeightArray;
  private readonly weightData: Uint8Array;
  private readonly owner: (number | null)[];
  private readonly slotOf = new Map<number, number>();
  private readonly texelsPerLayer: number;

  constructor(
    readonly format: HeightTextureFormat,
    readonly slots: number,
    readonly size: number,
  ) {
    this.texelsPerLayer = size * size;
    this.heightData = allocHeights(format, this.texelsPerLayer * slots);
    this.weightData = new Uint8Array(this.texelsPerLayer * 4 * slots);
    this.heights = new DataArrayTexture(this.heightData, size, size, slots);
    configureHeightTexture(this.heights, format);
    this.heights.needsUpdate = true;
    this.weights = new DataArrayTexture(this.weightData, size, size, slots);
    this.weights.format = RGBAFormat;
    this.weights.type = UnsignedByteType;
    configureLinear(this.weights);
    this.weights.needsUpdate = true;
    this.owner = new Array<number | null>(slots).fill(null);
  }

  slot(tile: number): number {
    return this.slotOf.get(tile) ?? -1;
  }

  get resident(): number {
    return this.slotOf.size;
  }

  residentTiles(): IterableIterator<number> {
    return this.slotOf.keys();
  }

  release(tile: number): void {
    const slot = this.slotOf.get(tile);
    if (slot === undefined) return;
    this.slotOf.delete(tile);
    this.owner[slot] = null;
  }

  freeSlot(): number {
    return this.owner.indexOf(null);
  }

  /**
   * Writes one tile into a free slot and pushes just that layer to the GPU now
   * (`initTexture`), so the main-thread cost of one tile is measurable.
   */
  upload(renderer: WebGLRenderer, tile: number, heights: Uint16Array, weights: Uint8Array): SlotUploadTiming | null {
    const slot = this.freeSlot();
    if (slot < 0) return null;
    const t0 = performance.now();
    writeHeights(this.format, this.heightData, slot * this.texelsPerLayer, heights);
    this.weightData.set(weights, slot * this.texelsPerLayer * 4);
    this.heights.addLayerUpdate(slot);
    this.weights.addLayerUpdate(slot);
    this.heights.needsUpdate = true;
    this.weights.needsUpdate = true;
    const t1 = performance.now();
    renderer.initTexture(this.heights);
    renderer.initTexture(this.weights);
    const t2 = performance.now();
    this.owner[slot] = tile;
    this.slotOf.set(tile, slot);
    return { copyMs: t1 - t0, uploadMs: t2 - t1 };
  }

  gpuBytes(): { heights: number; weights: number } {
    return {
      heights: this.texelsPerLayer * this.slots * heightBytesPerTexel(this.format),
      weights: this.texelsPerLayer * this.slots * 4,
    };
  }

  dispose(): void {
    this.heights.dispose();
    this.weights.dispose();
  }
}
