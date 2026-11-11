// S2: Forge's CDLOD World Terrain on WebGPU, as a TSL port of
// engine/render-three/terrain/terrainMaterial.ts (vertex: slot / global-map
// heights, collider diagonal, morph, skirts; fragment: normals, 8-layer splat,
// far tiling break). Data comes from Forge's three-free modules unchanged:
// tile codec, render source, normals, global map attributes, CDLOD selector.
// Throwaway spike code (Forge-WebGPU plan, Faz 1).
import * as THREE from "three/webgpu";
// TSL's strict typings reject several valid uses here (integer texel coordinates,
// vector element access); this throwaway port takes the functions untyped.
import * as TSLTyped from "three/tsl";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TSL = TSLTyped as any;
const {
  Fn, attribute, clamp, distance, dot, float, floor, fract, int, ivec2, length, max, mix, positionLocal,
  positionView, select, smoothstep, sqrt, texture, textureLoad, transformNormalToView, uniform, vec2, vec3, vec4,
  varyingProperty, mat2,
} = TSL;
import { decodeTerrainTile } from "@engine/terrain/terrainTileCodec";
import {
  buildTerrainGlobalAttributes, computeTileNormals, TerrainWorldHeightBounds, worldTerrainRenderSource,
  type TerrainRenderSource,
} from "@engine/terrain/terrainRenderSource";
import { TerrainLodSelector, terrainResidentTileKeys, type TerrainLodNode, type TerrainLodSettings, type TerrainMorphRange } from "@engine/terrain/terrainLod";
import { TERRAIN_PATCH_QUADS, TERRAIN_RENDER_LAYERS, TERRAIN_WEIGHT_BLOCKS } from "@engine/terrain/terrainRenderData";
import { parseTileKey, type TerrainTileData, type WorldTerrainDef } from "@engine/terrain/terrainTypes";

/** Added to world X / Y / Z in the G8 height pass (the colour output clamps negatives). */
export const HEIGHT_READBACK_OFFSET = 8192;

/** Forge's defaults (terrainRenderer.ts / terrainMaterial.ts). */
const SLOT_CAPACITY = 64;
const SKIRT_RATIO = 0.05;
const FAR_TILING_START = 25;
const FAR_TILING_END = 100;
const FAR_TILING_SCALE = 0.23;
const FAR_TILING_ANGLE = 0.6;

export interface ProjectAssets {
  json<T = unknown>(path: string): Promise<T>;
  bytes(path: string): Promise<Uint8Array>;
  /** Manifest asset id -> project path. */
  assetPath(id: string): string | undefined;
}

export async function openProjectAssets(manifestPath = "assets/manifest.json"): Promise<ProjectAssets> {
  const json = async <T>(path: string): Promise<T> => {
    const response = await fetch(`/${path}`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return (await response.json()) as T;
  };
  const manifest = await json<{ assets: { id: string; path?: string }[] }>(manifestPath);
  const paths = new Map(manifest.assets.filter((a) => a.path).map((a) => [a.id, a.path!]));
  return {
    json,
    bytes: async (path) => {
      const response = await fetch(`/${path}`);
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    assetPath: (id) => paths.get(id),
  };
}

export interface LoadedTerrain {
  def: WorldTerrainDef;
  tiles: Map<string, TerrainTileData>;
  source: TerrainRenderSource;
  layers: LayerInput[];
}

interface LayerInput {
  color: THREE.Color;
  texture: THREE.Texture | null;
  scale: THREE.Vector2;
  roughness: number;
}

interface MaterialJson {
  baseColor?: string;
  baseColorTexture?: string | null;
  uvTiling?: { x: number; y: number };
  roughness?: number;
  terrainMetersPerRepeat?: number;
  flipY?: boolean;
}

export async function loadTerrain(assets: ProjectAssets, levelPath: string): Promise<{ level: Record<string, unknown>; terrain: LoadedTerrain }> {
  const level = await assets.json<Record<string, unknown>>(levelPath);
  const landscape = (level.landscapes as { dataRef: string }[] | undefined)?.[0];
  if (!landscape) throw new Error(`${levelPath}: no landscape`);
  const def = await assets.json<WorldTerrainDef>(landscape.dataRef);
  const tilesDir = landscape.dataRef.replace(/\.terrain\.json$/, ".tiles");
  const tiles = new Map<string, TerrainTileData>();
  const keys = def.tiles.map((t) => t.key);
  for (let i = 0; i < keys.length; i += 16) {
    await Promise.all(keys.slice(i, i + 16).map(async (key) => {
      tiles.set(key, decodeTerrainTile(await assets.bytes(`${tilesDir}/${key}.tile.bin`)));
    }));
  }
  const source = worldTerrainRenderSource(def, tiles);
  const width = def.tilesX * def.tileQuads * def.spacing;
  const loader = new THREE.TextureLoader();
  const layers = await Promise.all(def.layers.slice(0, TERRAIN_RENDER_LAYERS).map(async (layer): Promise<LayerInput> => {
    const ref = (layer as { material?: string }).material;
    let material: MaterialJson | null = null;
    if (ref) {
      const path = assets.assetPath(ref);
      if (path) material = await assets.json<MaterialJson>(path).catch(() => null);
    }
    let map: THREE.Texture | null = null;
    const texturePath = material?.baseColorTexture ? assets.assetPath(material.baseColorTexture) : undefined;
    if (texturePath) {
      map = await loader.loadAsync(`/${texturePath}`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.anisotropy = 8;
      map.flipY = material?.flipY ?? true;
    }
    // Forge (RuntimeSceneApp.resolveRuntimeLandscapeLayerTextures + landscape.ts):
    // scale = textureScale ?? tiling / worldWidth, tiling = clamp(round(width / 8), 1, 128),
    // times the material's uvTiling.
    const tiling = Math.min(128, Math.max(1, Math.round(width / 8)));
    const scale = material?.terrainMetersPerRepeat ? 1 / material.terrainMetersPerRepeat : tiling / width;
    return {
      color: new THREE.Color(material?.baseColor ?? layer.color ?? "#808080"),
      texture: map,
      scale: new THREE.Vector2(scale * (material?.uvTiling?.x ?? 1), scale * (material?.uvTiling?.y ?? 1)),
      roughness: map ? (material?.roughness ?? 1) : 1,
    };
  }));
  return { level, terrain: { def, tiles, source, layers } };
}

function arrayTexture(data: Float32Array | Uint8Array, size: number, layers: number, format: THREE.PixelFormat, type: THREE.TextureDataType, filter: THREE.MagnificationTextureFilter): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(data, size, size, layers);
  tex.format = format;
  tex.type = type;
  tex.magFilter = filter;
  tex.minFilter = filter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Unit patch with a skirt ring at y = 1 (Forge's createPatchGeometry). */
function createPatchGeometry(patchQuads: number, capacity: number): THREE.InstancedBufferGeometry {
  const verts = patchQuads + 1;
  const ring: [number, number][] = [];
  for (let i = 0; i < patchQuads; i += 1) ring.push([i, 0]);
  for (let i = 0; i < patchQuads; i += 1) ring.push([patchQuads, i]);
  for (let i = patchQuads; i > 0; i -= 1) ring.push([i, patchQuads]);
  for (let i = patchQuads; i > 0; i -= 1) ring.push([0, i]);
  const count = verts * verts + ring.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) normals[i * 3 + 1] = 1;
  for (let z = 0; z < verts; z += 1) for (let x = 0; x < verts; x += 1) {
    const index = (z * verts + x) * 3;
    positions[index] = x / patchQuads;
    positions[index + 2] = z / patchQuads;
  }
  ring.forEach(([x, z], index) => positions.set([x / patchQuads, 1, z / patchQuads], (verts * verts + index) * 3));
  const indices = new Uint32Array(patchQuads * patchQuads * 6 + ring.length * 12);
  let cursor = 0;
  for (let z = 0; z < patchQuads; z += 1) for (let x = 0; x < patchQuads; x += 1) {
    const a = z * verts + x;
    const b = a + 1;
    const c = a + verts;
    const d = c + 1;
    indices.set([a, c, b, b, c, d], cursor);
    cursor += 6;
  }
  ring.forEach(([x, z], index) => {
    const [nx, nz] = ring[(index + 1) % ring.length]!;
    const top0 = z * verts + x;
    const top1 = nz * verts + nx;
    const bottom0 = verts * verts + index;
    const bottom1 = verts * verts + ((index + 1) % ring.length);
    indices.set([top0, bottom0, top1, top1, bottom0, bottom1, top0, top1, bottom0, top1, bottom1, bottom0], cursor);
    cursor += 12;
  });
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  for (const [name, size] of [["terrainNodeA", 4], ["terrainNodeB", 4], ["terrainNodeC", 1]] as const) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attr);
  }
  geometry.instanceCount = 0;
  return geometry;
}

export interface TerrainView {
  mesh: THREE.Mesh;
  /** Re-selects nodes for a camera (world position), optionally without frustum culling. */
  select(cameraWorld: THREE.Vector3, frustum: THREE.Frustum | null): { nodes: number; slotNodes: number; standIns: number };
  /** Material writing world height into the colour (for the G8 readback). */
  heightMaterial: THREE.MeshBasicNodeMaterial;
  litMaterial: THREE.MeshStandardNodeMaterial;
  /** World Y of terrain-local 0 plus each local metre: world = origin + local. */
  origin: THREE.Vector3;
  residentKeys: string[];
  lod: { settings: TerrainLodSettings; morphRanges: readonly TerrainMorphRange[] };
}

export function createTerrainView(terrain: LoadedTerrain, cameraWorld: THREE.Vector3): TerrainView {
  const { def, source } = terrain;
  const size = def.tileQuads + 1;
  const texels = size * size;
  const origin = new THREE.Vector3(def.origin[0], def.origin[1], def.origin[2]);
  const world = { tileQuads: def.tileQuads, spacing: def.spacing, tilesX: def.tilesX, tilesZ: def.tilesZ, origin: [0, 0, 0] as [number, number, number] };
  const extent = source.extent;

  // Tile slots: the tiles nearest the start camera, like Forge's residency radius.
  const bounds = new TerrainWorldHeightBounds(source, TERRAIN_PATCH_QUADS);
  const selector = new TerrainLodSelector(world, (level, ix, iz) => bounds.node(level, ix, iz), { patchQuads: TERRAIN_PATCH_QUADS, extent });
  const local = (v: THREE.Vector3): [number, number, number] => [v.x - origin.x, v.y - origin.y, v.z - origin.z];
  const capacity = Math.min(SLOT_CAPACITY, source.keys().length);
  const residentKeys = (source.keys().length <= capacity
    ? [...source.keys()]
    : terrainResidentTileKeys(world, selector.settings, local(cameraWorld)).filter((k) => terrain.tiles.has(k))).slice(0, capacity);
  const slotOf = new Map(residentKeys.map((key, slot) => [key, slot]));

  const heights = new Float32Array(texels * capacity);
  const normals = new Float32Array(texels * 2 * capacity);
  const weights = new Uint8Array(texels * 4 * TERRAIN_WEIGHT_BLOCKS * capacity);
  const scratch = new Float32Array(texels * 2);
  residentKeys.forEach((key, slot) => {
    const tile = terrain.tiles.get(key)!;
    heights.set(tile.heights, slot * texels);
    computeTileNormals(source, key, scratch);
    normals.set(scratch, slot * texels * 2);
    const blockBytes = texels * 4;
    const blocks = Math.ceil(tile.layerCount / 4);
    for (let block = 0; block < Math.min(blocks, TERRAIN_WEIGHT_BLOCKS); block += 1) {
      weights.set(tile.weights.subarray(block * blockBytes, (block + 1) * blockBytes), (slot * TERRAIN_WEIGHT_BLOCKS + block) * blockBytes);
    }
  });
  const heightTex = arrayTexture(heights, size, capacity, THREE.RedFormat, THREE.FloatType, THREE.NearestFilter);
  const normalTex = arrayTexture(normals, size, capacity, THREE.RGFormat, THREE.FloatType, THREE.LinearFilter);
  const weightTex = arrayTexture(weights, size, capacity * TERRAIN_WEIGHT_BLOCKS, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter);

  // Global map: one sample per parent-of-tile vertex; holes take the minimum.
  const global = buildTerrainGlobalAttributes(source, TERRAIN_PATCH_QUADS);
  const { map } = global;
  const range = bounds.range();
  const gh = Float32Array.from(map.heights, (h) => (Number.isNaN(h) ? range.min : h));
  const globalHeightTex = new THREE.DataTexture(gh, map.width, map.height, THREE.RedFormat, THREE.FloatType);
  globalHeightTex.magFilter = globalHeightTex.minFilter = THREE.NearestFilter;
  globalHeightTex.needsUpdate = true;
  const gn = new Float32Array(map.width * map.height * 4);
  for (let i = 0; i < map.width * map.height; i += 1) {
    gn[i * 4] = global.normals[i * 3]!;
    gn[i * 4 + 1] = global.normals[i * 3 + 1]!;
    gn[i * 4 + 2] = global.normals[i * 3 + 2]!;
    gn[i * 4 + 3] = 1;
  }
  const globalNormalTex = new THREE.DataTexture(gn, map.width, map.height, THREE.RGBAFormat, THREE.FloatType);
  globalNormalTex.magFilter = globalNormalTex.minFilter = THREE.LinearFilter;
  globalNormalTex.needsUpdate = true;
  const globalWeightTex = new THREE.DataArrayTexture(global.weights, map.width, map.height, TERRAIN_WEIGHT_BLOCKS);
  globalWeightTex.format = THREE.RGBAFormat;
  globalWeightTex.type = THREE.UnsignedByteType;
  globalWeightTex.magFilter = globalWeightTex.minFilter = THREE.LinearFilter;
  globalWeightTex.generateMipmaps = false;
  globalWeightTex.needsUpdate = true;

  // Uniforms.
  const uOrigin = uniform(origin);
  const uSpacing = uniform(def.spacing);
  const uTileVertices = uniform(size);
  const uExtent = uniform(new THREE.Vector2(extent[0], extent[1]));
  const uLodCamera = uniform(new THREE.Vector3());
  const uPatchQuads = uniform(TERRAIN_PATCH_QUADS);
  const uSkirtRatio = uniform(SKIRT_RATIO);
  const uGlobalSize = uniform(new THREE.Vector2(map.width, map.height));
  const uGlobalSpacing = uniform(map.stride * def.spacing);

  const nodeA = attribute("terrainNodeA", "vec4");
  const nodeB = attribute("terrainNodeB", "vec4");
  const nodeC = attribute("terrainNodeC", "float");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyNode = any;
  const load = textureLoad;
  const tileTexel = (cell: AnyNode, slot: AnyNode) => {
    const last = int(uTileVertices).sub(1);
    return load(heightTex, clamp(cell, ivec2(0, 0), ivec2(last, last))).depth(slot).r;
  };
  const globalTexel = (cell: AnyNode) => {
    const last = ivec2(uGlobalSize).sub(ivec2(1, 1));
    return load(globalHeightTex, clamp(cell, ivec2(0, 0), last)).r;
  };
  // Tile slots: the collider's triangle (b-c diagonal); global map bilinear.
  const terrainHeight = Fn(([localXZ, tileOrigin, slotF]: [AnyNode, AnyNode, AnyNode]) => {
    const slot = int(max(slotF, float(0)));
    const tg = localXZ.sub(tileOrigin).div(uSpacing);
    const tb = floor(tg);
    const tf = tg.sub(tb);
    const tc = ivec2(tb);
    const ha = tileTexel(tc, slot);
    const hb = tileTexel(tc.add(ivec2(1, 0)), slot);
    const hc = tileTexel(tc.add(ivec2(0, 1)), slot);
    const hd = tileTexel(tc.add(ivec2(1, 1)), slot);
    const lower = ha.add(hb.sub(ha).mul(tf.x)).add(hc.sub(ha).mul(tf.y));
    const upper = hd.add(hc.sub(hd).mul(float(1).sub(tf.x))).add(hb.sub(hd).mul(float(1).sub(tf.y)));
    const tileH = select(tf.x.add(tf.y).lessThanEqual(1), lower, upper);
    const gg = localXZ.div(uGlobalSpacing);
    const gb = floor(gg);
    const gf = gg.sub(gb);
    const gc = ivec2(gb);
    const h00 = globalTexel(gc);
    const h10 = globalTexel(gc.add(ivec2(1, 0)));
    const h01 = globalTexel(gc.add(ivec2(0, 1)));
    const h11 = globalTexel(gc.add(ivec2(1, 1)));
    const globalH = mix(mix(h00, h10, gf.x), mix(h01, h11, gf.x), gf.y);
    return select(slotF.greaterThanEqual(0), tileH, globalH);
  });

  const vLocal = varyingProperty("vec2", "vTerrainLocal");
  const vTile = varyingProperty("vec3", "vTerrainTile"); // slot, tile origin x/z
  const vWorld = varyingProperty("vec3", "vTerrainWorld");

  const position = Fn(() => {
    const slotF = floor(nodeA.w.add(0.5));
    const grid = positionLocal.xz;
    const edge = uExtent;
    const start = nodeA.xy.add(grid.mul(nodeA.z));
    const h0 = terrainHeight(clamp(start, vec2(0, 0), edge), nodeB.xy, slotF);
    const morph = clamp(distance(vec3(start.x, h0, start.y), uLodCamera).sub(nodeB.z).div(nodeB.w.sub(nodeB.z)), 0, 1);
    // Odd grid vertices slide onto the even (parent) grid as morph -> 1.
    const fracGrid = fract(grid.mul(uPatchQuads).mul(0.5)).mul(2).div(uPatchQuads);
    const localXZ = clamp(start.sub(fracGrid.mul(nodeA.z).mul(morph)), vec2(0, 0), edge).toVar();
    const h = terrainHeight(localXZ, nodeB.xy, slotF).toVar();
    const border = localXZ.x.lessThanEqual(0).or(localXZ.y.lessThanEqual(0)).or(localXZ.x.greaterThanEqual(edge.x)).or(localXZ.y.greaterThanEqual(edge.y));
    const skirt = positionLocal.y.greaterThan(0.5).and(nodeC.greaterThan(0.5)).and(border.not());
    h.assign(select(skirt, h.sub(nodeA.z.mul(uSkirtRatio)), h));
    vLocal.assign(localXZ);
    vTile.assign(vec3(nodeA.w, nodeB.xy));
    vWorld.assign(uOrigin.add(vec3(localXZ.x, h, localXZ.y)));
    return uOrigin.add(vec3(localXZ.x, h, localXZ.y));
  })();

  // Fragment helpers.
  const slotFrag = floor(vTile.x.add(0.5));
  const slotI = int(max(slotFrag, float(0)));
  const tileUv = vLocal.sub(vTile.yz).div(uSpacing).add(0.5).div(uTileVertices);
  const globalUv = vLocal.div(uGlobalSpacing).add(0.5).div(uGlobalSize);
  const useTile = slotFrag.greaterThanEqual(0);
  const nTile = texture(normalTex, tileUv).depth(slotI).rg;
  const nGlobal = texture(globalNormalTex, globalUv).rg;
  const nXZ = select(useTile, nTile, nGlobal);
  const nY = sqrt(max(float(1).sub(dot(nXZ, nXZ)), float(0)));
  const worldNormal = vec3(nXZ.x, nY, nXZ.y).normalize();
  const w0 = select(useTile, texture(weightTex, tileUv).depth(slotI.mul(2)), texture(globalWeightTex, globalUv).depth(int(0)));
  const w1 = select(useTile, texture(weightTex, tileUv).depth(slotI.mul(2).add(1)), texture(globalWeightTex, globalUv).depth(int(1)));
  const weightsOf = (i: number) => (i < 4 ? w0.element(int(i)) : w1.element(int(i - 4)));

  // Far tiling break (Forge high profile: terrainFarTiling on).
  const farT = smoothstep(FAR_TILING_START, FAR_TILING_END, length(positionView));
  const farP = mat2(Math.cos(FAR_TILING_ANGLE), Math.sin(FAR_TILING_ANGLE), -Math.sin(FAR_TILING_ANGLE), Math.cos(FAR_TILING_ANGLE)).mul(vLocal).mul(FAR_TILING_SCALE);
  let sum: AnyNode = vec3(0, 0, 0);
  let total: AnyNode = float(0);
  let rough: AnyNode = float(0);
  terrain.layers.forEach((layer, i) => {
    const w = weightsOf(i);
    let color: AnyNode;
    if (layer.texture) {
      const near = texture(layer.texture, vLocal.mul(uniform(layer.scale)));
      const far = texture(layer.texture, farP.mul(uniform(layer.scale)));
      color = mix(near, near.add(far).mul(0.5), farT).rgb;
    } else {
      color = vec3(uniform(layer.color));
    }
    sum = sum.add(color.mul(w));
    total = total.add(w);
    rough = rough.add(float(layer.roughness).mul(w));
  });
  const fallback = vec3(uniform(terrain.layers[0]?.color ?? new THREE.Color("#808080")));
  const albedo = select(total.greaterThan(0.0001), sum.div(total), fallback);

  const litMaterial = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  litMaterial.positionNode = position;
  litMaterial.colorNode = vec4(albedo, 1);
  litMaterial.roughnessNode = select(total.greaterThan(0.0001), rough.div(total), float(1));
  litMaterial.normalNode = transformNormalToView(worldNormal);

  const heightMaterial = new THREE.MeshBasicNodeMaterial();
  heightMaterial.positionNode = position;
  // World Y, X, Z per pixel: the readback needs no orientation convention.
  // The colour output clamps negatives to 0, so values carry a +HEIGHT_READBACK_OFFSET.
  heightMaterial.colorNode = vec4(vWorld.y.add(HEIGHT_READBACK_OFFSET), vWorld.x.add(HEIGHT_READBACK_OFFSET), vWorld.z.add(HEIGHT_READBACK_OFFSET), 1);
  heightMaterial.toneMapped = false;

  const geometry = createPatchGeometry(TERRAIN_PATCH_QUADS, 4096);
  const mesh = new THREE.Mesh(geometry, litMaterial);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const tileSize = def.tileQuads * def.spacing;
  const box = new THREE.Box3();

  const select_ = (cameraWorld: THREE.Vector3, frustum: THREE.Frustum | null) => {
    const camLocal = local(cameraWorld);
    uLodCamera.value.set(...camLocal);
    const visible = frustum
      ? (b: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }) =>
        frustum.intersectsBox(box.set(new THREE.Vector3(b.minX + origin.x, b.minY + origin.y, b.minZ + origin.z), new THREE.Vector3(b.maxX + origin.x, b.maxY + origin.y, b.maxZ + origin.z)))
      : () => true;
    const nodes: TerrainLodNode[] = selector.select(camLocal, visible).filter((n) => n.offsetX < extent[0] && n.offsetZ < extent[1] && (!n.tileKey || terrain.tiles.has(n.tileKey)));
    if (nodes.length > (geometry.getAttribute("terrainNodeA") as THREE.InstancedBufferAttribute).count) throw new Error(`terrain: ${nodes.length} nodes over capacity`);
    const a = geometry.getAttribute("terrainNodeA") as THREE.InstancedBufferAttribute;
    const b = geometry.getAttribute("terrainNodeB") as THREE.InstancedBufferAttribute;
    const c = geometry.getAttribute("terrainNodeC") as THREE.InstancedBufferAttribute;
    const slots = nodes.map((n) => (n.tileKey && slotOf.has(n.tileKey) ? slotOf.get(n.tileKey)! : -1));
    const standIns = nodes.filter((n, i) => n.tileKey !== null && slots[i]! < 0);
    const touches = (p: TerrainLodNode, q: TerrainLodNode) =>
      ((p.box.maxX === q.box.minX || q.box.maxX === p.box.minX) && p.box.minZ < q.box.maxZ && q.box.minZ < p.box.maxZ)
      || ((p.box.maxZ === q.box.minZ || q.box.maxZ === p.box.minZ) && p.box.minX < q.box.maxX && q.box.minX < p.box.maxX);
    nodes.forEach((node, i) => {
      const slot = slots[i]!;
      const tile = slot >= 0 ? parseTileKey(node.tileKey!)! : { x: 0, z: 0 };
      const skirt = node.level < 0 || standIns.includes(node) || (slot >= 0 && standIns.some((s) => touches(node, s)));
      a.setXYZW(i, node.offsetX, node.offsetZ, node.size, slot);
      b.setXYZW(i, tile.x * tileSize, tile.z * tileSize, node.morphRange[0], node.morphRange[1]);
      c.setX(i, skirt ? 1 : 0);
    });
    a.needsUpdate = b.needsUpdate = c.needsUpdate = true;
    geometry.instanceCount = nodes.length;
    return { nodes: nodes.length, slotNodes: slots.filter((s) => s >= 0).length, standIns: standIns.length };
  };

  return { mesh, select: select_, heightMaterial, litMaterial, origin, residentKeys, lod: { settings: selector.settings, morphRanges: selector.morphRanges } };
}
