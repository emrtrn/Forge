import { Box3, Sphere, Vector3, BufferGeometry, BufferAttribute } from "three";
import type { LakeGeometry } from "../terrain/terrainLakeWater";
import { finishWork } from "../core/cooperativeWork";

/** Matches Three's indexed area-weighted normals and bounds. Buffers are only
 * attached to a disposable geometry after all interruptible CPU work is done.
 */
export function* lakeRenderGeometrySteps(data: LakeGeometry): Generator<void, BufferGeometry> {
  const p = data.positions, ids = data.indices, normals = new Float32Array(p.length);
  for (let k = 0; k < ids.length; k += 3) {
    const a = ids[k]! * 3, b = ids[k + 1]! * 3, c = ids[k + 2]! * 3;
    const cbx = p[c]! - p[b]!, cby = p[c + 1]! - p[b + 1]!, cbz = p[c + 2]! - p[b + 2]!;
    const abx = p[a]! - p[b]!, aby = p[a + 1]! - p[b + 1]!, abz = p[a + 2]! - p[b + 2]!;
    const x = cby * abz - cbz * aby, y = cbz * abx - cbx * abz, z = cbx * aby - cby * abx;
    normals[a] = normals[a]! + x; normals[a + 1] = normals[a + 1]! + y; normals[a + 2] = normals[a + 2]! + z;
    normals[b] = normals[b]! + x; normals[b + 1] = normals[b + 1]! + y; normals[b + 2] = normals[b + 2]! + z;
    normals[c] = normals[c]! + x; normals[c + 1] = normals[c + 1]! + y; normals[c + 2] = normals[c + 2]! + z;
    if (k % 768 === 0) yield;
  }
  const box = new Box3();
  for (let i = 0; i < p.length; i += 3) {
    const scale = 1 / (Math.sqrt(normals[i]! ** 2 + normals[i + 1]! ** 2 + normals[i + 2]! ** 2) || 1);
    normals[i] = normals[i]! * scale; normals[i + 1] = normals[i + 1]! * scale; normals[i + 2] = normals[i + 2]! * scale;
    box.min.x = Math.min(box.min.x, p[i]!); box.min.y = Math.min(box.min.y, p[i + 1]!); box.min.z = Math.min(box.min.z, p[i + 2]!);
    box.max.x = Math.max(box.max.x, p[i]!); box.max.y = Math.max(box.max.y, p[i + 1]!); box.max.z = Math.max(box.max.z, p[i + 2]!);
    if (i % 768 === 0) yield;
  }
  const center = box.getCenter(new Vector3()); let radius2 = 0;
  for (let i = 0; i < p.length; i += 3) {
    radius2 = Math.max(radius2, (p[i]! - center.x) ** 2 + (p[i + 1]! - center.y) ** 2 + (p[i + 2]! - center.z) ** 2);
    if (i % 768 === 0) yield;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(p, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setAttribute("waterDepth", new BufferAttribute(data.depths, 1));
  geometry.setAttribute("waterDepthSlope", new BufferAttribute(data.depthSlopes ?? new Float32Array(data.depths.length * 2), 2));
  geometry.setAttribute("uv", new BufferAttribute(data.uvs, 2));
  geometry.setIndex(new BufferAttribute(ids, 1));
  geometry.boundingBox = box; geometry.boundingSphere = new Sphere(center, Math.sqrt(radius2));
  return geometry;
}

export function lakeRenderGeometry(data: LakeGeometry): BufferGeometry { return finishWork(lakeRenderGeometrySteps(data)); }
