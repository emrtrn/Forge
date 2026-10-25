import { TERRAIN_MAX_TILE_QUADS, TERRAIN_MAX_TILES_PER_AXIS } from "./terrainTypes";

/**
 * Heightmap PNG codec without dependencies (OPEN_WORLD_FAZ2_EDITOR_PLAN step 5).
 * zlib goes through the platform's `CompressionStream` / `DecompressionStream`
 * ("deflate" is the zlib-wrapped format PNG stores), available in browsers and
 * Node 18+. Reading accepts every non-interlaced PNG: grey, grey+alpha, RGB,
 * RGBA (8/16 bit), grey at 1/2/4 bit and palette images, so the 8-bit images
 * the editor already imported keep working. Writing is 16-bit greyscale.
 */

export class HeightmapPngError extends Error {
  override name = "HeightmapPngError";
}

export type PngFilter = 0 | 1 | 2 | 3 | 4;

export interface DecodedHeightmapPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /**
   * Row-major (rows along +Z) height codes in 0..65535: an 8-bit 255 becomes
   * 65535. Colour pixels use the Rec. 709 luminance of the 8-bit import; alpha
   * is ignored.
   */
  samples: Uint16Array;
}

export interface HeightmapPngDecodeOptions {
  /** Per-axis pixel limit; defaults to the largest World Terrain grid. */
  maxSize?: number;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** The largest World Terrain grid, in vertices per axis. */
export const HEIGHTMAP_PNG_MAX_SIZE = TERRAIN_MAX_TILES_PER_AXIS * TERRAIN_MAX_TILE_QUADS + 1;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function pipeBytes(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const source = new Blob([bytes.slice().buffer]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(source).arrayBuffer());
}

/** Channels per colour type; palette images carry one index. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reverses the per-row filters in place; returns the unfiltered rows without filter bytes. */
function unfilter(data: Uint8Array, height: number, stride: number, bpp: number): Uint8Array {
  if (data.length !== height * (stride + 1)) {
    throw new HeightmapPngError(`PNG image data is ${data.length} bytes, expected ${height * (stride + 1)}`);
  }
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = data[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const prior = row - stride;
    for (let i = 0; i < stride; i += 1) {
      const raw = data[src + i]!;
      const left = i >= bpp ? out[row + i - bpp]! : 0;
      const up = y > 0 ? out[prior + i]! : 0;
      const upLeft = y > 0 && i >= bpp ? out[prior + i - bpp]! : 0;
      let value: number;
      switch (filter) {
        case 0: value = raw; break;
        case 1: value = raw + left; break;
        case 2: value = raw + up; break;
        case 3: value = raw + ((left + up) >> 1); break;
        case 4: value = raw + paeth(left, up, upLeft); break;
        default: throw new HeightmapPngError(`PNG row ${y} has unknown filter type ${filter}`);
      }
      out[row + i] = value & 0xff;
    }
  }
  return out;
}

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export async function decodeHeightmapPng(input: Uint8Array, options: HeightmapPngDecodeOptions = {}): Promise<DecodedHeightmapPng> {
  const bytes = input;
  if (bytes.length < 8 || SIGNATURE.some((value, i) => bytes[i] !== value)) throw new HeightmapPngError("Not a PNG file (bad signature)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let header: { width: number; height: number; bitDepth: number; colorType: number } | null = null;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let ended = false;
  while (!ended) {
    if (offset + 12 > bytes.length) throw new HeightmapPngError("PNG is truncated (no IEND chunk)");
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length > 0x7fffffff || dataEnd + 4 > bytes.length) throw new HeightmapPngError(`PNG chunk ${type} is truncated`);
    if (crc32(bytes, offset + 4, dataEnd) !== view.getUint32(dataEnd)) throw new HeightmapPngError(`PNG chunk ${type} has a bad CRC`);
    const data = bytes.subarray(dataStart, dataEnd);
    if (!header && type !== "IHDR") throw new HeightmapPngError("PNG does not start with IHDR");
    if (type === "IHDR") {
      if (header || length !== 13) throw new HeightmapPngError("PNG has an invalid IHDR chunk");
      const width = view.getUint32(dataStart), height = view.getUint32(dataStart + 4);
      const [bitDepth, colorType, compression, filterMethod, interlace] = data.subarray(8, 13);
      if (!DEPTHS[colorType!]?.includes(bitDepth!)) throw new HeightmapPngError(`PNG colour type ${colorType} with bit depth ${bitDepth} is invalid`);
      if (compression !== 0 || filterMethod !== 0) throw new HeightmapPngError("PNG uses an unknown compression or filter method");
      if (interlace !== 0) throw new HeightmapPngError("Interlaced (Adam7) PNG heightmaps are not supported; save the image without interlacing");
      const maxSize = options.maxSize ?? HEIGHTMAP_PNG_MAX_SIZE;
      if (width < 1 || height < 1 || width > maxSize || height > maxSize) {
        throw new HeightmapPngError(`PNG is ${width} × ${height}; heightmaps are 1..${maxSize} pixels per axis`);
      }
      header = { width, height, bitDepth: bitDepth!, colorType: colorType! };
    } else if (type === "PLTE") {
      if (length % 3 !== 0 || length === 0 || length > 768) throw new HeightmapPngError("PNG has an invalid PLTE chunk");
      palette = data.slice();
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      ended = true;
    } else if ((bytes[offset + 4]! & 0x20) === 0) {
      throw new HeightmapPngError(`PNG has an unknown critical chunk ${type}`);
    }
    offset = dataEnd + 4;
  }
  if (!header) throw new HeightmapPngError("PNG has no IHDR chunk");
  if (idat.length === 0) throw new HeightmapPngError("PNG has no image data");
  const { width, height, bitDepth, colorType } = header;
  if (colorType === 3 && !palette) throw new HeightmapPngError("Palette PNG has no PLTE chunk");

  const compressed = new Uint8Array(idat.reduce((sum, chunk) => sum + chunk.length, 0));
  idat.reduce((at, chunk) => (compressed.set(chunk, at), at + chunk.length), 0);
  let inflated: Uint8Array;
  try {
    inflated = await pipeBytes(compressed, new DecompressionStream("deflate"));
  } catch (error) {
    throw new HeightmapPngError(`PNG image data does not inflate: ${error instanceof Error ? error.message : String(error)}`);
  }
  const channels = CHANNELS[colorType]!;
  const bitsPerPixel = channels * bitDepth;
  const stride = Math.ceil(width * bitsPerPixel / 8);
  const rows = unfilter(inflated, height, stride, Math.max(1, bitsPerPixel >> 3));

  const samples = new Uint16Array(width * height);
  const max = (1 << bitDepth) - 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    // One channel value of pixel x, in 0..max.
    const read = (x: number, channel: number): number => {
      if (bitDepth === 16) return (rows[row + (x * channels + channel) * 2]! << 8) | rows[row + (x * channels + channel) * 2 + 1]!;
      if (bitDepth === 8) return rows[row + x * channels + channel]!;
      const bit = x * bitDepth;
      return (rows[row + (bit >> 3)]! >> (8 - bitDepth - (bit & 7))) & max;
    };
    for (let x = 0; x < width; x += 1) {
      let value: number;
      if (colorType === 3) {
        const index = read(x, 0);
        if (index * 3 + 2 >= palette!.length) throw new HeightmapPngError(`PNG palette index ${index} is out of range`);
        value = luminance(palette![index * 3]!, palette![index * 3 + 1]!, palette![index * 3 + 2]!) / 255;
      } else if (colorType === 2 || colorType === 6) {
        value = luminance(read(x, 0), read(x, 1), read(x, 2)) / max;
      } else {
        value = read(x, 0) / max;
      }
      samples[y * width + x] = Math.round(value * 65535);
    }
  }
  return { width, height, bitDepth, colorType, samples };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(data.length + 8, crc32(out, 4, data.length + 8));
  return out;
}

/** One row filtered with `filter`, preceded by its filter byte. */
function filterRow(raw: Uint8Array, row: number, stride: number, bpp: number, filter: PngFilter, out: Uint8Array): void {
  out[0] = filter;
  for (let i = 0; i < stride; i += 1) {
    const value = raw[row + i]!;
    const left = i >= bpp ? raw[row + i - bpp]! : 0;
    const up = row > 0 ? raw[row - stride + i]! : 0;
    const upLeft = row > 0 && i >= bpp ? raw[row - stride + i - bpp]! : 0;
    const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
    out[i + 1] = (value - predictor) & 0xff;
  }
}

/**
 * 16-bit greyscale PNG of row-major height codes. "adaptive" (default) picks
 * the filter with the smallest sum of signed residuals per row, the usual
 * heuristic; a fixed filter is for tests and reproducible output.
 */
export async function encodeHeightmapPng16(
  width: number, height: number, samples: Uint16Array, options: { filter?: PngFilter | "adaptive" } = {},
): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || samples.length !== width * height) {
    throw new HeightmapPngError(`PNG encode: ${samples.length} samples do not fill ${width} × ${height}`);
  }
  const stride = width * 2;
  const raw = new Uint8Array(height * stride);
  for (let i = 0; i < samples.length; i += 1) {
    raw[i * 2] = samples[i]! >> 8;
    raw[i * 2 + 1] = samples[i]! & 0xff;
  }
  const filtered = new Uint8Array(height * (stride + 1));
  const candidate = new Uint8Array(stride + 1);
  const filters: readonly PngFilter[] = options.filter === undefined || options.filter === "adaptive" ? [0, 1, 2, 3, 4] : [options.filter];
  for (let y = 0; y < height; y += 1) {
    let best = Infinity;
    for (const filter of filters) {
      filterRow(raw, y * stride, stride, 2, filter, candidate);
      let cost = 0;
      for (let i = 1; i <= stride; i += 1) cost += candidate[i]! < 128 ? candidate[i]! : 256 - candidate[i]!;
      if (cost < best) {
        best = cost;
        filtered.set(candidate, y * (stride + 1));
      }
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([16, 0, 0, 0, 0], 8);
  const parts = [Uint8Array.from(SIGNATURE), chunk("IHDR", ihdr),
    chunk("IDAT", await pipeBytes(filtered, new CompressionStream("deflate"))), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((at, part) => (out.set(part, at), at + part.length), 0);
  return out;
}
