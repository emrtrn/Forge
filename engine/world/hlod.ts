/** Pure HLOD documents and shared build/runtime input rules. */
import type { RoomLayout } from "../scene/layout";
import { isMarkerAssetId } from "../scene/shapes";
import { readRotation, readScale } from "../scene/transform";
import { detailCullDistance } from "./detailCulling";
import { parseWorldCellKey } from "./worldGrid";
import { compareWorldCellKeys, worldCellPath } from "./worldPartition";

export const HLOD_SCHEMA = 1;

export interface HlodCellEntry {
  /** Main grid cell key. */
  readonly key: string;
  /** Triangles in the simplified proxy. */
  readonly triangles: number;
  /** Placement input hash at build time. */
  readonly sourceHash: string;
}

export interface HlodIndex {
  readonly schema: typeof HLOD_SCHEMA;
  readonly type: "hlod";
  readonly cellSize: number;
  /** Sorted by compareWorldCellKeys. */
  readonly cells: readonly HlodCellEntry[];
}

/** Level-owned index, using the foliage sidecar base rule. */
export function hlodIndexPath(levelPath: string): string {
  const normalized = levelPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${normalized.replace(/(\.level|\.layout)?\.json$/i, "")}.hlod.json`;
}

/** Level-owned proxy in the main grid's sibling HLOD directory. */
export function hlodCellPath(levelPath: string, key: string): string {
  return worldCellPath(levelPath, "main", key).replace(/\/main\/([^/]+)\.cell\.json$/, "/hlod/$1.hlod.glb");
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

/** Validates and detaches an index, ordering its unique cell entries. */
export function normalizeHlodIndex(value: unknown): HlodIndex {
  const input = record(value, "hlod");
  if (input.schema !== HLOD_SCHEMA) throw new Error("Invalid hlod.schema");
  if (input.type !== "hlod") throw new Error("Invalid hlod.type");
  if (typeof input.cellSize !== "number" || !Number.isFinite(input.cellSize) || input.cellSize <= 0) {
    throw new Error("Invalid hlod.cellSize");
  }
  if (!Array.isArray(input.cells)) throw new Error("hlod.cells must be an array");
  const seen = new Set<string>();
  const cells = input.cells.map((value, index): HlodCellEntry => {
    const field = `hlod.cells[${index}]`;
    const cell = record(value, field);
    const coord = typeof cell.key === "string" ? parseWorldCellKey(cell.key) : null;
    if (typeof cell.key !== "string" || !coord || !Number.isSafeInteger(coord.x) || !Number.isSafeInteger(coord.z)) {
      throw new Error(`Invalid ${field}.key`);
    }
    if (seen.has(cell.key)) throw new Error(`Duplicate ${field}.key: ${cell.key}`);
    seen.add(cell.key);
    if (typeof cell.triangles !== "number" || !Number.isSafeInteger(cell.triangles) || cell.triangles < 0) {
      throw new Error(`Invalid ${field}.triangles`);
    }
    if (typeof cell.sourceHash !== "string") throw new Error(`Invalid ${field}.sourceHash`);
    return { key: cell.key, triangles: cell.triangles, sourceHash: cell.sourceHash };
  });
  cells.sort((a, b) => compareWorldCellKeys(a.key, b.key));
  return { schema: HLOD_SCHEMA, type: "hlod", cellSize: input.cellSize, cells };
}

export interface HlodPlacementInput {
  readonly assetId: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly materialSlot?: string;
}

// Visibility travels with canonical inputs without changing their public contract.
type VisibleInput = HlodPlacementInput & { readonly hidden?: boolean };

/** Order-independent FNV-1a hash; source asset bytes are deliberately excluded. */
export function hlodCellSourceHash(placements: readonly HlodPlacementInput[]): string {
  const rounded = (values: readonly number[]) => values.map((value) => Math.round(value * 1e4) / 1e4);
  const canonical = placements.filter((placement: VisibleInput) => !placement.hidden).map((placement) => JSON.stringify([
    placement.assetId, rounded(placement.position), rounded(placement.rotation), rounded(placement.scale),
    placement.materialSlot ?? "",
  ])).sort();
  const source = JSON.stringify(canonical);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Resolves exactly the TRS fields consumed by composePlacementMatrix. */
export function hlodCellPlacements(
  layout: RoomLayout,
  instances: readonly { group: number; placement: number }[],
): HlodPlacementInput[] {
  return instances.map((ref): VisibleInput => {
    const group = layout.instances[ref.group];
    const placement = group?.placements[ref.placement];
    if (!group || !placement) throw new Error(`Invalid hlod placement reference ${ref.group}:${ref.placement}`);
    return {
      assetId: group.assetId,
      position: [...placement.position],
      rotation: readRotation(placement),
      scale: readScale(placement),
      ...(placement.materialSlot !== undefined ? { materialSlot: placement.materialSlot } : {}),
      ...(placement.hidden !== undefined ? { hidden: placement.hidden } : {}),
    };
  });
}

/** Small details that disappear before their cell unloads need no proxy. */
export function hlodIncludesPlacement(
  placement: { readonly assetId: string; readonly hidden?: boolean },
  boundingRadius: number,
  maxScale: number,
  loadRange: number,
): boolean {
  if (placement.hidden || isMarkerAssetId(placement.assetId)) return false;
  const distance = detailCullDistance(boundingRadius * Math.abs(maxScale));
  return distance === null || distance > loadRange;
}

/** Averages decoded sRGB pixels in linear space, ignoring near-transparent pixels. */
export function averageLinearColor(pixels: Uint8Array, channels: 3 | 4): [number, number, number] {
  const sum: [number, number, number] = [0, 0, 0];
  let count = 0;
  for (let index = 0; index + channels <= pixels.length; index += channels) {
    if (channels === 4 && pixels[index + 3]! < 8) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const srgb = pixels[index + channel]! / 255;
      sum[channel]! += srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    }
    count += 1;
  }
  return count ? [sum[0] / count, sum[1] / count, sum[2] / count] : [1, 1, 1];
}
