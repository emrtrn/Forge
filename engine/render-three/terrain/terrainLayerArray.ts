import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from "three";

/**
 * Paint layer albedos as one `sampler2DArray` (OPEN_WORLD_PLAN Faz 2 renderer,
 * 7c2 texture-unit budget). One sampler per layer cost up to eight texture
 * units, which the sun's shadow cascades compete for: on a 16-unit GPU (ANGLE
 * on D3D11) a textured terrain left none. The array takes one unit whatever the
 * layer count.
 *
 * Array layers share one size: every textured layer is resampled to the largest
 * layer's longest edge (capped at {@link TERRAIN_LAYER_ARRAY_MAX_SIZE}). UVs map
 * the whole image either way, so a non-square or smaller texture looks the
 * same, only its texel density changes. Rows are stored in GL order (row 0 is
 * v = 0), honouring each source texture's `flipY`, so a layer samples exactly
 * as its own texture did. RGB stays sRGB and alpha linear (packed roughness),
 * as in `SRGB8_ALPHA8`.
 */

/** Largest layer edge; every WebGL2 GPU offers at least 2048. */
export const TERRAIN_LAYER_ARRAY_MAX_SIZE = 2048;

/** A layer's RGBA8 pixels, rows in GL order (row 0 is v = 0). */
export interface TerrainLayerPixels {
  width: number;
  height: number;
  data: Uint8Array;
}

/** The shared edge of the array's layers: the largest source edge, capped. */
export function terrainLayerArraySize(sources: readonly { width: number; height: number }[]): number {
  let size = 1;
  for (const source of sources) size = Math.max(size, source.width, source.height);
  return Math.min(TERRAIN_LAYER_ARRAY_MAX_SIZE, size);
}

/**
 * Bilinear resample of tiling RGBA8 pixels to `size`², wrapping at the edges
 * (layers repeat across the terrain). Same-size input is copied unchanged.
 */
export function resampleTerrainLayer(source: TerrainLayerPixels, size: number): Uint8Array {
  const { width, height, data } = source;
  if (width === size && height === size) return data.slice(0, size * size * 4);
  const out = new Uint8Array(size * size * 4);
  const scaleX = width / size;
  const scaleY = height / size;
  for (let y = 0; y < size; y += 1) {
    const sy = (y + 0.5) * scaleY - 0.5;
    const y0f = Math.floor(sy);
    const fy = sy - y0f;
    const y0 = ((y0f % height) + height) % height;
    const y1 = (y0 + 1) % height;
    for (let x = 0; x < size; x += 1) {
      const sx = (x + 0.5) * scaleX - 0.5;
      const x0f = Math.floor(sx);
      const fx = sx - x0f;
      const x0 = ((x0f % width) + width) % width;
      const x1 = (x0 + 1) % width;
      const a = (y0 * width + x0) * 4;
      const b = (y0 * width + x1) * 4;
      const c = (y1 * width + x0) * 4;
      const d = (y1 * width + x1) * 4;
      const o = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = data[a + channel]! + (data[b + channel]! - data[a + channel]!) * fx;
        const bottom = data[c + channel]! + (data[d + channel]! - data[c + channel]!) * fx;
        out[o + channel] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
  return out;
}

/** Reverses pixel rows in place (a `flipY` texture's top row is v = 1). */
export function flipTerrainLayerRows(pixels: TerrainLayerPixels): TerrainLayerPixels {
  const row = pixels.width * 4;
  const scratch = new Uint8Array(row);
  for (let top = 0, bottom = pixels.height - 1; top < bottom; top += 1, bottom -= 1) {
    scratch.set(pixels.data.subarray(top * row, top * row + row));
    pixels.data.copyWithin(top * row, bottom * row, bottom * row + row);
    pixels.data.set(scratch, bottom * row);
  }
  return pixels;
}

/** Decoded pixels per source texture: editor rebuilds (view mode, layer edits) reuse them. */
const decoded = new WeakMap<Texture, { version: number; pixels: TerrainLayerPixels | null }>();

/**
 * A texture's RGBA8 pixels in GL row order, or null when they cannot be read
 * (no image yet, a non-RGBA8 data texture, no 2D canvas outside a browser).
 */
export function readTerrainLayerPixels(texture: Texture): TerrainLayerPixels | null {
  const cached = decoded.get(texture);
  if (cached && cached.version === texture.version) return cached.pixels;
  const pixels = decodeTexture(texture);
  if (pixels && texture.flipY) flipTerrainLayerRows(pixels);
  decoded.set(texture, { version: texture.version, pixels });
  return pixels;
}

function decodeTexture(texture: Texture): TerrainLayerPixels | null {
  const image = texture.image as { width?: number; height?: number; data?: ArrayLike<number> } | null | undefined;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (!image || width < 1 || height < 1) return null;
  if (image.data) {
    // A DataTexture (terrain roughness packing): raw bytes, already rows bottom-up as uploaded.
    if (texture.format !== RGBAFormat || texture.type !== UnsignedByteType || image.data.length < width * height * 4) return null;
    return { width, height, data: Uint8Array.from(image.data as ArrayLike<number>) };
  }
  const canvas = createCanvas(width, height);
  const context = canvas?.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
  if (!context) return null;
  try {
    context.drawImage(image as CanvasImageSource, 0, 0, width, height);
    // Canvas rows are top-down; the caller flips for `flipY` like the GL upload would.
    return { width, height, data: new Uint8Array(context.getImageData(0, 0, width, height).data.buffer) };
  } catch {
    return null;
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export interface TerrainLayerArray {
  /** Null when no layer has a readable texture: the shader then declares no layer sampler. */
  texture: DataArrayTexture | null;
  /** Array layer per paint layer, -1 for a layer drawn with its colour. */
  index: number[];
}

/** Packs the layers' readable textures into one sRGB, mipmapped, repeating array. */
export function createTerrainLayerArray(textures: readonly (Texture | null | undefined)[]): TerrainLayerArray {
  const index = textures.map(() => -1);
  const sources: TerrainLayerPixels[] = [];
  let anisotropy = 1;
  textures.forEach((texture, layer) => {
    const pixels = texture ? readTerrainLayerPixels(texture) : null;
    if (!texture || !pixels) return;
    index[layer] = sources.length;
    sources.push(pixels);
    anisotropy = Math.max(anisotropy, texture.anisotropy);
  });
  if (sources.length === 0) return { texture: null, index };
  const size = terrainLayerArraySize(sources);
  const texels = size * size * 4;
  const data = new Uint8Array(texels * sources.length);
  sources.forEach((source, layer) => data.set(resampleTerrainLayer(source, size), layer * texels));
  const texture = new DataArrayTexture(data, size, size, sources.length);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return { texture, index };
}
