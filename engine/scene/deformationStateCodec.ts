/** Versioned save-game building block; no storage or GameSaveState integration. */
import { DEFORMATION_DEPTH_SCALE, type DeformationField } from "./deformationField";
import { CoarseDeformationLayer, DEFORMATION_CHUNK_SIZE, type CoarseDeformationChunk } from "./deformationPersistence";

const MAX_DEPTH = 65_535 / DEFORMATION_DEPTH_SCALE;
// Bound allocations and RLE work before decoding untrusted save data.
const MAX_CELLS = 4_194_304;
export const DEFORMATION_SAVE_BUDGET = 64 * 1024;

export interface DeformationIdentity {
  readonly levelPath: string;
  readonly terrainId: string;
}

interface WindowMetadata {
  readonly cellSize: number;
  readonly cellsPerSide: number;
  readonly minCellX: number;
  readonly minCellZ: number;
}

interface EncodedChannels {
  readonly depthRle: string;
  readonly disturbanceRle: string;
}

export interface EncodedDeformationState extends DeformationIdentity {
  readonly version: 1;
  /** Both depth channels use round(depth / maxDepth * 255). Disturbance is lossless. */
  readonly maxDepth: number;
  /** Null when the size-budget helper drops the detailed window. */
  readonly window: (WindowMetadata & EncodedChannels) | null;
  readonly coarse: {
    readonly cellSize: number;
    /** Fixed 32×32 row-major chunks, including empty cells. */
    readonly chunks: readonly (EncodedChannels & { readonly x: number; readonly z: number })[];
  };
}

export interface DeformationStateInput extends DeformationIdentity {
  readonly window: DeformationField;
  readonly coarse: CoarseDeformationLayer;
}

export interface DecodedDeformationWindow extends WindowMetadata {
  /** Logical row-major order from minCellX/minCellZ, NOT toroidal texture order. */
  readonly depth: Uint16Array;
  readonly disturbance: Uint8Array;
}

export type DeformationDecodeResult =
  | { readonly status: "ok"; readonly window: DecodedDeformationWindow | null; readonly coarse: CoarseDeformationLayer }
  | { readonly status: "ignored"; readonly reason: "level-mismatch" | "terrain-mismatch" }
  | { readonly status: "error"; readonly reason: "invalid-payload" | "unsupported-version" | "invalid-metadata" | "invalid-rle" };

/** Byte value + unsigned LEB128 run length (1..MAX_CELLS), then canonical base64. */
function encodeRle(values: Uint8Array): string {
  const bytes: string[] = [];
  for (let i = 0; i < values.length;) {
    const value = values[i]!;
    let count = 1;
    while (i + count < values.length && values[i + count] === value) count += 1;
    bytes.push(String.fromCharCode(value));
    let run = count;
    do {
      const byte = run & 127;
      run = Math.floor(run / 128);
      bytes.push(String.fromCharCode(byte | (run > 0 ? 128 : 0)));
    } while (run > 0);
    i += count;
  }
  return btoa(bytes.join(""));
}

function decodeRle(value: unknown, count: number): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0 || value.length > count * 4
    || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  const binary = atob(value);
  if (btoa(binary) !== value) return null;
  let offset = 0;
  const readRun = (): number => {
    let run = 0;
    for (let shift = 0; shift <= 21; shift += 7) {
      if (offset >= binary.length) return -1;
      const byte = binary.charCodeAt(offset++);
      run += (byte & 127) * 2 ** shift;
      if ((byte & 128) === 0) return shift > 0 && byte === 0 ? -1 : run;
    }
    return -1;
  };
  let total = 0;
  while (offset < binary.length) {
    offset += 1;
    const run = readRun();
    if (run <= 0 || total + run > count) return null;
    total += run;
  }
  if (total !== count) return null;
  const decoded = new Uint8Array(count);
  offset = 0;
  let target = 0;
  while (offset < binary.length) {
    const byte = binary.charCodeAt(offset++);
    const run = readRun();
    decoded.fill(byte, target, target + run);
    target += run;
  }
  return decoded;
}

function encodeChannels(depth: Uint16Array, disturbance: Uint8Array, maxDepth: number): EncodedChannels {
  return { depthRle: encodeRle(Uint8Array.from(depth, value => Math.round(value / DEFORMATION_DEPTH_SCALE / maxDepth * 255))),
    disturbanceRle: encodeRle(disturbance) };
}

/**
 * Pure snapshot: folds the window into a COPY of coarse history so budget fallback
 * keeps current tracks too. Depth error on decode is <= maxDepth/510 + 0.00005 m
 * (8-bit rounding followed by the live field's 0.1 mm storage rounding).
 */
export function encodeDeformationState(input: DeformationStateInput): EncodedDeformationState {
  if (!identity(input.levelPath) || !identity(input.terrainId)) throw new RangeError("Invalid deformation identity");
  const { window } = input;
  const coarse = new CoarseDeformationLayer(input.coarse.cellSize, input.coarse.snapshotChunks());
  coarse.absorbWindow(window);
  const chunks = coarse.snapshotChunks();
  if (window.depth.length + chunks.length * DEFORMATION_CHUNK_SIZE ** 2 > MAX_CELLS) {
    throw new RangeError("Deformation state exceeds codec cell limit");
  }
  let maxUnits = 1;
  for (const value of window.depth) maxUnits = Math.max(maxUnits, value);
  for (const chunk of chunks) for (const value of chunk.depth) maxUnits = Math.max(maxUnits, value);
  const maxDepth = maxUnits / DEFORMATION_DEPTH_SCALE;
  const [minCellX, minCellZ] = window.originCell;
  const size = window.cellsPerSide;
  const depth = new Uint16Array(size ** 2);
  const disturbance = new Uint8Array(size ** 2);
  // Convert toroidal storage to logical rows; preserve exact integer channel values.
  const mod = (value: number): number => ((value % size) + size) % size;
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const source = mod(minCellZ + z) * size + mod(minCellX + x);
      depth[z * size + x] = window.depth[source]!;
      disturbance[z * size + x] = window.disturbance[source]!;
    }
  }
  return { version: 1, levelPath: input.levelPath, terrainId: input.terrainId, maxDepth,
    window: { cellSize: window.cellSize, cellsPerSide: size, minCellX, minCellZ,
      ...encodeChannels(depth, disturbance, maxDepth) },
    coarse: { cellSize: coarse.cellSize, chunks: chunks.map(chunk => ({ x: chunk.x, z: chunk.z,
      ...encodeChannels(chunk.depth, chunk.disturbance, maxDepth) })) } };
}

export function encodeDeformationStateWithinBudget(input: DeformationStateInput, byteBudget = DEFORMATION_SAVE_BUDGET): {
  readonly payload: EncodedDeformationState;
  readonly mode: "window-and-coarse" | "coarse-only";
  readonly byteLength: number;
  /** Even coarse history can exceed an arbitrarily small budget; no history is silently deleted. */
  readonly withinBudget: boolean;
} {
  if (!Number.isSafeInteger(byteBudget) || byteBudget < 0) throw new RangeError("Invalid deformation byte budget");
  let payload = encodeDeformationState(input);
  const bytes = (value: EncodedDeformationState): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  let byteLength = bytes(payload);
  const mode = byteLength > byteBudget ? "coarse-only" : "window-and-coarse";
  if (mode === "coarse-only") {
    payload = { ...payload, window: null };
    byteLength = bytes(payload);
  }
  return { payload, mode, byteLength, withinBudget: byteLength <= byteBudget };
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096;

function validGrid(x: number, z: number, size: number, cellSize: number): boolean {
  return [x, z, x + size, z + size].every(Number.isSafeInteger)
    && [x * cellSize, z * cellSize, (x + size) * cellSize, (z + size) * cellSize, size * cellSize].every(Number.isFinite)
    && size * cellSize > 0;
}

function decodeChannels(raw: Record<string, unknown>, count: number, maxDepth: number): {
  depth: Uint16Array; disturbance: Uint8Array;
} | null {
  const depth = decodeRle(raw.depthRle, count);
  const disturbance = decodeRle(raw.disturbanceRle, count);
  if (!depth || !disturbance) return null;
  return { depth: Uint16Array.from(depth, value => Math.round(value / 255 * maxDepth * DEFORMATION_DEPTH_SCALE)), disturbance };
}

/** Untrusted JSON input never throws; another level/terrain is intentionally ignored. */
export function decodeDeformationState(value: unknown, expected: DeformationIdentity): DeformationDecodeResult {
  try {
    return decodeState(value, expected);
  } catch {
    return { status: "error", reason: "invalid-payload" };
  }
}

function decodeState(value: unknown, expected: DeformationIdentity): DeformationDecodeResult {
  if (!object(value)) return { status: "error", reason: "invalid-payload" };
  if (value.version !== 1) return { status: "error", reason: "unsupported-version" };
  if (!identity(value.levelPath) || !identity(value.terrainId)) return { status: "error", reason: "invalid-metadata" };
  if (value.levelPath !== expected.levelPath) return { status: "ignored", reason: "level-mismatch" };
  if (value.terrainId !== expected.terrainId) return { status: "ignored", reason: "terrain-mismatch" };
  if (!positive(value.maxDepth) || value.maxDepth > MAX_DEPTH || !object(value.coarse)
    || !positive(value.coarse.cellSize) || !Array.isArray(value.coarse.chunks)
    || value.coarse.chunks.length > MAX_CELLS / DEFORMATION_CHUNK_SIZE ** 2) {
    return { status: "error", reason: "invalid-metadata" };
  }
  let window: DecodedDeformationWindow | null = null;
  let cells = value.coarse.chunks.length * DEFORMATION_CHUNK_SIZE ** 2;
  if (value.window !== null) {
    const raw = value.window;
    if (!object(raw) || !positive(raw.cellSize) || raw.cellSize > value.coarse.cellSize
      || !integer(raw.cellsPerSide) || raw.cellsPerSide < 1 || raw.cellsPerSide > Math.sqrt(MAX_CELLS)
      || !integer(raw.minCellX) || !integer(raw.minCellZ)
      || !validGrid(raw.minCellX, raw.minCellZ, raw.cellsPerSide, raw.cellSize)) {
      return { status: "error", reason: "invalid-metadata" };
    }
    cells += raw.cellsPerSide ** 2;
    if (cells > MAX_CELLS) return { status: "error", reason: "invalid-metadata" };
    const channels = decodeChannels(raw, raw.cellsPerSide ** 2, value.maxDepth);
    if (!channels) return { status: "error", reason: "invalid-rle" };
    window = { cellSize: raw.cellSize, cellsPerSide: raw.cellsPerSide,
      minCellX: raw.minCellX, minCellZ: raw.minCellZ, ...channels };
  }
  const chunks: CoarseDeformationChunk[] = [];
  const seen = new Set<string>();
  for (const raw of value.coarse.chunks) {
    if (!object(raw) || !integer(raw.x) || !integer(raw.z)
      || !validGrid(raw.x * DEFORMATION_CHUNK_SIZE, raw.z * DEFORMATION_CHUNK_SIZE, DEFORMATION_CHUNK_SIZE, value.coarse.cellSize)) {
      return { status: "error", reason: "invalid-metadata" };
    }
    const key = `${raw.x},${raw.z}`;
    if (seen.has(key)) return { status: "error", reason: "invalid-metadata" };
    seen.add(key);
    const channels = decodeChannels(raw, DEFORMATION_CHUNK_SIZE ** 2, value.maxDepth);
    if (!channels) return { status: "error", reason: "invalid-rle" };
    chunks.push({ x: raw.x, z: raw.z, ...channels });
  }
  return { status: "ok", window, coarse: new CoarseDeformationLayer(value.coarse.cellSize, chunks) };
}
