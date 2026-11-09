import { Box3, BufferAttribute, BufferGeometry, Sphere, Vector3 } from "three";
import { CooperativeWork, finishWork } from "../../core/cooperativeWork";
import type { OceanWaterBody } from "../../scene/oceanWater";

/** Cover the complete native domain from the World Builder overview camera.
 * Near rings/phase stay unchanged; only bounded outer rings are added. */
export function oceanGridLevels(body: Pick<OceanWaterBody, "bounds">): number {
  const span = Math.max(body.bounds.max[0] - body.bounds.min[0], body.bounds.max[1] - body.bounds.min[1]);
  return Math.min(9, Math.max(7, 1 + Math.ceil(Math.log2(span * 1.5 / 24))));
}

/** Nested XZ grids. World anchoring is uniform across rings; edge vertices
 * morph their displacement to the next ring's sampling grid in the shader. */
function* oceanGridSteps(quads: number, levels: number, spacing: number): Generator<void, BufferGeometry> {
  if (!Number.isInteger(quads) || quads < 8 || quads > 128 || quads % 4 || !Number.isInteger(levels)
    || levels < 1 || levels > 9 || !Number.isFinite(spacing) || spacing <= 0) throw new Error("Invalid Ocean LOD grid");
  const count = levels * (quads + 1) ** 2, indexCount = 6 * quads ** 2 * (1 + (levels - 1) * .75);
  const positions = new Float32Array(count * 3), steps = new Float32Array(count), blends = new Float32Array(count);
  const indices = count > 65536 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let index = 0;
  for (let level = 0; level < levels; level++) {
    const cell = spacing * 2 ** level, offset = level * (quads + 1) ** 2, half = quads / 2;
    for (let z = 0; z <= quads; z++) {
      for (let x = 0; x <= quads; x++) {
        const v = offset + z * (quads + 1) + x;
        positions[v * 3] = (x - half) * cell; positions[v * 3 + 2] = (z - half) * cell;
        steps[v] = cell; blends[v] = Math.max(0, (Math.max(Math.abs(x - half), Math.abs(z - half)) - half + 4) / 4);
      }
      yield;
    }
    for (let z = 0; z < quads; z++) {
      for (let x = 0; x < quads; x++) {
        if (level > 0 && x >= quads / 4 && x < quads * .75 && z >= quads / 4 && z < quads * .75) continue;
        const a = offset + z * (quads + 1) + x, b = a + 1, c = a + quads + 1, d = c + 1;
        indices[index++] = a; indices[index++] = c; indices[index++] = b;
        indices[index++] = b; indices[index++] = c; indices[index++] = d;
      }
      yield;
    }
  }
  const extent = Math.fround(quads / 2 * spacing * 2 ** (levels - 1)), geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3)); geometry.setAttribute("gridStep", new BufferAttribute(steps, 1));
  geometry.setAttribute("edgeBlend", new BufferAttribute(blends, 1)); geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.boundingBox = new Box3(new Vector3(-extent, 0, -extent), new Vector3(extent, 0, extent));
  geometry.boundingSphere = new Sphere(new Vector3(), Math.SQRT2 * extent); return geometry;
}
export const createOceanGrid = (quads = 64, levels = 7, spacing = .75) => finishWork(oceanGridSteps(quads, levels, spacing));
export const prepareOceanGrid = (work = new CooperativeWork(), quads = 64, levels = 7, spacing = .75) => work.run("ocean-grid", oceanGridSteps(quads, levels, spacing));
