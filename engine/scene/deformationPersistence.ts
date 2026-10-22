/** Sparse, CPU-only history. Authored terrain data is never modified. */
import { DEFORMATION_DEPTH_SCALE, type DeformationField, type DeformationSample } from "./deformationField";

export const DEFORMATION_CHUNK_SIZE = 32;

export interface CoarseDeformationChunk {
  readonly x: number;
  readonly z: number;
  /** Row-major cells; same units as DeformationField channels. */
  readonly depth: Uint16Array;
  readonly disturbance: Uint8Array;
}

/** World-aligned bins, pooled by fine-cell centre. Only nonzero chunks allocate. */
export class CoarseDeformationLayer {
  readonly cellSize: number;
  private readonly chunks = new Map<string, CoarseDeformationChunk>();

  constructor(cellSize = 1, chunks: readonly CoarseDeformationChunk[] = []) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError("Invalid coarse cell size");
    this.cellSize = cellSize;
    for (const chunk of chunks) {
      if (!Number.isSafeInteger(chunk.x) || !Number.isSafeInteger(chunk.z)
        || chunk.depth.length !== DEFORMATION_CHUNK_SIZE ** 2
        || chunk.disturbance.length !== DEFORMATION_CHUNK_SIZE ** 2) {
        throw new RangeError("Invalid coarse chunk");
      }
      const key = `${chunk.x},${chunk.z}`;
      if (this.chunks.has(key)) throw new RangeError("Duplicate coarse chunk");
      if (chunk.depth.some(value => value !== 0) || chunk.disturbance.some(value => value !== 0)) {
        this.chunks.set(key, { ...chunk, depth: chunk.depth.slice(), disturbance: chunk.disturbance.slice() });
      }
    }
  }

  get chunkCount(): number { return this.chunks.size; }

  /** Independent, deterministically ordered copies for snapshots and codecs. */
  snapshotChunks(): CoarseDeformationChunk[] {
    return [...this.chunks.values()].sort((a, b) => a.z - b.z || a.x - b.x)
      .map(chunk => ({ ...chunk, depth: chunk.depth.slice(), disturbance: chunk.disturbance.slice() }));
  }

  /** Can be passed directly as DeformationField's onEvictCell callback. Max-pools each channel independently. */
  readonly absorbCell = (worldX: number, worldZ: number, depth: number, disturbance: number): void => {
    const cx = Math.floor(worldX / this.cellSize);
    const cz = Math.floor(worldZ / this.cellSize);
    if (![cx, cz].every(Number.isSafeInteger) || !Number.isFinite(depth) || !Number.isFinite(disturbance)) return;
    const units = Math.round(Math.max(0, Math.min(depth * DEFORMATION_DEPTH_SCALE, 65_535)));
    const tint = Math.round(Math.max(0, Math.min(disturbance, 255)));
    if (units === 0 && tint === 0) return;
    const x = Math.floor(cx / DEFORMATION_CHUNK_SIZE);
    const z = Math.floor(cz / DEFORMATION_CHUNK_SIZE);
    const key = `${x},${z}`;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = { x, z, depth: new Uint16Array(DEFORMATION_CHUNK_SIZE ** 2),
        disturbance: new Uint8Array(DEFORMATION_CHUNK_SIZE ** 2) };
      this.chunks.set(key, chunk);
    }
    const index = (cz - z * DEFORMATION_CHUNK_SIZE) * DEFORMATION_CHUNK_SIZE + cx - x * DEFORMATION_CHUNK_SIZE;
    chunk.depth[index] = Math.max(chunk.depth[index]!, units);
    chunk.disturbance[index] = Math.max(chunk.disturbance[index]!, tint);
  };

  /** Explicit save-time fold; repeated calls are idempotent. Does not clear the live field. */
  absorbWindow(window: DeformationField): void {
    if (this.cellSize < window.cellSize) throw new RangeError("Coarse cells must be at least as large as live cells");
    window.forEachActiveCell(this.absorbCell);
  }

  /** Nearest bin (piecewise constant on half-open world cells), zero in untouched space. */
  sample(worldX: number, worldZ: number): DeformationSample {
    const cx = Math.floor(worldX / this.cellSize);
    const cz = Math.floor(worldZ / this.cellSize);
    if (![cx, cz].every(Number.isSafeInteger)) return { depth: 0, disturbance: 0 };
    const x = Math.floor(cx / DEFORMATION_CHUNK_SIZE);
    const z = Math.floor(cz / DEFORMATION_CHUNK_SIZE);
    const chunk = this.chunks.get(`${x},${z}`);
    if (!chunk) return { depth: 0, disturbance: 0 };
    const index = (cz - z * DEFORMATION_CHUNK_SIZE) * DEFORMATION_CHUNK_SIZE + cx - x * DEFORMATION_CHUNK_SIZE;
    return { depth: chunk.depth[index]! / DEFORMATION_DEPTH_SCALE, disturbance: chunk.disturbance[index]! };
  }
}
