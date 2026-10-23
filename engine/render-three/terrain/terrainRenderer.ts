import {
  Box3,
  BufferAttribute,
  ClampToEdgeWrapping,
  DataArrayTexture,
  DataTexture,
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
  type Texture,
  type TextureDataType,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";

import { TerrainLodSelector, terrainResidentTileKeys, type TerrainLodWorld } from "@engine/terrain/terrainLod";
import { invalidateTerrainTileRange, raycastTerrain, type TerrainQueryDef } from "@engine/terrain/terrainHeightQuery";
import { TERRAIN_PATCH_QUADS, TERRAIN_WEIGHT_BLOCKS, type TerrainVertexRect } from "@engine/terrain/terrainRenderData";
import {
  TerrainWorldHeightBounds,
  buildTerrainGlobalAttributes,
  computeTileNormals,
  terrainSourceQueryDef,
  updateTerrainGlobalAttributes,
  type TerrainGlobalAttributes,
  type TerrainRenderSource,
} from "@engine/terrain/terrainRenderSource";
import { TerrainSlotPool } from "@engine/terrain/terrainSlotPool";
import { parseTileKey, tileKey } from "@engine/terrain/terrainTypes";
import {
  createTerrainMaterials,
  setTerrainAppearance,
  type TerrainLayerInput,
  type TerrainMaterials,
  type TerrainViewMode,
} from "./terrainMaterial";
import { TerrainTextureUpdates } from "./terrainTextureUpdates";

/**
 * GPU CDLOD renderer for one terrain grid of tiles (OPEN_WORLD_PLAN Faz 2). One
 * instanced patch mesh is placed per selected quadtree node. Tiles near the
 * camera are uploaded into `DataArrayTexture` slots (heights, normals, paint
 * weights) under a per-frame budget; every other node — far ones, and those
 * whose tile has no slot yet — reads the global map, one sample per vertex of
 * the grid one level above a tile. A legacy Landscape is a one-tile source
 * that always holds its slot.
 *
 * The mesh has no CPU vertices, so picking goes through the heightfield
 * raycast, and the passes that override scene materials draw it with
 * {@link renderSceneWithTerrainOverride}.
 *
 * Frames: the mesh sits in its parent's frame; terrain-local (0, 0, 0) — tile
 * (0, 0)'s min corner at the height datum — is at `origin`.
 */

export interface TerrainRendererOptions {
  globalAttributes?: TerrainGlobalAttributes;
  viewMode: TerrainViewMode;
  activeLayer: number;
  layers: TerrainLayerInput[];
  /** Mesh-frame position of terrain-local (0, 0, 0). */
  origin: Vector3;
  /** Tile slots on the GPU (default: every tile, at most 64). */
  slotCapacity?: number;
  /** Tile uploads per `updateLod` call (default 4). */
  uploadsPerFrame?: number;
}

export type TerrainOverrideKind = "normal" | "depth";

const MESH_NAME = "landscape-terrain";
const DEFAULT_SLOT_CAPACITY = 64;
const DEFAULT_UPLOADS_PER_FRAME = 4;

function configure<T extends Texture>(texture: T, format: PixelFormat, type: TextureDataType, filter: MagnificationTextureFilter): T {
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

/**
 * Unit patch: `(P + 1)²` vertices over [0, 1]², split along the collider's
 * diagonal, plus a skirt — a copy of the border ring with `y = 1`. A node whose
 * `terrainNodeC` flag is set drops it below the surface; any other node folds
 * it onto its own edge (zero area). See {@link TerrainRenderer.select}.
 */
function createPatchGeometry(patchQuads: number, capacity: number): InstancedBufferGeometry {
  const verts = patchQuads + 1;
  const ring: [number, number][] = [];
  for (let i = 0; i < patchQuads; i += 1) ring.push([i, 0]);
  for (let i = 0; i < patchQuads; i += 1) ring.push([patchQuads, i]);
  for (let i = patchQuads; i > 0; i -= 1) ring.push([i, patchQuads]);
  for (let i = patchQuads; i > 0; i -= 1) ring.push([0, i]);
  const positions = new Float32Array((verts * verts + ring.length) * 3);
  for (let z = 0; z < verts; z += 1) {
    for (let x = 0; x < verts; x += 1) {
      const index = (z * verts + x) * 3;
      positions[index] = x / patchQuads;
      positions[index + 2] = z / patchQuads;
    }
  }
  ring.forEach(([x, z], index) => positions.set([x / patchQuads, 1, z / patchQuads], (verts * verts + index) * 3));
  const indices = new Uint16Array(patchQuads * patchQuads * 6 + ring.length * 12);
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
  ring.forEach(([x, z], index) => {
    const [nx, nz] = ring[(index + 1) % ring.length]!;
    const top0 = z * verts + x;
    const top1 = nz * verts + nx;
    const bottom0 = verts * verts + index;
    const bottom1 = verts * verts + ((index + 1) % ring.length);
    // Both windings: the gap can be seen from either side of the edge.
    indices.set([top0, bottom0, top1, top1, bottom0, bottom1, top0, top1, bottom0, top1, bottom1, bottom0], cursor);
    cursor += 12;
  });
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  setInstanceCapacity(geometry, capacity);
  geometry.instanceCount = 0;
  return geometry;
}

function setInstanceCapacity(geometry: InstancedBufferGeometry, capacity: number): void {
  for (const [name, size] of [["terrainNodeA", 4], ["terrainNodeB", 4], ["terrainNodeC", 1]] as const) {
    const attribute = new InstancedBufferAttribute(new Float32Array(capacity * size), size);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
}

function isVisibleInHierarchy(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

/** Ray parameter interval where `start + dir·t` lies in `[lo, hi]` on one axis. */
function slab(start: number, dir: number, lo: number, hi: number): [number, number] {
  if (Math.abs(dir) < 1e-12) return start >= lo && start <= hi ? [-Infinity, Infinity] : [Infinity, -Infinity];
  const t0 = (lo - start) / dir;
  const t1 = (hi - start) / dir;
  return t0 < t1 ? [t0, t1] : [t1, t0];
}

/**
 * Global map heights for the GPU: a hole (NaN) takes its nearest valid
 * neighbour's height, so triangles reaching into a discarded hole stay level
 * instead of dropping to the datum where the cut is visible.
 */
function fillHoles(heights: Float32Array, width: number, height: number, fallback: number): Float32Array {
  const out = Float32Array.from(heights);
  for (let pass = 0; pass < width + height; pass += 1) {
    let missing = 0;
    const previous = Float32Array.from(out);
    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = z * width + x;
        if (!Number.isNaN(previous[index]!)) continue;
        let sum = 0;
        let count = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
          const value = previous[nz * width + nx]!;
          if (Number.isNaN(value)) continue;
          sum += value;
          count += 1;
        }
        if (count > 0) out[index] = sum / count;
        else missing += 1;
      }
    }
    if (missing === 0) return out;
  }
  for (let index = 0; index < out.length; index += 1) if (Number.isNaN(out[index]!)) out[index] = fallback;
  return out;
}

export class TerrainRenderer {
  readonly mesh: Mesh<InstancedBufferGeometry, Material>;
  private readonly materials: TerrainMaterials;
  private readonly origin: Vector3;
  private readonly extent: Vector2;
  private readonly tileVertices: number;
  private readonly tileTexels: number;
  private readonly world: TerrainLodWorld;
  private readonly queryDef: TerrainQueryDef;
  private readonly allKeys: ReadonlySet<string>;
  /** Every tile fits in a slot, so residency never changes. */
  private readonly allResident: boolean;
  private readonly uploadsPerFrame: number;
  private readonly heightSlots: Float32Array;
  private readonly normalSlots: Uint16Array;
  private readonly weightSlots: Uint8Array;
  private readonly normalScratch: Float32Array;
  private readonly heightTexture: DataArrayTexture;
  private readonly normalTexture: DataArrayTexture;
  private readonly weightTexture: DataArrayTexture;
  private readonly global: TerrainGlobalAttributes;
  private readonly globalHeightTexture: DataTexture;
  private readonly globalNormalTexture: DataTexture;
  private readonly globalWeightTexture: DataArrayTexture;
  private readonly textureUpdates: TerrainTextureUpdates;
  private readonly hasGlobalHoles: boolean;
  private readonly bounds: TerrainWorldHeightBounds;
  private readonly selector: TerrainLodSelector;
  private readonly pool: TerrainSlotPool;
  /** Tiles that hold a slot and want it; the pool may still cache released ones. */
  private readonly active = new Set<string>();
  /** Tiles whose slot holds their current data. */
  private readonly uploaded = new Set<string>();
  private readonly lastCamera = new Vector3(Number.NaN, Number.NaN, Number.NaN);
  private readonly cameraScratch = new Vector3();
  private selectionDirty = true;

  constructor(private readonly source: TerrainRenderSource, options: TerrainRendererOptions) {
    this.origin = options.origin.clone();
    this.extent = new Vector2(source.extent[0], source.extent[1]);
    this.tileVertices = source.tileQuads + 1;
    this.tileTexels = this.tileVertices * this.tileVertices;
    this.world = { tileQuads: source.tileQuads, spacing: source.spacing, tilesX: source.tilesX, tilesZ: source.tilesZ, origin: [0, 0, 0] };
    this.queryDef = terrainSourceQueryDef(source);
    this.allKeys = new Set(source.keys());
    const capacity = Math.max(1, Math.min(this.allKeys.size, options.slotCapacity ?? DEFAULT_SLOT_CAPACITY));
    this.allResident = this.allKeys.size <= capacity;
    this.uploadsPerFrame = options.uploadsPerFrame ?? DEFAULT_UPLOADS_PER_FRAME;
    this.pool = new TerrainSlotPool(capacity);

    const size = this.tileVertices;
    this.heightSlots = new Float32Array(this.tileTexels * capacity);
    this.normalSlots = new Uint16Array(this.tileTexels * 2 * capacity);
    this.weightSlots = new Uint8Array(this.tileTexels * 4 * TERRAIN_WEIGHT_BLOCKS * capacity);
    this.normalScratch = new Float32Array(this.tileTexels * 2);
    this.heightTexture = configure(new DataArrayTexture(this.heightSlots, size, size, capacity), RedFormat, FloatType, NearestFilter);
    this.normalTexture = configure(new DataArrayTexture(this.normalSlots, size, size, capacity), RGFormat, HalfFloatType, LinearFilter);
    this.weightTexture = configure(
      new DataArrayTexture(this.weightSlots, size, size, capacity * TERRAIN_WEIGHT_BLOCKS),
      RGBAFormat, UnsignedByteType, LinearFilter,
    );

    this.bounds = new TerrainWorldHeightBounds(source);
    this.global = options.globalAttributes ?? source.globalAttributes ?? buildTerrainGlobalAttributes(source);
    const { width, height } = this.global.map;
    this.globalHeightTexture = configure(new DataTexture(new Float32Array(width * height), width, height), RedFormat, FloatType, NearestFilter);
    this.globalNormalTexture = configure(new DataTexture(new Uint16Array(width * height * 4), width, height), RGBAFormat, HalfFloatType, LinearFilter);
    this.globalWeightTexture = configure(
      new DataArrayTexture(this.global.weights, width, height, TERRAIN_WEIGHT_BLOCKS),
      RGBAFormat, UnsignedByteType, LinearFilter,
    );
    this.textureUpdates = new TerrainTextureUpdates([
      this.heightTexture, this.normalTexture, this.weightTexture,
      this.globalHeightTexture, this.globalNormalTexture, this.globalWeightTexture,
    ]);
    this.hasGlobalHoles = this.global.map.heights.some(Number.isNaN);
    this.writeGlobalTextures();

    this.selector = new TerrainLodSelector(this.world, (level, ix, iz) => this.bounds.node(level, ix, iz), {
      patchQuads: TERRAIN_PATCH_QUADS,
    });
    this.materials = createTerrainMaterials({
      heights: this.heightTexture,
      normals: this.normalTexture,
      weights: this.weightTexture,
      globalHeights: this.globalHeightTexture,
      globalNormals: this.globalNormalTexture,
      globalWeights: this.globalWeightTexture,
      globalSize: new Vector2(width, height),
      globalSpacing: this.global.map.stride * source.spacing,
      origin: this.origin,
      spacing: source.spacing,
      tileVertices: size,
      extent: this.extent,
      patchQuads: TERRAIN_PATCH_QUADS,
      viewMode: options.viewMode,
      activeLayer: options.activeLayer,
      heightRange: new Vector2(),
      layers: options.layers,
    });
    this.updateHeightRange();

    const leaves = (source.tilesX * source.tilesZ * source.tileQuads * source.tileQuads) / (TERRAIN_PATCH_QUADS * TERRAIN_PATCH_QUADS);
    this.mesh = new Mesh(createPatchGeometry(TERRAIN_PATCH_QUADS, Math.min(leaves, 1024)), this.materials.material);
    this.mesh.name = MESH_NAME;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.userData.forgeTerrain = this;
    this.mesh.raycast = (raycaster, intersects) => this.raycast(raycaster, intersects);
    this.mesh.onBeforeRender = (renderer) => this.textureUpdates.flush(renderer);
    this.updateBoundingVolumes();

    if (this.allResident) {
      for (const key of this.allKeys) this.makeResident(key);
    }
    // Until the first camera update, draw the whole grid from a far viewpoint.
    this.select(new Vector3(this.extent.x / 2, Number.MAX_SAFE_INTEGER / 4, this.extent.y / 2));
  }

  /** Tiles currently drawn from a slot at full resolution. */
  get residentTileCount(): number {
    return this.uploaded.size;
  }

  /** Re-selects the quadtree and streams tile slots for `camera`; call once per frame before rendering. */
  updateLod(camera: Camera): void {
    this.mesh.updateWorldMatrix(true, false);
    const local = this.mesh.worldToLocal(camera.getWorldPosition(this.cameraScratch)).sub(this.origin);
    const residencyChanged = this.allResident ? false : this.updateResidency(local);
    const threshold = this.selector.settings.leafSize * 0.01;
    if (!residencyChanged && !this.selectionDirty && local.distanceToSquared(this.lastCamera) < threshold * threshold) return;
    this.select(local);
  }

  /**
   * Re-reads tile `key` inside `rect` (tile-local inclusive vertex bounds) after
   * its source data changed: slot texels, normals on both sides of a seam, node
   * bounds, the global map and picking.
   */
  updateTile(key: string, rect: TerrainVertexRect): void {
    const coord = parseTileKey(key)!;
    const tile = this.source.tile(coord.x, coord.z);
    if (!tile) return;
    invalidateTerrainTileRange(tile);
    this.bounds.updateTile(key, rect);
    if (this.uploaded.has(key)) this.uploadTile(key, this.pool.slotOf(key)!, rect);
    // Intersect the dirty vertices and their one-vertex normal reach with
    // adjacent tiles, including corner copies of a shared seam vertex.
    const last = this.source.tileQuads;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        const neighbour = tileKey(coord.x + dx, coord.z + dz);
        if (!this.uploaded.has(neighbour)) continue;
        const overlap = (pad: number): TerrainVertexRect | null => {
          const area = {
            x0: Math.max(0, rect.x0 - pad - dx * last), x1: Math.min(last, rect.x1 + pad - dx * last),
            z0: Math.max(0, rect.z0 - pad - dz * last), z1: Math.min(last, rect.z1 + pad - dz * last),
          };
          return area.x0 <= area.x1 && area.z0 <= area.z1 ? area : null;
        };
        const normals = overlap(1);
        if (normals) this.uploadTile(neighbour, this.pool.slotOf(neighbour)!, overlap(0), normals);
      }
    }
    const globalRect = updateTerrainGlobalAttributes(this.global, this.source, key, rect);
    if (globalRect) this.writeGlobalTextures(globalRect);
    this.updateHeightRange();
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
    this.textureUpdates.dispose();
    this.mesh.geometry.dispose();
    this.materials.material.dispose();
    this.materials.normalMaterial.dispose();
    this.materials.depthMaterial.dispose();
    for (const texture of [
      this.heightTexture, this.normalTexture, this.weightTexture,
      this.globalHeightTexture, this.globalNormalTexture, this.globalWeightTexture,
    ]) texture.dispose();
  }

  /**
   * Gives the nearest tiles a slot, at most `uploadsPerFrame` new uploads per
   * call; tiles that left the wanted set release theirs (the pool keeps their
   * data cached until another tile needs the slot). True if a slot changed.
   */
  private updateResidency(cameraLocal: Vector3): boolean {
    const wanted = terrainResidentTileKeys(this.world, this.selector.settings, [cameraLocal.x, cameraLocal.y, cameraLocal.z])
      .filter((key) => this.allKeys.has(key))
      .slice(0, this.pool.capacity);
    const wantedSet = new Set(wanted);
    let changed = false;
    for (const key of [...this.active]) {
      if (wantedSet.has(key)) continue;
      this.active.delete(key);
      this.pool.release(key);
    }
    let uploads = 0;
    for (const key of wanted) {
      if (this.active.has(key)) continue;
      if (uploads >= this.uploadsPerFrame) break;
      const before = this.uploaded.has(key);
      if (!this.makeResident(key)) break;
      if (!before) uploads += 1;
      changed = true;
    }
    return changed;
  }

  /** Acquires a slot for `key` and uploads it unless the slot still holds it. */
  private makeResident(key: string): boolean {
    const acquired = this.pool.acquire(key);
    if (!acquired) return false;
    if (acquired.evictedKey) this.uploaded.delete(acquired.evictedKey);
    this.active.add(key);
    if (!acquired.cached || !this.uploaded.has(key)) this.uploadTile(key, acquired.slot);
    return true;
  }

  /** Writes dirty vertices and their normal reach; null vertices means normals only. */
  private uploadTile(key: string, slot: number, rect?: TerrainVertexRect | null, normalRect?: TerrainVertexRect): void {
    const { x, z } = parseTileKey(key)!;
    const tile = this.source.tile(x, z)!;
    const size = this.tileVertices;
    const vertices = rect === undefined ? { x0: 0, x1: size - 1, z0: 0, z1: size - 1 } : rect;
    const area = normalRect ?? {
      x0: Math.max(0, vertices!.x0 - 1), x1: Math.min(size - 1, vertices!.x1 + 1),
      z0: Math.max(0, vertices!.z0 - 1), z1: Math.min(size - 1, vertices!.z1 + 1),
    };
    computeTileNormals(this.source, key, this.normalScratch, area);
    const normalBase = slot * this.tileTexels * 2;
    for (let row = area.z0; row <= area.z1; row += 1) {
      for (let column = area.x0; column <= area.x1; column += 1) {
        const index = (row * size + column) * 2;
        this.normalSlots[normalBase + index] = DataUtils.toHalfFloat(this.normalScratch[index]!);
        this.normalSlots[normalBase + index + 1] = DataUtils.toHalfFloat(this.normalScratch[index + 1]!);
      }
    }
    this.textureUpdates.add(this.normalTexture, slot, area);
    if (vertices) {
      const blockBytes = this.tileTexels * 4;
      const blocks = Math.ceil(tile.layerCount / 4);
      for (let row = vertices.z0; row <= vertices.z1; row += 1) {
        const start = row * size + vertices.x0;
        const end = row * size + vertices.x1 + 1;
        this.heightSlots.set(tile.heights.subarray(start, end), slot * this.tileTexels + start);
        for (let block = 0; block < TERRAIN_WEIGHT_BLOCKS; block += 1) {
          const target = (slot * TERRAIN_WEIGHT_BLOCKS + block) * blockBytes;
          if (block < blocks) this.weightSlots.set(tile.weights.subarray(block * blockBytes + start * 4, block * blockBytes + end * 4), target + start * 4);
          else this.weightSlots.fill(0, target + start * 4, target + end * 4);
        }
      }
      this.textureUpdates.add(this.heightTexture, slot, vertices);
      for (let block = 0; block < TERRAIN_WEIGHT_BLOCKS; block += 1) {
        this.textureUpdates.add(this.weightTexture, slot * TERRAIN_WEIGHT_BLOCKS + block, vertices);
      }
    }
    this.uploaded.add(key);
    this.selectionDirty = true;
  }

  private writeGlobalTextures(rect?: TerrainVertexRect): void {
    const { map, normals } = this.global;
    const area = rect ?? { x0: 0, x1: map.width - 1, z0: 0, z1: map.height - 1 };
    const heights = this.globalHeightTexture.image.data as Float32Array;
    const filled = this.hasGlobalHoles ? fillHoles(map.heights, map.width, map.height, this.bounds.range().min) : map.heights;
    const heightArea = { ...area };
    // Hole filling can propagate a changed boundary sample beyond the dirty
    // map rectangle. Include those changed texels to preserve the same surface.
    if (this.hasGlobalHoles) {
      for (let z = 0; z < map.height; z += 1) {
        for (let x = 0; x < map.width; x += 1) {
          const index = z * map.width + x;
          if (heights[index] === filled[index]) continue;
          heightArea.x0 = Math.min(heightArea.x0, x);
          heightArea.x1 = Math.max(heightArea.x1, x);
          heightArea.z0 = Math.min(heightArea.z0, z);
          heightArea.z1 = Math.max(heightArea.z1, z);
        }
      }
    }
    for (let z = heightArea.z0; z <= heightArea.z1; z += 1) {
      const start = z * map.width + heightArea.x0;
      heights.set(filled.subarray(start, z * map.width + heightArea.x1 + 1), start);
    }
    const halves = this.globalNormalTexture.image.data as Uint16Array;
    for (let z = area.z0; z <= area.z1; z += 1) {
      for (let x = area.x0; x <= area.x1; x += 1) {
        const sample = z * map.width + x;
        halves[sample * 4] = DataUtils.toHalfFloat(normals[sample * 3]!);
        halves[sample * 4 + 1] = DataUtils.toHalfFloat(normals[sample * 3 + 1]!);
        halves[sample * 4 + 2] = DataUtils.toHalfFloat(normals[sample * 3 + 2]!);
      }
    }
    this.textureUpdates.add(this.globalHeightTexture, 0, heightArea);
    this.textureUpdates.add(this.globalNormalTexture, 0, area);
    for (let block = 0; block < TERRAIN_WEIGHT_BLOCKS; block += 1) {
      this.textureUpdates.add(this.globalWeightTexture, block, area);
    }
  }

  private updateHeightRange(): void {
    const range = this.bounds.range();
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
    const tileSize = this.source.tileQuads * this.source.spacing;
    const nodes = this.selector.select([cameraLocal.x, cameraLocal.y, cameraLocal.z]).filter((node) =>
      // Nodes wholly past the drawn extent (legacy padding) or on a missing tile draw nothing.
      node.offsetX < this.extent.x && node.offsetZ < this.extent.y && (!node.tileKey || this.allKeys.has(node.tileKey)));
    if (nodes.length > (geometry.getAttribute("terrainNodeA") as InstancedBufferAttribute).count) {
      setInstanceCapacity(geometry, 2 ** Math.ceil(Math.log2(nodes.length)));
    }
    const a = geometry.getAttribute("terrainNodeA") as InstancedBufferAttribute;
    const b = geometry.getAttribute("terrainNodeB") as InstancedBufferAttribute;
    const c = geometry.getAttribute("terrainNodeC") as InstancedBufferAttribute;
    const slots = nodes.map((node) => (node.tileKey && this.uploaded.has(node.tileKey) ? this.pool.slotOf(node.tileKey)! : -1));
    // A node that wants its tile's slot but has none yet stands in from the
    // coarser global map; on an edge it shares with a slot node the two
    // surfaces can part, so both sides hang a skirt. Everywhere else the two
    // sides read the same samples and skirts stay folded.
    const standIns = nodes.filter((node, index) => node.tileKey !== null && slots[index]! < 0);
    const touches = (p: { box: { minX: number; maxX: number; minZ: number; maxZ: number } }, q: typeof p) =>
      ((p.box.maxX === q.box.minX || q.box.maxX === p.box.minX) && p.box.minZ < q.box.maxZ && q.box.minZ < p.box.maxZ)
      || ((p.box.maxZ === q.box.minZ || q.box.maxZ === p.box.minZ) && p.box.minX < q.box.maxX && q.box.minX < p.box.maxX);
    nodes.forEach((node, index) => {
      const slot = slots[index]!;
      const tile = slot >= 0 ? parseTileKey(node.tileKey!)! : { x: 0, z: 0 };
      const skirt = standIns.includes(node) || (slot >= 0 && standIns.some((standIn) => touches(node, standIn)));
      a.setXYZW(index, node.offsetX, node.offsetZ, node.size, slot);
      b.setXYZW(index, tile.x * tileSize, tile.z * tileSize, node.morphRange[0], node.morphRange[1]);
      c.setX(index, skirt ? 1 : 0);
    });
    a.needsUpdate = true;
    b.needsUpdate = true;
    c.needsUpdate = true;
    geometry.instanceCount = nodes.length;
  }

  private raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const inverse = new Matrix4().copy(this.mesh.matrixWorld).invert();
    const ray = new Ray().copy(raycaster.ray).applyMatrix4(inverse);
    ray.origin.sub(this.origin);
    // Clip to the drawn rectangle so a legacy grid's padding shelf is never hit.
    const [x0, x1] = slab(ray.origin.x, ray.direction.x, 0, this.extent.x);
    const [z0, z1] = slab(ray.origin.z, ray.direction.z, 0, this.extent.y);
    const enter = Math.max(0, x0, z0);
    const exit = Math.min(x1, z1);
    if (!(enter <= exit)) return;
    const start = ray.at(enter, new Vector3());
    const hit = raycastTerrain(this.queryDef, this.source, start.toArray(), ray.direction.toArray(), exit - enter);
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
