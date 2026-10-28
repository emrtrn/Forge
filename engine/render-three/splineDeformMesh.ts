import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Material,
  Mesh,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { LayoutSplineActor, Vec3 } from "@engine/scene/layout";
import { buildSplineCurveCache, type SplineCurveCache } from "@engine/scene/splineCurve";
import { getSplineTransformAtDistance, type SplineFrame } from "@engine/scene/splineFrame";
import {
  resolveSplineDeformMeshGenerator,
  type ForgeSplineDeformMeshGeneratorDef,
  type SplineMeshAxis,
} from "@engine/scene/splineGenerator";

interface SourceMeshTemplate {
  geometry: BufferGeometry;
  material: Material | Material[];
}

interface FrameSample {
  distance: number;
  frame: SplineFrame;
}

const sourceTemplateCache = new WeakMap<GLTF, SourceMeshTemplate[]>();

/**
 * Builds disposable world-space geometry by mapping an authored mesh's forward
 * coordinate to the owning spline's arc length. Source templates are cached by
 * GLTF so interactive point edits only allocate the generated geometry.
 */
export function buildSplineDeformMeshGroup(options: {
  actor: LayoutSplineActor;
  gltf: GLTF;
  definition: ForgeSplineDeformMeshGeneratorDef;
  /** When supplied, build one independently disposable spline segment chunk. */
  segmentIndex?: number;
  castShadow: boolean;
  receiveShadow: boolean;
  /** The actor's curve, when the caller builds several chunks from it (saves a rebuild per chunk). */
  cache?: SplineCurveCache;
  /**
   * Source material → the clone every chunk of one build shares. Its owner
   * disposes the clones ({@link disposeSplineSharedMaterials}); chunk disposal
   * leaves them alone. Without it each mesh gets, and disposes, its own clone.
   */
  sharedMaterials?: Map<Material, Material>;
}): { group: Group | null; triangleCount: number; warnings: string[] } {
  const generator = resolveSplineDeformMeshGenerator(options.definition);
  const cache = options.cache ?? buildSplineCurveCache(options.actor.spline);
  if (cache.totalLength <= 1e-8 || cache.segments.length === 0) {
    return { group: null, triangleCount: 0, warnings: ["Spline needs at least one non-zero segment before a mesh can be deformed."] };
  }
  const templates = sourceTemplates(options.gltf);
  if (templates.length === 0) return { group: null, triangleCount: 0, warnings: ["Selected mesh contains no supported static geometry."] };

  const bounds = sourceForwardBounds(templates, generator.forwardAxis);
  if (!bounds || bounds.length <= 1e-6) {
    return { group: null, triangleCount: 0, warnings: [`Mesh has no usable ${generator.forwardAxis} forward length.`] };
  }

  const segment = options.segmentIndex === undefined ? undefined : cache.segments[options.segmentIndex];
  if (options.segmentIndex !== undefined && !segment) {
    return { group: null, triangleCount: 0, warnings: [`Spline segment ${options.segmentIndex} no longer exists.`] };
  }
  const samples = buildFrameSamples(options.actor, cache, generator.sampleSteps, segment && {
    startDistance: segment.startDistance,
    length: segment.length,
  });
  const group = new Group();
  group.name = `SplineDeformMesh:${options.actor.id}:${generator.id}${segment ? `:segment-${options.segmentIndex}` : ""}`;
  group.userData.splineActorId = options.actor.id;
  group.userData.splineGeneratorId = generator.id;
  group.userData.splineGenerated = true;
  group.userData.splineGeneratedGeometry = true;
  group.userData.splineSampleSteps = generator.sampleSteps;
  group.userData.splineSegmentIndex = options.segmentIndex;
  group.visible = !(options.actor.hidden ?? false);
  let triangleCount = 0;
  let missingUvs = false;
  for (const template of templates) {
    const geometry = deformGeometry(template.geometry, bounds, samples, generator);
    missingUvs ||= !template.geometry.getAttribute("uv");
    triangleCount += geometry.index ? geometry.index.count / 3 : geometry.getAttribute("position").count / 3;
    const shared = options.sharedMaterials;
    const mesh = new Mesh(geometry, shared ? sharedClone(template.material, shared) : cloneMaterial(template.material));
    mesh.userData.splineGeneratedGeometry = true;
    if (shared) mesh.userData.splineSharedMaterial = true;
    mesh.castShadow = options.castShadow;
    mesh.receiveShadow = options.receiveShadow;
    mesh.raycast = () => {};
    group.add(mesh);
  }
  group.userData.splineTriangleCount = triangleCount;
  const warnings = missingUvs && generator.uvMode === "tileByDistance"
    ? ["Mesh has no UVs; tile-by-distance generated a basic UV coordinate."]
    : [];
  return { group, triangleCount, warnings };
}

/** Disposes only generated resources; source GLTF geometry/materials remain cache-owned. */
export function disposeSplineDeformMeshGroup(group: Group): void {
  group.traverse((child) => {
    if (!(child instanceof Mesh) || !child.userData.splineGeneratedGeometry && !group.userData.splineGeneratedGeometry) return;
    child.geometry.dispose();
    if (child.userData.splineSharedMaterial) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
  group.removeFromParent();
}

/** Disposes the clones a build's chunks shared ({@link buildSplineDeformMeshGroup} `sharedMaterials`). */
export function disposeSplineSharedMaterials(shared: Map<Material, Material> | undefined): void {
  for (const material of shared?.values() ?? []) material.dispose();
  shared?.clear();
}

/**
 * Extracts generated world-space triangles for the optional static physics
 * bridge. The render mesh is the single source of deformation truth, avoiding
 * a second, subtly different CPU curve implementation for collision.
 */
export function splineDeformMeshColliderPrimitive(group: Group): { vertices: Vec3[]; indices: number[]; size: Vec3 } | null {
  const vertices: Vec3[] = [];
  const indices: number[] = [];
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  group.traverse((child) => {
    if (!(child instanceof Mesh) || !child.userData.splineGeneratedGeometry) return;
    const position = child.geometry.getAttribute("position");
    if (!position) return;
    const offset = vertices.length;
    for (let index = 0; index < position.count; index += 1) {
      const vertex: Vec3 = [position.getX(index), position.getY(index), position.getZ(index)];
      vertices.push(vertex);
      min = [Math.min(min[0], vertex[0]), Math.min(min[1], vertex[1]), Math.min(min[2], vertex[2])];
      max = [Math.max(max[0], vertex[0]), Math.max(max[1], vertex[1]), Math.max(max[2], vertex[2])];
    }
    const sourceIndices = child.geometry.index;
    if (sourceIndices) {
      for (let index = 0; index < sourceIndices.count; index += 1) indices.push(offset + sourceIndices.getX(index));
    } else {
      for (let index = 0; index < position.count; index += 1) indices.push(offset + index);
    }
  });
  if (vertices.length === 0 || indices.length < 3) return null;
  return { vertices, indices, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

function sourceTemplates(gltf: GLTF): SourceMeshTemplate[] {
  const cached = sourceTemplateCache.get(gltf);
  if (cached) return cached;
  gltf.scene.updateMatrixWorld(true);
  const templates: SourceMeshTemplate[] = [];
  gltf.scene.traverse((child) => {
    if (!(child instanceof Mesh) || !child.geometry.getAttribute("position")) return;
    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    templates.push({ geometry, material: child.material });
  });
  sourceTemplateCache.set(gltf, templates);
  return templates;
}

function sourceForwardBounds(templates: readonly SourceMeshTemplate[], axis: SplineMeshAxis): { min: number; length: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const template of templates) {
    const position = template.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      const value = axisComponent(position.getX(index), position.getY(index), position.getZ(index), axis);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, length: max - min } : null;
}

function buildFrameSamples(
  actor: LayoutSplineActor,
  cache: SplineCurveCache,
  steps: number,
  range?: { startDistance: number; length: number },
): FrameSample[] {
  const startDistance = range?.startDistance ?? 0;
  const length = range?.length ?? cache.totalLength;
  const segmentCount = range ? 1 : cache.segments.length;
  const count = Math.max(2, segmentCount * Math.max(2, steps) + 1);
  return Array.from({ length: count }, (_, index) => {
    const distance = startDistance + length * (index / (count - 1));
    return { distance, frame: getSplineTransformAtDistance(cache, distance, "world", actor).frame };
  });
}

function deformGeometry(
  source: BufferGeometry,
  bounds: { min: number; length: number },
  samples: readonly FrameSample[],
  generator: ReturnType<typeof resolveSplineDeformMeshGenerator>,
): BufferGeometry {
  const geometry = source.clone();
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv") ?? new BufferAttribute(new Float32Array(position.count * 2), 2);
  if (!geometry.getAttribute("uv")) geometry.setAttribute("uv", uv);
  const startDistance = samples[0]!.distance;
  const length = samples.at(-1)!.distance - startDistance;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    const forward = axisComponent(x, y, z, generator.forwardAxis);
    const up = axisComponent(x, y, z, generator.upAxis);
    const right = axisComponent(x, y, z, rightAxis(generator.forwardAxis, generator.upAxis));
    const fraction = Math.min(1, Math.max(0, (forward - bounds.min) / bounds.length));
    const distance = startDistance + fraction * length;
    const frame = frameAt(samples, distance);
    const lateral = right * generator.crossSectionScale[0] * frame.scale[0] + generator.lateralOffset;
    const vertical = up * generator.crossSectionScale[1] * frame.scale[1] + generator.verticalOffset;
    position.setXYZ(
      index,
      frame.position[0] + frame.binormal[0] * lateral + frame.normal[0] * vertical,
      frame.position[1] + frame.binormal[1] * lateral + frame.normal[1] * vertical,
      frame.position[2] + frame.binormal[2] * lateral + frame.normal[2] * vertical,
    );
    if (generator.uvMode === "tileByDistance") uv.setY(index, distance / generator.uvTileLength);
  }
  position.needsUpdate = true;
  uv.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function frameAt(samples: readonly FrameSample[], distance: number): SplineFrame {
  const last = samples.length - 1;
  if (distance <= samples[0]!.distance) return samples[0]!.frame;
  if (distance >= samples[last]!.distance) return samples[last]!.frame;
  let low = 0;
  let high = last;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (samples[middle]!.distance <= distance) low = middle;
    else high = middle;
  }
  const start = samples[low]!;
  const end = samples[high]!;
  const alpha = (distance - start.distance) / Math.max(1e-8, end.distance - start.distance);
  return {
    ...start.frame,
    position: lerpVec3(start.frame.position, end.frame.position, alpha),
    tangent: normalize(lerpVec3(start.frame.tangent, end.frame.tangent, alpha), [0, 0, 1]),
    normal: normalize(lerpVec3(start.frame.normal, end.frame.normal, alpha), [0, 1, 0]),
    binormal: normalize(lerpVec3(start.frame.binormal, end.frame.binormal, alpha), [1, 0, 0]),
    scale: [lerp(start.frame.scale[0], end.frame.scale[0], alpha), lerp(start.frame.scale[1], end.frame.scale[1], alpha)],
  };
}

function rightAxis(forward: SplineMeshAxis, up: SplineMeshAxis): SplineMeshAxis {
  const forwardVector = axisVector(forward);
  const upVector = axisVector(up);
  const right: Vec3 = [
    upVector[1] * forwardVector[2] - upVector[2] * forwardVector[1],
    upVector[2] * forwardVector[0] - upVector[0] * forwardVector[2],
    upVector[0] * forwardVector[1] - upVector[1] * forwardVector[0],
  ];
  const axis = Math.abs(right[0]) >= Math.abs(right[1]) && Math.abs(right[0]) >= Math.abs(right[2]) ? 0
    : Math.abs(right[1]) >= Math.abs(right[2]) ? 1 : 2;
  return `${right[axis]! < 0 ? "-" : ""}${["x", "y", "z"][axis]!}` as SplineMeshAxis;
}

function axisComponent(x: number, y: number, z: number, axis: SplineMeshAxis): number {
  const vector = axisVector(axis);
  return x * vector[0] + y * vector[1] + z * vector[2];
}

function axisVector(axis: SplineMeshAxis): Vec3 {
  switch (axis) {
    case "x": return [1, 0, 0]; case "-x": return [-1, 0, 0];
    case "y": return [0, 1, 0]; case "-y": return [0, -1, 0];
    case "z": return [0, 0, 1]; case "-z": return [0, 0, -1];
  }
}

function sharedClone(value: Material | Material[], shared: Map<Material, Material>): Material | Material[] {
  const one = (material: Material): Material => {
    let clone = shared.get(material);
    if (!clone) shared.set(material, clone = material.clone());
    return clone;
  };
  return Array.isArray(value) ? value.map(one) : one(value);
}

function cloneMaterial(value: Material | Material[]): Material | Material[] {
  return Array.isArray(value) ? value.map((material) => material.clone()) : value.clone();
}
function lerp(start: number, end: number, alpha: number): number { return start + (end - start) * alpha; }
function lerpVec3(a: Vec3, b: Vec3, alpha: number): Vec3 { return [lerp(a[0], b[0], alpha), lerp(a[1], b[1], alpha), lerp(a[2], b[2], alpha)]; }
function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const length = Math.hypot(...value);
  return length > 1e-8 ? [value[0] / length, value[1] / length, value[2] / length] : fallback;
}
