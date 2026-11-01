import { Box3, BufferAttribute, BufferGeometry, Matrix4, Vector3, type Camera, type Mesh, type Scene, type ShaderMaterial } from "three";
import type { LayoutLakeWaterBody } from "../scene/layout";
import { resolveLakeUnderwater } from "../scene/lakeUnderwater";
import type { LakeGeometry } from "../terrain/terrainLakeWater";
import { LakeSurfaceQuery } from "../terrain/lakeInteraction";
import type { LakeWaveParameters } from "../terrain/lakeWaves";

/** Watertight top/bed/edge mesh built from the exact welded wet triangles. */
export function lakeUnderwaterVolume(data: LakeGeometry): BufferGeometry {
  const n = data.positions.length / 3, p = new Float32Array(n * 6), depths = new Float32Array(n * 2), top = new Float32Array(n * 2);
  p.set(data.positions); p.set(data.positions, n * 3); depths.set(data.depths); top.fill(1, 0, n);
  for (let i = 0; i < n; i++) p[(n + i) * 3 + 1] = p[(n + i) * 3 + 1]! - data.depths[i]!;
  const ids: number[] = [], edges = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < data.indices.length; i += 3) {
    const a = data.indices[i]!, b0 = data.indices[i + 1]!, c0 = data.indices[i + 2]!;
    const up = (p[b0 * 3 + 2]! - p[a * 3 + 2]!) * (p[c0 * 3]! - p[a * 3]!) - (p[b0 * 3]! - p[a * 3]!) * (p[c0 * 3 + 2]! - p[a * 3 + 2]!);
    const b = up >= 0 ? b0 : c0, c = up >= 0 ? c0 : b0;
    ids.push(a, b, c, c + n, b + n, a + n);
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const key = `${Math.min(x!, y!)}:${Math.max(x!, y!)}`, edge = edges.get(key);
      if (edge) edge.count++; else edges.set(key, { a: x!, b: y!, count: 1 });
    }
  }
  for (const { a, b, count } of edges.values()) if (count === 1) ids.push(a + n, b + n, b, a + n, b, a);
  const geometry = new BufferGeometry(); geometry.setAttribute("position", new BufferAttribute(p, 3));
  geometry.setAttribute("waterDepth", new BufferAttribute(depths, 1)); geometry.setAttribute("waterTop", new BufferAttribute(top, 1)); geometry.setIndex(ids);
  return geometry;
}

const bodies = new WeakMap<Scene, Set<LakeUnderwaterBody>>();
export class LakeUnderwaterBody {
  private scene: Scene | null = null;
  private geometry: BufferGeometry | null = null;
  private query: LakeSurfaceQuery | undefined;
  constructor(readonly owner: Mesh<BufferGeometry, ShaderMaterial>, readonly lake: LayoutLakeWaterBody,
    readonly data: LakeGeometry, readonly waves: LakeWaveParameters, query?: LakeSurfaceQuery) { this.query = query; }
  attach(): void {
    let root: import("three").Object3D = this.owner; while (root.parent) root = root.parent;
    if (!(root as Scene).isScene || root === this.scene) return;
    this.detach(); this.scene = root as Scene;
    let set = bodies.get(this.scene); if (!set) bodies.set(this.scene, set = new Set()); set.add(this);
  }
  detach(): void { if (this.scene) bodies.get(this.scene)?.delete(this); this.scene = null; }
  dispose(): void { this.detach(); this.geometry?.dispose(); this.geometry = null; }
  volume(): BufferGeometry { return this.geometry ??= lakeUnderwaterVolume(this.data); }
  visible(): boolean { for (let p: import("three").Object3D | null = this.owner; p; p = p.parent) if (!p.visible) return false; return true; }
  get time(): number { return this.owner.material.uniforms.surfaceWaveTime!.value; }
  depthAt(x: number, z: number): number | null { return (this.query ??= new LakeSurfaceQuery(this.data)).depthAt(x, z); }
  surfaceAt(x: number, z: number): number | null {
    this.query ??= new LakeSurfaceQuery(this.data);
    const offset = this.query.offsetAt(x, z, this.time, this.waves);
    return offset === null ? null : this.owner.position.y + offset;
  }
}

/** Camera position or near-plane overlap, never a vehicle/actor position. */
export function selectUnderwaterBody(scene: Scene, camera: Camera): LakeUnderwaterBody | null {
  const point = camera.getWorldPosition(new Vector3()), near = new Box3(), inv = new Matrix4().multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
  for (const x of [-1, 1]) for (const y of [-1, 1]) near.expandByPoint(new Vector3(x, y, camera.reversedDepth ? 1 : -1).applyMatrix4(inv));
  let best: LakeUnderwaterBody | null = null, score = Infinity;
  for (const body of bodies.get(scene) ?? []) {
    if (!resolveLakeUnderwater(body.lake).enabled || !body.visible() || !body.owner.layers.test(camera.layers)) continue;
    const d = body.depthAt(point.x, point.z), level = body.surfaceAt(point.x, point.z), bed = d === null ? Infinity : body.owner.position.y - d;
    const inside = level !== null && point.y <= level && point.y > bed;
    const box = new Box3(new Vector3(body.lake.bounds.min[0], body.owner.position.y - .15 - body.waves.height, body.lake.bounds.min[1]),
      new Vector3(body.lake.bounds.max[0], body.owner.position.y + .15 + body.waves.height, body.lake.bounds.max[1]));
    // Underground cameras are not underwater. Near-plane overlap is only an
    // activation gate; the closed volume's pixel mask decides actual coverage.
    if (!inside && (point.y <= bed && d !== null || !box.intersectsBox(near))) continue;
    const distance = inside ? Math.max(0, level! - point.y) : 1e6 + Math.abs(body.owner.position.y - point.y);
    if (distance < score || distance === score && body.lake.id < best!.lake.id) { best = body; score = distance; }
  }
  return best;
}
