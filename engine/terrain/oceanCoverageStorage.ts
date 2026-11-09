import { OCEAN_LIMITS } from "../scene/oceanWater";

/** Native heights followed by exact 16-bit words (eight two-bit cells/float). */
export function oceanCoverageLayout(nx: number, nz: number) {
  if (!Number.isInteger(nx) || !Number.isInteger(nz) || nx < 1 || nz < 1
    || nx > OCEAN_LIMITS.axisCells || nz > OCEAN_LIMITS.axisCells) throw new Error("Invalid Ocean atlas dimensions");
  const width = nx + 1, heightRows = nz + 1, vertices = width * heightRows;
  const words = Math.ceil(nx * nz / 8), maskRows = Math.ceil(words / width);
  return { width, heightRows, vertices, words, height: heightRows + maskRows };
}
export function createOceanCoverageStorage(nx: number, nz: number) {
  const layout = oceanCoverageLayout(nx, nz), data = new Float32Array(layout.width * layout.height);
  return { ...layout, data, heights: data.subarray(0, layout.vertices) };
}
export type OceanCoverageStorage = ReturnType<typeof createOceanCoverageStorage>;

export function* packOceanCoverage(storage: OceanCoverageStorage, triangles: Uint8Array): Generator<void> {
  if (Math.ceil(triangles.length / 8) !== storage.words) throw new Error("Ocean mask/storage size mismatch");
  for (let word = 0; word < storage.words; word++) {
    let value = 0;
    for (let j = 0; j < 8; j++) value |= ((triangles[word * 8 + j] ?? 0) & 3) << (j * 2);
    storage.data[storage.vertices + word] = value;
    if ((word & 1023) === 1023) yield;
  }
}
