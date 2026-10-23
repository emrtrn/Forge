import {
  Box3,
  BufferAttribute,
  ClampToEdgeWrapping,
  DataArrayTexture,
  DataUtils,
  DynamicDrawUsage,
  FloatType,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Matrix4,
  Mesh,
  NearestFilter,
  Ray,
  RedFormat,
  RGBAFormat,
  RGFormat,
  Sphere,
  UnsignedByteType,
  Vector2,
  Vector3,
  type Camera,
  type Intersection,
  type Material,
  type MagnificationTextureFilter,
  type Object3D,
  type PixelFormat,
  type Raycaster,
  type TextureDataType,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";

import type { ForgeLandscapeData } from "@engine/scene/landscape";
import { TerrainLodSelector } from "@engine/terrain/terrainLod";
import {
  invalidateTerrainTileRange,
  raycastTerrain,
  type TerrainQueryDef,
  type TerrainTileLookup,
} from "@engine/terrain/terrainHeightQuery";
import {
  TERRAIN_PATCH_QUADS,
  TERRAIN_WEIGHT_BLOCKS,
  TerrainNodeHeightBounds,
  clampTerrainRect,
  computeTerrainNormals,
  copyLandscapeHeights,
  fullTerrainRect,
  packTerrainWeights,
  terrainRenderGrid,
  type TerrainRenderGrid,
  type TerrainVertexRect,
} from "@engine/terrain/terrainRenderData";
import type { TerrainTileData } from "@engine/terrain/terrainTypes";
import {
  createTerrainMaterials,
  setTerrainAppearance,
  type TerrainLayerInput,
  type TerrainMaterials,
  type TerrainViewMode,
} from "./terrainMaterial";

/**
 * GPU CDLOD renderer for one Landscape grid (OPEN_WORLD_PLAN Faz 2, first slice:
 * the 1×1 Landscape). One instanced patch mesh is placed per selected quadtree
 * node; heights, normals and paint weights live in `DataArrayTexture` slots
 * (slot 0 only, until tiles stream). Any authored `verticesX × verticesZ` grid
 * is drawn inside a padded power-of-two square (see `terrainRenderData.ts`);
 * vertices and picking stop at the authored edge. The mesh has no CPU
 * vertices, so picking goes through the heightfield raycast and the passes that
 * override scene materials draw it with {@link renderSceneWithTerrainOverride}.
 *
 * Frames: the mesh sits in its parent's (the Landscape actor's) frame; the grid
 * corner is at `origin`, so a centred grid has `origin = (-halfX, 0, -halfZ)`.
 */

export interface TerrainRendererOptions {
  viewMode: TerrainViewMode;
  activeLayer: number;
  layers: TerrainLayerInput[];
  /** Mesh-frame position of the grid's min corner. */
  origin: Vector3;
}

export type TerrainOverrideKind = "normal" | "depth";

const MESH_NAME = "landscape-terrain";

function arrayTexture(
  data: Float32Array | Uint16Array | Uint8Array,
  size: number,
  depth: number,
  format: PixelFormat,
  type: TextureDataType,
  filter: MagnificationTextureFilter,
): DataArrayTexture {
  const texture = new DataArrayTexture(data, size, size, depth);
  texture.format = format;
  texture.type = type;
  texture.minFilter = filter;
  texture.magFilter = filter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** Unit patch: `(P + 1)²` vertices over [0, 1]², split like the legacy mesh. */
function createPatchGeometry(patchQuads: number, capacity: number): InstancedBufferGeometry {
  const verts = patchQuads + 1;
  const positions = new Float32Array(verts * verts * 3);
  for (let z = 0; z < verts; z += 1) {
    for (let x = 0; x < verts; x += 1) {
      const index = (z * verts + x) * 3;
      positions[index] = x / patchQuads;
      positions[index + 2] = z / patchQuads;
    }
  }
  const indices = new Uint16Array(patchQuads * patchQuads * 6);
  let cursor = 0;
  for (let z = 0; z < patchQuads; z += 1) {
    for (let x = 0; x < patchQuads; x += 1) {
      const a = z * verts + x;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], cursor);
      cursor += 6;
    }
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  for (const name of ["terrainNodeA", "terrainNodeB"]) {
    const attribute = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  geometry.instanceCount = 0;
  return geometry;
}

function isVisibleInHierarchy(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

export class TerrainRenderer {
  readonly mesh: Mesh<InstancedBufferGeometry, Material>;
  private readonly materials: TerrainMaterials;
  private readonly grid: TerrainRenderGrid;
  private readonly spacing: number;
  private readonly origin: Vector3;
  /** Terrain-local edge lengths of the authored grid. */
  private readonly extent: Vector2;
  private readonly heights: Float32Array;
  private readonly normals: Float32Array;
  private readonly normalTexels: Uint16Array;
  private readonly weights: Uint8Array;
  private readonly heightTexture: DataArrayTexture;
  private readonly normalTexture: DataArrayTexture;
  private readonly weightTexture: DataArrayTexture;
  private readonly bounds: TerrainNodeHeightBounds;
  private readonly selector: TerrainLodSelector;
  private readonly tile: TerrainTileData;
  private readonly queryDef: TerrainQueryDef;
  private readonly lookup: TerrainTileLookup;
  private readonly lastCamera = new Vector3(Number.NaN, Number.NaN, Number.NaN);
  private readonly cameraScratch = new Vector3();
  private selectionDirty = true;

  constructor(private readonly data: ForgeLandscapeData, options: TerrainRendererOptions) {
    this.grid = terrainRenderGrid(data.size);
    const { stride } = this.grid;
    this.spacing = data.size.spacing;
    this.origin = options.origin.clone();
    this.extent = new Vector2((this.grid.verticesX - 1) * this.spacing, (this.grid.verticesZ - 1) * this.spacing);
    const texels = stride * stride;
    this.heights = new Float32Array(texels);
    this.normals = new Float32Array(texels * 2);
    this.normalTexels = new Uint16Array(texels * 2);
    this.weights = new Uint8Array(texels * 4 * TERRAIN_WEIGHT_BLOCKS);
    this.heightTexture = arrayTexture(this.heights, stride, 1, RedFormat, FloatType, NearestFilter);
    this.normalTexture = arrayTexture(this.normalTexels, stride, 1, RGFormat, HalfFloatType, LinearFilter);
    this.weightTexture = arrayTexture(this.weights, stride, TERRAIN_WEIGHT_BLOCKS, RGBAFormat, UnsignedByteType, LinearFilter);
    this.fill(fullTerrainRect(this.grid));
    this.bounds = new TerrainNodeHeightBounds(this.heights, stride);

    const quads = stride - 1;
    const world = { tileQuads: quads, spacing: this.spacing, tilesX: 1, tilesZ: 1, origin: [0, 0, 0] as [number, number, number] };
    this.selector = new TerrainLodSelector(world, (level, ix, iz) => this.bounds.node(level, ix, iz), {
      patchQuads: TERRAIN_PATCH_QUADS,
    });
    this.tile = { x: 0, z: 0, size: stride, heights: this.heights, layerCount: 0, weights: new Uint8Array(0) };
    this.queryDef = { tileQuads: quads, spacing: this.spacing, tilesX: 1, tilesZ: 1, origin: [0, 0, 0] };
    this.lookup = { tile: (x, z) => (x === 0 && z === 0 ? this.tile : undefined) };

    this.materials = createTerrainMaterials({
      heights: this.heightTexture,
      normals: this.normalTexture,
      weights: this.weightTexture,
      origin: this.origin,
      spacing: this.spacing,
      tileVertices: stride,
      extent: this.extent,
      patchQuads: TERRAIN_PATCH_QUADS,
      viewMode: options.viewMode,
      activeLayer: options.activeLayer,
      heightRange: new Vector2(),
      layers: options.layers,
    });
    this.updateHeightRange(this.bounds.range());

    const leaves = quads / TERRAIN_PATCH_QUADS;
    this.mesh = new Mesh(createPatchGeometry(TERRAIN_PATCH_QUADS, leaves * leaves), this.materials.material);
    this.mesh.name = MESH_NAME;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.userData.forgeTerrain = this;
    this.mesh.raycast = (raycaster, intersects) => this.raycast(raycaster, intersects);
    this.updateBoundingVolumes();
    // Until the first camera update, draw the whole grid from a far viewpoint.
    this.select(new Vector3(0, Number.MAX_SAFE_INTEGER / 4, 0));
  }

  /** Re-selects the quadtree for `camera`; call once per frame before rendering. */
  updateLod(camera: Camera): void {
    this.mesh.updateWorldMatrix(true, false);
    const local = this.mesh.worldToLocal(camera.getWorldPosition(this.cameraScratch)).sub(this.origin);
    const threshold = this.selector.settings.leafSize * 0.01;
    if (!this.selectionDirty && local.distanceToSquared(this.lastCamera) < threshold * threshold) return;
    this.select(local);
  }

  /** Re-reads heights/weights inside `rect` (inclusive vertex bounds) after an edit. */
  updateData(rect: TerrainVertexRect): void {
    const area = clampTerrainRect(rect, this.grid);
    this.fill(area);
    // An edit on the authored edge also rewrote the padding beyond it.
    const last = this.grid.stride - 1;
    this.bounds.update({
      x0: area.x0,
      z0: area.z0,
      x1: area.x1 === this.grid.verticesX - 1 ? last : area.x1,
      z1: area.z1 === this.grid.verticesZ - 1 ? last : area.z1,
    });
    invalidateTerrainTileRange(this.tile);
    this.updateHeightRange(this.bounds.range());
    this.updateBoundingVolumes();
    this.selectionDirty = true;
  }

  /** Debug view, active paint layer and per-layer colours; no texture work. */
  setAppearance(viewMode: TerrainViewMode, activeLayer: number, colors: readonly string[]): void {
    setTerrainAppearance(this.materials.uniforms, viewMode, activeLayer, colors);
  }

  /**
   * Draws the terrain into `target` with the matching override material, for a
   * pass that rendered the scene with `scene.overrideMaterial` and the terrain
   * hidden. Leaves `target` bound and the clear state untouched.
   */
  renderOverride(renderer: WebGLRenderer, camera: Camera, target: WebGLRenderTarget | null, kind: TerrainOverrideKind): void {
    const visible = this.mesh.visible;
    this.mesh.visible = true;
    if (!isVisibleInHierarchy(this.mesh)) {
      this.mesh.visible = visible;
      return;
    }
    const material = this.mesh.material;
    const autoClear = renderer.autoClear;
    this.mesh.material = kind === "normal" ? this.materials.normalMaterial : this.materials.depthMaterial;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, camera);
    renderer.autoClear = autoClear;
    this.mesh.material = material;
    this.mesh.visible = visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.materials.material.dispose();
    this.materials.normalMaterial.dispose();
    this.materials.depthMaterial.dispose();
    this.heightTexture.dispose();
    this.normalTexture.dispose();
    this.weightTexture.dispose();
  }

  private fill(rect: TerrainVertexRect): void {
    const { stride } = this.grid;
    copyLandscapeHeights(this.data, this.grid, this.heights, rect);
    // A height change moves its neighbours' central-difference normals too.
    const normalRect = clampTerrainRect(rect, this.grid, 1);
    computeTerrainNormals(this.heights, stride, this.spacing, this.normals, normalRect);
    for (let z = normalRect.z0; z <= normalRect.z1; z += 1) {
      for (let x = normalRect.x0; x <= normalRect.x1; x += 1) {
        const index = (z * stride + x) * 2;
        this.normalTexels[index] = DataUtils.toHalfFloat(this.normals[index]!);
        this.normalTexels[index + 1] = DataUtils.toHalfFloat(this.normals[index + 1]!);
      }
    }
    packTerrainWeights(this.data, this.grid, this.weights, rect);
    this.heightTexture.needsUpdate = true;
    this.normalTexture.needsUpdate = true;
    this.weightTexture.needsUpdate = true;
  }

  private updateHeightRange(range: { min: number; max: number }): void {
    // A flat terrain still gets a visible gradient range in the height view.
    const flat = Math.abs(range.max - range.min) < 0.0001;
    (this.materials.uniforms.uTerrainHeightRange!.value as Vector2).set(
      flat ? range.min - 0.5 : range.min,
      flat ? range.max + 0.5 : range.max,
    );
  }

  private updateBoundingVolumes(): void {
    const range = this.bounds.range();
    const geometry = this.mesh.geometry;
    geometry.boundingBox = new Box3(
      new Vector3(this.origin.x, this.origin.y + range.min, this.origin.z),
      new Vector3(this.origin.x + this.extent.x, this.origin.y + range.max, this.origin.z + this.extent.y),
    );
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
  }

  private select(cameraLocal: Vector3): void {
    this.lastCamera.copy(cameraLocal);
    this.selectionDirty = false;
    (this.materials.uniforms.uTerrainLodCamera!.value as Vector3).copy(cameraLocal);
    const geometry = this.mesh.geometry;
    const a = geometry.getAttribute("terrainNodeA") as InstancedBufferAttribute;
    const b = geometry.getAttribute("terrainNodeB") as InstancedBufferAttribute;
    let count = 0;
    for (const node of this.selector.select([cameraLocal.x, cameraLocal.y, cameraLocal.z])) {
      // Nodes wholly in the padding would collapse onto the edge; skip them.
      if (node.offsetX >= this.extent.x || node.offsetZ >= this.extent.y || count >= a.count) continue;
      a.setXYZW(count, node.offsetX, node.offsetZ, node.size, 0);
      b.setXYZW(count, 0, 0, node.morphRange[0], node.morphRange[1]);
      count += 1;
    }
    a.needsUpdate = true;
    b.needsUpdate = true;
    geometry.instanceCount = count;
  }

  private raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const inverse = new Matrix4().copy(this.mesh.matrixWorld).invert();
    const ray = new Ray().copy(raycaster.ray).applyMatrix4(inverse);
    ray.origin.sub(this.origin);
    // Clip to the authored rectangle so the padding's edge shelf is never hit.
    const [x0, x1] = slab(ray.origin.x, ray.direction.x, 0, this.extent.x);
    const [z0, z1] = slab(ray.origin.z, ray.direction.z, 0, this.extent.y);
    const enter = Math.max(0, x0, z0);
    const exit = Math.min(x1, z1);
    if (!(enter <= exit)) return;
    const start = ray.at(enter, new Vector3());
    const hit = raycastTerrain(this.queryDef, this.lookup, start.toArray(), ray.direction.toArray(), exit - enter);
    if (!hit) return;
    const point = new Vector3(...hit.point).add(this.origin).applyMatrix4(this.mesh.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(point);
    if (distance < raycaster.near || distance > raycaster.far) return;
    intersects.push({
      distance,
      point,
      object: this.mesh,
      face: { a: 0, b: 0, c: 0, normal: new Vector3(...hit.normal), materialIndex: 0 },
      faceIndex: 0,
    });
  }
}

/** Ray parameter interval where `start + dir·t` lies in `[lo, hi]` on one axis. */
function slab(start: number, dir: number, lo: number, hi: number): [number, number] {
  if (Math.abs(dir) < 1e-12) return start >= lo && start <= hi ? [-Infinity, Infinity] : [Infinity, -Infinity];
  const t0 = (lo - start) / dir;
  const t1 = (hi - start) / dir;
  return t0 < t1 ? [t0, t1] : [t1, t0];
}

/** The terrain renderer behind an object, if it is a CDLOD terrain mesh. */
export function terrainRendererOf(object: Object3D): TerrainRenderer | null {
  const renderer = object.userData.forgeTerrain;
  return renderer instanceof TerrainRenderer ? renderer : null;
}

/**
 * Runs `render` — a pass drawing `scene` with `scene.overrideMaterial` — with
 * every visible terrain hidden, then draws those terrains with their own
 * displacing `kind` material into the same target as the scene render ends.
 * Without this the override material draws the flat instanced patch.
 */
export function renderSceneWithTerrainOverride(scene: Object3D, kind: TerrainOverrideKind, render: () => void): void {
  const terrains: TerrainRenderer[] = [];
  scene.traverse((object) => {
    const terrain = terrainRendererOf(object);
    if (terrain && object.visible) terrains.push(terrain);
  });
  if (terrains.length === 0) {
    render();
    return;
  }
  for (const terrain of terrains) terrain.mesh.visible = false;
  const onAfterRender = scene.onAfterRender;
  scene.onAfterRender = (renderer, renderedScene, camera, geometry, material, group) => {
    onAfterRender.call(scene, renderer, renderedScene, camera, geometry, material, group);
    const target = renderer.getRenderTarget();
    for (const terrain of terrains) terrain.renderOverride(renderer, camera, target, kind);
  };
  try {
    render();
  } finally {
    scene.onAfterRender = onAfterRender;
    for (const terrain of terrains) terrain.mesh.visible = true;
  }
}
