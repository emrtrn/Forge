import { BufferGeometry, Float32BufferAttribute } from "three";

/** Nested XZ grids. World anchoring is uniform across rings; edge vertices
 * morph their displacement to the next ring's sampling grid in the shader. */
export function createOceanGrid(quads = 64, levels = 7, spacing = .75): BufferGeometry {
  if (!Number.isInteger(quads) || quads < 8 || quads > 128 || quads % 4 || !Number.isInteger(levels)
    || levels < 1 || levels > 9 || !Number.isFinite(spacing) || spacing <= 0) throw new Error("Invalid Ocean LOD grid");
  const positions: number[] = [], steps: number[] = [], blends: number[] = [], indices: number[] = [];
  for (let level = 0; level < levels; level++) {
    const cell = spacing * 2 ** level, offset = positions.length / 3, half = quads / 2;
    for (let z = 0; z <= quads; z++) for (let x = 0; x <= quads; x++) {
      positions.push((x - half) * cell, 0, (z - half) * cell); steps.push(cell);
      blends.push(Math.max(0, (Math.max(Math.abs(x - half), Math.abs(z - half)) - half + 4) / 4));
    }
    for (let z = 0; z < quads; z++) for (let x = 0; x < quads; x++) {
      if (level > 0 && x >= quads / 4 && x < quads * .75 && z >= quads / 4 && z < quads * .75) continue;
      const a = offset + z * (quads + 1) + x, b = a + 1, c = a + quads + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("gridStep", new Float32BufferAttribute(steps, 1));
  geometry.setAttribute("edgeBlend", new Float32BufferAttribute(blends, 1)); geometry.setIndex(indices);
  geometry.computeBoundingSphere(); return geometry;
}
