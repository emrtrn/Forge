import {
  BufferAttribute,
  DataTexture,
  FloatType,
  Frustum,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  NearestFilter,
  Ray,
  RGBAFormat,
  Sphere,
  Box3,
  Vector2,
  Vector3,
  type Camera,
  type Intersection,
  type Raycaster,
} from "three";

import type { TerrainDirtyRect } from "@engine/terrain/terrainEdit";
import { buildTerrainGlobalMap, updateTerrainGlobalMap, type TerrainGlobalMap } from "@engine/terrain/terrainGlobalMap";
import { TerrainLodSelector, type TerrainLodBox } from "@engine/terrain/terrainLod";
import {
  raycastTerrainRenderSource,
  terrainRenderNodeHeights,
  terrainRenderSourceHeightRange,
  type TerrainRenderSource,
} from "@engine/terrain/terrainRenderSource";
import { tileKey } from "@engine/terrain/terrainTypes";

import { applyTerrainLook, createTerrainMaterial, type TerrainLook, type TerrainMaterial } from "./terrainMaterial";
import { TerrainTexturePool } from "./terrainTexturePool";

/**
 * GPU CDLOD terrain renderer (OPEN_WORLD_PLAN K2, Faz 2). One shared flat
 * patch is drawn once per selected quadtree node in a single instanced draw;
 * the vertex shader displaces it from resident tile heights (`TerrainTexturePool`)
 * or the global map, morphing between LODs so there are no cracks or pops.
 *
 * Node selection runs in the mesh's `onBeforeRender` for whichever camera is
 * drawing (main view, planar reflections, cube captures), with that camera's
 * frustum, in the renderer's local frame — so the terrain can sit under a
 * rotated Landscape actor. Nodes are packed into a float texture that the
 * shader indexes with `gl_InstanceID`.
 *
 * The displaced surface has no CPU geometry, so the mesh overrides `raycast`
 * with the exact CPU heightfield raycast, clipped to the drawn footprint; every
 * three.js picking path (selection, sculpt, foliage, drag-drop) keeps working.
 */

export const TERRAIN_MESH_NAME = "landscape-terrain";
const DEFAULT_PATCH_QUADS = 32;
const DEFAULT_MAX_NODES = 2048;
const NODE_TEXTURE_WIDTH = 1024;

export interface TerrainRendererOptions {
  patchQuads?: number;
  maxNodes?: number;
}

export interface TerrainRenderStats {
  nodes: number;
  triangles: number;
}

/** Flat `quads²` patch on [0, 1]², split along the b–c diagonal like the collider. */
export function createTerrainPatchGeometry(quads: number): InstancedBufferGeometry {
  const side = quads + 1;
  const positions = new Float32Array(side * side * 3);
  for (let z = 0; z < side; z += 1) {
    for (let x = 0; x < side; x += 1) {
      const index = (z * side + x) * 3;
      positions[index] = x / quads;
      positions[index + 2] = z / quads;
    }
  }
  const indices = new Uint16Array(quads * quads * 6);
  let cursor = 0;
  for (let z = 0; z < quads; z += 1) {
    for (let x = 0; x < quads; x += 1) {
      const a = z * side + x;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], cursor);
      cursor += 6;
    }
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.instanceCount = 0;
  return geometry;
}

/**
 * Writes one node into the node texture data: texel 2n = offset x/z, size,
 * level; texel 2n+1 = slot (-1 = global map), tile origin x/z. All terrain-local.
 */
export function packTerrainNode(
  data: Float32Array,
  index: number,
  offsetX: number,
  offsetZ: number,
  size: number,
  level: number,
  slot: number,
  tileOriginX: number,
  tileOriginZ: number,
): void {
  const base = index * 8;
  data[base] = offsetX;
  data[base + 1] = offsetZ;
  data[base + 2] = size;
  data[base + 3] = level;
  data[base + 4] = slot;
  data[base + 5] = tileOriginX;
  data[base + 6] = tileOriginZ;
  data[base + 7] = 0;
}

export class TerrainRenderer {
  readonly mesh: Mesh<InstancedBufferGeometry>;
  readonly source: TerrainRenderSource;
  readonly stats: TerrainRenderStats = { nodes: 0, triangles: 0 };
  private readonly pool: TerrainTexturePool;
  private readonly global: TerrainGlobalMap;
  private readonly selector: TerrainLodSelector;
  private readonly nodeHeights: ReturnType<typeof terrainRenderNodeHeights>;
  private readonly nodeTexture: DataTexture;
  private readonly nodeData: Float32Array;
  private readonly maxNodes: number;
  private readonly terrainMaterial: TerrainMaterial;
  /** Height span of the data (relative to the datum), padded when flat. */
  private heightRange = { min: 0, max: 1 };
  private readonly patchTriangles: number;
  // Scratch, reused every render so selection allocates nothing per frame.
  private readonly toLocal = new Matrix4();
  private readonly viewProjection = new Matrix4();
  private readonly frustum = new Frustum();
  private readonly box = new Box3();
  private readonly localCamera = new Vector3();
  private readonly cameraTuple: [number, number, number] = [0, 0, 0];
  private readonly localRay = new Ray();

  constructor(source: TerrainRenderSource, look: TerrainLook, options: TerrainRendererOptions = {}) {
    this.source = source;
    const patchQuads = Math.min(options.patchQuads ?? DEFAULT_PATCH_QUADS, source.def.tileQuads);
    this.maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    this.patchTriangles = patchQuads * patchQuads * 2;
    this.nodeHeights = terrainRenderNodeHeights(source, patchQuads * source.def.spacing);
    this.selector = new TerrainLodSelector(source.def, this.nodeHeights, {
      patchQuads,
      extent: [source.extentX, source.extentZ],
    });
    this.global = buildTerrainGlobalMap(source.def, source.tiles, patchQuads);
    const tileCount = source.def.tilesX * source.def.tilesZ;
    this.pool = new TerrainTexturePool(source.def.tileQuads + 1, Math.min(80, tileCount), source.layerCount, this.global);
    // Faz 2 keeps every listed tile resident; streaming (Faz 4) will drive acquire/release.
    for (const tile of source.tiles.values()) this.pool.acquire(tile);

    const rows = Math.ceil((this.maxNodes * 2) / NODE_TEXTURE_WIDTH);
    this.nodeData = new Float32Array(NODE_TEXTURE_WIDTH * rows * 4);
    this.nodeTexture = new DataTexture(this.nodeData, NODE_TEXTURE_WIDTH, rows, RGBAFormat, FloatType);
    this.nodeTexture.minFilter = NearestFilter;
    this.nodeTexture.magFilter = NearestFilter;
    this.nodeTexture.generateMipmaps = false;
    this.nodeTexture.needsUpdate = true;

    this.terrainMaterial = createTerrainMaterial(
      {
        heights: this.pool.heights,
        weights: this.pool.weights,
        globalHeights: this.pool.globalHeights,
        nodes: this.nodeTexture,
        origin: new Vector3(...source.def.origin),
        tileSpacing: source.def.spacing,
        globalSpacing: source.def.spacing * this.global.stride,
        tileTexels: source.def.tileQuads + 1,
        globalSize: new Vector2(this.global.width, this.global.height),
        extent: new Vector2(source.extentX, source.extentZ),
        morph: this.selector.morphRanges,
        patchQuads,
        weightBlocks: this.pool.weightBlocks,
      },
      look,
    );

    const geometry = createTerrainPatchGeometry(patchQuads);
    this.mesh = new Mesh(geometry, this.terrainMaterial.material);
    this.mesh.name = TERRAIN_MESH_NAME;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    // GTAO's override normal material would drop the displacement (OPEN_WORLD_PLAN Faz 7).
    this.mesh.userData.noAmbientOcclusion = true;
    this.mesh.userData.forgeTerrain = this;
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => this.select(camera);
    this.mesh.raycast = (raycaster, intersects) => this.raycast(raycaster, intersects);
    this.updateBounds();
  }

  /** Packed node texels of the last selection (8 floats per node), for debug views and tests. */
  get nodeBuffer(): Float32Array {
    return this.nodeData.subarray(0, this.stats.nodes * 8);
  }

  get material(): TerrainMaterial["material"] {
    return this.terrainMaterial.material;
  }

  /** Re-sends an edited tile region (tile-local vertex rect) to the GPU. */
  updateTile(x: number, z: number, rect?: TerrainDirtyRect): void {
    const tile = this.source.tiles.tile(x, z);
    if (!tile) return;
    this.pool.update(tile, rect);
    this.nodeHeights.invalidate(tile);
    const q = this.source.def.tileQuads;
    const clamped = rect && {
      x0: Math.max(0, rect.x0), x1: Math.min(q, rect.x1), z0: Math.max(0, rect.z0), z1: Math.min(q, rect.z1),
    };
    if (!clamped || (clamped.x0 <= clamped.x1 && clamped.z0 <= clamped.z1)) {
      if (updateTerrainGlobalMap(this.global, this.source.def, this.source.tiles, tileKey(x, z), clamped)) this.pool.updateGlobal();
    }
    this.updateBounds();
  }

  /** Colours, textures and view mode; the height range always follows the data. */
  setLook(look: TerrainLook): void {
    applyTerrainLook(this.terrainMaterial, { ...look, heightRange: this.heightRange });
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.terrainMaterial.material.dispose();
    this.nodeTexture.dispose();
    this.pool.dispose();
  }

  /** Selects and packs this camera's nodes; runs right before the draw. */
  select(camera: Camera): void {
    const mesh = this.mesh;
    this.toLocal.copy(mesh.matrixWorld).invert();
    this.localCamera.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.toLocal);
    if ((camera as { isOrthographicCamera?: boolean }).isOrthographicCamera) {
      // An orthographic view has no distance; rank detail around the view centre at terrain height.
      const top = this.source.def.origin[1] + this.heightRange.max;
      this.localCamera.y = Math.min(this.localCamera.y, top);
    }
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld);
    this.frustum.setFromProjectionMatrix(this.viewProjection, camera.coordinateSystem, camera.reversedDepth);
    this.cameraTuple[0] = this.localCamera.x;
    this.cameraTuple[1] = this.localCamera.y;
    this.cameraTuple[2] = this.localCamera.z;
    const nodes = this.selector.select(this.cameraTuple, (box) => this.visible(box));
    const { origin, spacing, tileQuads, tilesX, tilesZ } = this.source.def;
    const tileSize = tileQuads * spacing;
    let count = 0;
    for (const node of nodes) {
      if (count >= this.maxNodes) break;
      const localX = node.box.minX - origin[0];
      const localZ = node.box.minZ - origin[2];
      // A node inside one resident tile reads it; anything coarser reads the global map.
      const tx = Math.floor(localX / tileSize);
      const tz = Math.floor(localZ / tileSize);
      const spansOneTile = tx === Math.floor((node.box.maxX - origin[0] - spacing * 1e-3) / tileSize)
        && tz === Math.floor((node.box.maxZ - origin[2] - spacing * 1e-3) / tileSize);
      const slot = spansOneTile && tx < tilesX && tz < tilesZ ? this.pool.slotOf(tx, tz) : -1;
      packTerrainNode(this.nodeData, count, localX, localZ, node.size, node.level, slot,
        slot >= 0 ? tx * tileSize : 0, slot >= 0 ? tz * tileSize : 0);
      count += 1;
    }
    this.mesh.geometry.instanceCount = count;
    this.nodeTexture.needsUpdate = true;
    (this.terrainMaterial.uniforms.uTerrainLodCamera!.value as Vector3).copy(this.localCamera);
    this.stats.nodes = count;
    this.stats.triangles = count * this.patchTriangles;
  }

  private visible(box: TerrainLodBox): boolean {
    this.box.min.set(box.minX, box.minY, box.minZ);
    this.box.max.set(box.maxX, box.maxY, box.maxZ);
    return this.frustum.intersectsBox(this.box);
  }

  private raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const mesh = this.mesh;
    this.toLocal.copy(mesh.matrixWorld).invert();
    this.localRay.copy(raycaster.ray).applyMatrix4(this.toLocal);
    const { origin, direction } = this.localRay;
    const hit = raycastTerrainRenderSource(this.source, [origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z]);
    if (!hit) return;
    const point = new Vector3(...hit.point).applyMatrix4(mesh.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(point);
    if (distance < raycaster.near || distance > raycaster.far) return;
    intersects.push({
      distance,
      point,
      object: mesh,
      face: { a: 0, b: 0, c: 0, normal: new Vector3(...hit.normal), materialIndex: 0 },
      faceIndex: 0,
    });
  }

  private updateBounds(): void {
    const range = terrainRenderSourceHeightRange(this.source);
    const [ox, oy, oz] = this.source.def.origin;
    const geometry = this.mesh.geometry;
    geometry.boundingBox ??= new Box3();
    geometry.boundingBox.min.set(ox, oy + range.min, oz);
    geometry.boundingBox.max.set(ox + this.source.extentX, oy + range.max, oz + this.source.extentZ);
    geometry.boundingSphere ??= new Sphere();
    geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
    // An all-flat terrain still needs a visible span in the height view.
    this.heightRange = range.max - range.min < 0.0001 ? { min: range.min - 0.5, max: range.max + 0.5 } : range;
    (this.terrainMaterial.uniforms.uTerrainHeightRange!.value as Vector2).set(this.heightRange.min, this.heightRange.max);
  }
}
