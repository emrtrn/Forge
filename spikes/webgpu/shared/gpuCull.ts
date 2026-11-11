// S4 (c), G7: GPU-driven foliage for one rule. Every instance of the rule lives
// in a storage buffer; each frame a compute pass resets the indirect draw
// arguments, then tests every instance against the view frustum (bounding
// sphere = model radius x instance scale) and the type's cull distance, appends
// the visible ones to a second buffer with an atomic counter, and one
// drawIndexedIndirect draws them. The material reads its instance matrix from
// that buffer (`instanceIndex`), so sway and the dither fade stay as in the
// other modes. Main view only (the grass type casts no shadow). Throwaway spike code.
import * as THREE from "three/webgpu";
import * as TSLTyped from "three/tsl";

const TSL = TSLTyped as any;

export interface GpuCulledFoliage {
  object: THREE.Mesh;
  /** Per frame, before rendering: frustum planes and camera into the uniforms, then the cull dispatches. */
  cull(camera: THREE.PerspectiveCamera): void;
  /** Visible instance count of the last cull (async readback; diagnostics only). */
  readVisible(): Promise<number>;
  /** The same test on the CPU for `camera` (correctness check). */
  expectedVisible(camera: THREE.PerspectiveCamera): number;
  describe: Record<string, unknown>;
}

export interface GpuCullOptions {
  geometry: THREE.BufferGeometry;
  /** Source material (converted to a node material here). */
  material: THREE.Material;
  /** count * 16 floats, column-major per instance (node transform already applied). */
  matrices: Float32Array;
  count: number;
  /** Scale-1 bounding radius of the model. */
  radius: number;
  /** Cull distance (type cullEnd x quality scale); 0 = never. */
  cullEnd: number;
  /** Adds the instance-space effects (sway offset in world space, fade mask) given the instance origin and scale. */
  decorate?: (material: any, origin: any) => void;
}

export function createGpuCulledFoliage(renderer: THREE.WebGPURenderer, options: GpuCullOptions): GpuCulledFoliage {
  const { Fn, If, instancedArray, storage, uniform, uniformArray, instanceIndex, atomicAdd, atomicStore, vec4, float, uint, dot, length, distance, normalize, mat3, positionGeometry, normalGeometry, transformNormalToView } = TSL;
  const { geometry, count } = options;
  if (!geometry.index) throw new Error("gpu cull needs an indexed geometry");

  const source = instancedArray(options.matrices, "mat4");
  const visible = instancedArray(count, "mat4");
  // drawIndexedIndirect: indexCount, instanceCount, firstIndex, baseVertex, firstInstance.
  const args = new THREE.IndirectStorageBufferAttribute(new Uint32Array([geometry.index.count, 0, 0, 0, 0]), 1);
  const argsNode = storage(args, "uint", 5).toAtomic();

  const planes = Array.from({ length: 6 }, () => new THREE.Vector4());
  const planesNode = uniformArray(planes, "vec4");
  const cameraPosition = uniform(new THREE.Vector3());
  const cullEnd = uniform(options.cullEnd);
  const radius = float(options.radius);

  const reset = Fn(() => { atomicStore(argsNode.element(1), uint(0)); })().compute(1);
  const cullPass = Fn(() => {
    const m = source.element(instanceIndex);
    const center = m.element(3).xyz;
    const r = radius.mul(length(m.element(0).xyz));
    const inside = distance(center, cameraPosition).sub(r).lessThanEqual(cullEnd).or(cullEnd.lessThanEqual(0)).toVar();
    for (let i = 0; i < 6; i += 1) {
      const plane = planesNode.element(i);
      inside.assign(inside.and(dot(plane.xyz, center).add(plane.w).greaterThanEqual(r.negate())));
    }
    If(inside, () => {
      const slot = atomicAdd(argsNode.element(1), uint(1));
      visible.element(slot).assign(m);
    });
  })().compute(count);

  const library = (renderer as unknown as { library: { fromMaterial(m: THREE.Material): THREE.Material } }).library;
  const material = library.fromMaterial(options.material) as any;
  const m = visible.element(instanceIndex);
  const origin = vec4(m.element(3).xyz, length(m.element(0).xyz));
  material.positionNode = m.mul(vec4(positionGeometry, 1)).xyz;
  material.normalNode = transformNormalToView(normalize(mat3(m).mul(normalGeometry)));
  options.decorate?.(material, origin);

  const drawGeometry = new THREE.BufferGeometry();
  drawGeometry.index = geometry.index;
  for (const [name, attribute] of Object.entries(geometry.attributes)) drawGeometry.setAttribute(name, attribute);
  drawGeometry.setIndirect(args);
  const mesh = new THREE.Mesh(drawGeometry, material as THREE.Material);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = "foliage-gpu-cull";

  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  return {
    object: mesh,
    cull(camera) {
      projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreen, THREE.WebGPUCoordinateSystem);
      for (let i = 0; i < 6; i += 1) {
        const p = frustum.planes[i]!;
        planes[i]!.set(p.normal.x, p.normal.y, p.normal.z, p.constant);
      }
      cameraPosition.value.copy(camera.position);
      renderer.compute(reset);
      renderer.compute(cullPass);
    },
    expectedVisible(camera) {
      projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreen, THREE.WebGPUCoordinateSystem);
      const e = options.matrices;
      let n = 0;
      for (let i = 0; i < count; i += 1) {
        const c = new THREE.Vector3(e[i * 16 + 12], e[i * 16 + 13], e[i * 16 + 14]);
        const r = options.radius * Math.hypot(e[i * 16]!, e[i * 16 + 1]!, e[i * 16 + 2]!);
        if (options.cullEnd > 0 && c.distanceTo(camera.position) - r > options.cullEnd) continue;
        if (frustum.planes.every((p) => p.distanceToPoint(c) >= -r)) n += 1;
      }
      return n;
    },
    async readVisible() {
      const buffer = await renderer.getArrayBufferAsync(args);
      return new Uint32Array(buffer)[1]!;
    },
    describe: { instances: count, indexCount: geometry.index.count, radius: options.radius, cullEnd: options.cullEnd },
  };
}
