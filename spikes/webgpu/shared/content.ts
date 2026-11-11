// Reference-level content for the WebGPU spike (S4): static placements (level
// instances and World Partition cells), their models, and Landscape foliage
// grown by Forge's own three-free rules. Data only; shared/contentRender.ts
// builds the draw structures. Throwaway spike code.
//
// Mirrors Forge WebGL's runtime (Forge `src/scene`, read only):
//  - placements: TRS from `readRotation` / `readScale` (XYZ Euler, degrees);
//    `marker:*` is never drawn; `shape:cube` is a SHAPE_PRIMITIVE_SIZE box;
//  - cells: the main grid's cells within `loadRange` of the camera
//    (`computeStreamingTargets`, multiplier 1);
//  - foliage: every Landscape rule's ring around the camera
//    (`planFoliageRing`, radius = cullEnd x the `high` cull scale 0.85, density =
//    the `high` grass density 0.8, `foliageRingCellSize`), cells generated with
//    `FoliageTerrainStore` over the resident tiles. Resident = Forge's terrain
//    streaming render range (`TerrainRuntimeStreaming`: tile-sized cells,
//    loadRange max(8, 2 x tile size) around the camera); a cell is generated only
//    when every tile it covers (+ 2 x spacing) is resident (`cellTilesReady`),
//    so a far tree ring stops where Forge's stops.
import * as THREE from "three/webgpu";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readRotation, readScale } from "@engine/scene/transform";
import { SHAPE_PRIMITIVE_SIZE } from "@engine/scene/shapes";
import { foliageTypeHasFarBillboards, normalizeFoliageType, type ForgeFoliageTypeDef, type LandscapeFoliageRule } from "@engine/scene/foliage";
import { FoliageTerrainStore, generateFoliageBlock, globalFoliageSurface } from "@engine/scene/proceduralFoliage";
import { FOLIAGE_FAR_BLOCK_SIZE, FOLIAGE_RING_BANDS, foliageRingCellSize, foliageRingRadius, planFarFoliage, planFoliageRing } from "@engine/world/foliageRing";
import { buildTerrainGlobalAttributes } from "@engine/terrain/terrainRenderSource";
import { TerrainTileMap } from "@engine/terrain/terrainHeightQuery";
import { computeStreamingTargets } from "@engine/world/streamingPolicy";
import type { LayoutPlacement } from "@engine/scene/layout";
import { normalizeForgeMaterialDef, type ForgeMaterialDef } from "@engine/assets/material";
import type { LoadedTerrain, ProjectAssets } from "./terrain";

/** engine/render-three/foliageImpostor.ts: billboards dissolve over the last 15 % of the far distance. */
const IMPOSTOR_FAR_FADE = 0.15;
/** Forge `high` (engine/perf/qualityProfiles.ts). */
export const HIGH_CONTENT = { foliageCullDistanceScale: 0.85, grassDensity: 0.8, windSwayDistance: 100 };
/** src/scene/shapePrimitives.ts */
const SHAPE_PRIMITIVE_COLOR = "#b9c0c6";

export interface PlacementItem {
  matrix: THREE.Matrix4;
  /** Largest placement scale (static detail culling divides distances by it). */
  scale: number;
  color?: string;
}

/** One asset's placements in one scope: the level (`cell` null) or one loaded cell. */
export interface PlacementBatch {
  assetId: string;
  cell: string | null;
  items: PlacementItem[];
}

export interface FoliageCellBatch {
  ruleId: string;
  type: ForgeFoliageTypeDef;
  key: string;
  count: number;
  /** count * 16 floats, column-major per instance. */
  matrices: Float32Array;
}

/** Far billboard block (`planFar`): the type's plants past its cull distance, one 512 m block. */
export interface FoliageFarBatch {
  ruleId: string;
  type: ForgeFoliageTypeDef;
  key: string;
  count: number;
  matrices: Float32Array;
  /** Models' fade window (start, end) and the billboards' far fade (start, end), metres. */
  window: [number, number, number, number];
}

export interface LevelContent {
  batches: PlacementBatch[];
  foliage: FoliageCellBatch[];
  far: FoliageFarBatch[];
  /** Asset id -> model scene (GLB, or the shape primitive). */
  models: Map<string, THREE.Group>;
  /** Asset id -> scale-1 bounding radius of its model (detail culling). */
  radii: Map<string, number>;
  staticCastShadow: boolean;
  describe: Record<string, unknown>;
}

interface CellDoc { instances?: { assetId: string; placements: LayoutPlacement[] }[] }

function placementItem(placement: LayoutPlacement): PlacementItem {
  const rotation = readRotation(placement);
  const scale = readScale(placement);
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...placement.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(rotation[0]), THREE.MathUtils.degToRad(rotation[1]), THREE.MathUtils.degToRad(rotation[2]))),
    new THREE.Vector3(...scale),
  );
  const item: PlacementItem = { matrix, scale: Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2])) };
  const color = (placement as { color?: string }).color;
  if (typeof color === "string") item.color = color;
  return item;
}

function toBatches(instances: CellDoc["instances"], cell: string | null): PlacementBatch[] {
  const out: PlacementBatch[] = [];
  for (const group of instances ?? []) {
    if (group.assetId.startsWith("marker:")) continue;
    const items = group.placements.filter((p) => !p.hidden).map(placementItem);
    // Forge builds a level-wide batch even for an asset listed with no placements
    // (its InstancedMeshes have count 0); cells only list what they hold.
    if (items.length || cell === null) out.push({ assetId: group.assetId, cell, items });
  }
  return out;
}

function shapeModel(assetId: string): THREE.Group | null {
  if (assetId !== "shape:cube") return null;
  const material = new THREE.MeshStandardMaterial({ color: SHAPE_PRIMITIVE_COLOR, roughness: 0.7, metalness: 0 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(SHAPE_PRIMITIVE_SIZE, SHAPE_PRIMITIVE_SIZE, SHAPE_PRIMITIVE_SIZE), material);
  mesh.name = "shape-cube";
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

/** engine/render-three/textureConfig.ts: min(8, device max); 8 on R1. */
const TEXTURE_ANISOTROPY = 8;

/**
 * Forge material assets (`*.material.json`) as three materials, the way
 * `createThreeMaterialFromForgeDef` builds them for the slots this content uses:
 * standard material, base colour / opacity / normal / roughness / metalness / ao
 * maps; an opacity map makes the material transparent (alpha test kept, depth
 * write unless blend). Layer blend and normal motion are not used here.
 */
class ForgeMaterials {
  private readonly materials = new Map<string, Promise<THREE.Material | undefined>>();
  private readonly textures = new Map<string, Promise<THREE.Texture | null>>();
  private readonly loader = new THREE.TextureLoader();
  constructor(private readonly assets: ProjectAssets) {}

  material(id: string): Promise<THREE.Material | undefined> {
    let pending = this.materials.get(id);
    if (!pending) {
      pending = this.build(id);
      this.materials.set(id, pending);
    }
    return pending;
  }

  private texture(id: string | null, def: ForgeMaterialDef, srgb: boolean): Promise<THREE.Texture | null> {
    if (!id) return Promise.resolve(null);
    const key = `${id}|${srgb}|${def.flipY}|${def.uvTiling.x},${def.uvTiling.y}`;
    let pending = this.textures.get(key);
    if (!pending) {
      const path = this.assets.assetPath(id);
      pending = path ? this.loader.loadAsync(`/${path}`).then((texture) => {
        texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(def.uvTiling.x, def.uvTiling.y);
        texture.flipY = def.flipY;
        texture.anisotropy = TEXTURE_ANISOTROPY;
        texture.needsUpdate = true;
        return texture;
      }) : Promise.resolve(null);
      this.textures.set(key, pending);
    }
    return pending;
  }

  private async build(id: string): Promise<THREE.Material | undefined> {
    const path = this.assets.assetPath(id);
    if (!path) return undefined;
    const def = normalizeForgeMaterialDef(await this.assets.json(path));
    const material = new THREE.MeshStandardMaterial({
      name: def.name, color: new THREE.Color(def.baseColor),
      transparent: def.alphaMode === "blend" || def.opacity < 1, opacity: def.opacity,
      alphaTest: def.alphaMode === "mask" ? def.alphaTest : 0, depthWrite: def.alphaMode !== "blend",
      side: def.side === "double" ? THREE.DoubleSide : def.side === "back" ? THREE.BackSide : THREE.FrontSide,
      roughness: def.roughness, metalness: def.metalness, emissive: new THREE.Color(def.emissive),
    });
    const [map, alpha, normal, rough, metal, ao] = await Promise.all([
      this.texture(def.baseColorTexture, def, true), this.texture(def.opacityTexture, def, false),
      this.texture(def.normalTexture, def, false), this.texture(def.roughnessTexture, def, false),
      this.texture(def.metalnessTexture, def, false), this.texture(def.aoTexture, def, false),
    ]);
    if (map) material.map = map;
    if (alpha) { material.alphaMap = alpha; material.transparent = true; }
    if (normal) material.normalMap = normal;
    if (rough) material.roughnessMap = rough;
    if (metal) material.metalnessMap = metal;
    if (ao) { material.aoMap = ao; material.aoMapIntensity = def.aoIntensity; }
    return material;
  }
}

/** `applyMaterialSlotOverrides`: slot i replaces the model's i-th unique material (traversal order). */
async function applyMaterialSlots(assets: ProjectAssets, materials: ForgeMaterials, modelPath: string, scene: THREE.Group): Promise<number> {
  let slots: string[] = [];
  try {
    const doc = await assets.json<{ slots?: unknown[] }>(modelPath.replace(/\.[^./]+$/, ".materials.json"));
    slots = (doc.slots ?? []).map((slot) => (typeof slot === "string" ? slot : ""));
  } catch { return 0; }
  if (!slots.some(Boolean)) return 0;
  const unique: THREE.Material[] = [];
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (!unique.includes(m)) unique.push(m);
  });
  const resolved = await Promise.all(unique.map((m, i) => (slots[i] ? materials.material(slots[i]!) : Promise.resolve(undefined)).then((r) => r ?? m)));
  const byMaterial = new Map(unique.map((m, i) => [m, resolved[i]!]));
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => byMaterial.get(m) ?? m) : (byMaterial.get(mesh.material) ?? mesh.material);
  });
  return slots.filter(Boolean).length;
}

async function loadModels(assets: ProjectAssets, ids: Iterable<string>): Promise<{ models: Map<string, THREE.Group>; missing: string[]; slotted: number }> {
  const loader = new GLTFLoader();
  const forgeMaterials = new ForgeMaterials(assets);
  let slotted = 0;
  const models = new Map<string, THREE.Group>();
  const missing: string[] = [];
  await Promise.all([...new Set(ids)].map(async (id) => {
    const shape = shapeModel(id);
    if (shape) { models.set(id, shape); return; }
    const path = assets.assetPath(id);
    if (!path) { missing.push(id); return; }
    const gltf: GLTF = await loader.loadAsync(`/${path}`);
    gltf.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && !mesh.geometry.getAttribute("normal") && mesh.geometry.getAttribute("position")) mesh.geometry.computeVertexNormals();
    });
    gltf.scene.updateMatrixWorld(true);
    if (await applyMaterialSlots(assets, forgeMaterials, path, gltf.scene)) slotted += 1;
    models.set(id, gltf.scene);
  }));
  return { models, missing, slotted };
}

/** Level instances, the main grid's cells in load range, models, and the foliage ring at `camera`. */
export async function loadLevelContent(assets: ProjectAssets, levelPath: string, level: Record<string, unknown>, terrain: LoadedTerrain, camera: THREE.Vector3): Promise<LevelContent> {
  const started = performance.now();
  const settings = (level.worldSettings as Record<string, unknown> | undefined) ?? {};
  const batches = toBatches(level.instances as CellDoc["instances"], null);

  // World Partition cells (Forge: `<Level>.cells/<grid>/<x_z>.cell.json`).
  const partition = settings.partition as { enabled?: boolean; grids?: Record<string, { cellSize: number; loadRange: number }> } | undefined;
  const loadedCells: string[] = [];
  const main = partition?.enabled ? partition.grids?.main : undefined;
  if (main) {
    const def = terrain.def;
    const bounds = { minX: def.origin[0], minZ: def.origin[2], maxX: def.origin[0] + def.tilesX * def.tileQuads * def.spacing, maxZ: def.origin[2] + def.tilesZ * def.tileQuads * def.spacing };
    const targets = computeStreamingTargets({ loaded: new Set(), active: new Set() }, [{ position: [camera.x, camera.z] }], { cellSize: main.cellSize, loadRange: main.loadRange }, bounds);
    const base = levelPath.replace(/\.level\.json$/, "");
    await Promise.all(targets.toLoad.map(async (key) => {
      try {
        const doc = await assets.json<CellDoc>(`${base}.cells/main/${key}.cell.json`);
        batches.push(...toBatches(doc.instances, key));
        loadedCells.push(key);
      } catch { /* a cell with nothing in it has no file */ }
    }));
  }

  // Landscape foliage rules (`<Level>.foliage.json`).
  const foliage: FoliageCellBatch[] = [];
  const types = new Map<string, ForgeFoliageTypeDef>();
  const ruleStats: Record<string, { cells: number; instances: number; cellSize: number; radius: number }> = {};
  let rules: LandscapeFoliageRule[] = [];
  let residentTiles = 0;
  let waiting = 0;
  const far: FoliageFarBatch[] = [];
  const residentLookup = new TerrainTileMap();
  let globalMap: ReturnType<typeof buildTerrainGlobalAttributes> | undefined;
  try {
    const doc = await assets.json<{ landscapeRules?: LandscapeFoliageRule[] }>(levelPath.replace(/\.level\.json$/, ".foliage.json"));
    rules = doc.landscapeRules ?? [];
  } catch { rules = []; }
  if (rules.length) {
    const def = terrain.def;
    const bounds = { minX: def.origin[0], minZ: def.origin[2], maxX: def.origin[0] + def.tilesX * def.tileQuads * def.spacing, maxZ: def.origin[2] + def.tilesZ * def.tileQuads * def.spacing };
    const tileSize = def.tileQuads * def.spacing;
    const renderRange = Math.max(8, tileSize * 2);
    const resident = new Set(computeStreamingTargets({ loaded: new Set(), active: new Set() }, [{ position: [camera.x, camera.z] }],
      { cellSize: tileSize, origin: [def.origin[0], def.origin[2]], loadRange: renderRange, activateRange: renderRange }, bounds).toLoad);
    const declared = new Set(terrain.tiles.keys());
    const store = new FoliageTerrainStore();
    store.setTerrain("t", terrain.def);
    for (const [key, tile] of terrain.tiles) if (resident.has(key)) { store.setTile("t", tile); residentLookup.set(tile); }
    residentTiles = resident.size;
    const margin = 2 * def.spacing;
    const span = (min: number, max: number, origin: number, tiles: number) => [
      Math.max(0, Math.floor((min - margin - origin) / tileSize)), Math.min(tiles - 1, Math.floor((max + margin - origin) / tileSize))] as const;
    const tilesReady = (cellX: number, cellZ: number, cellSize: number): boolean => {
      const [x0, x1] = span(cellX * cellSize, (cellX + 1) * cellSize, def.origin[0], def.tilesX);
      const [z0, z1] = span(cellZ * cellSize, (cellZ + 1) * cellSize, def.origin[2], def.tilesZ);
      for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) {
        const key = `${x}_${z}`;
        if (declared.has(key) && !resident.has(key)) return false;
      }
      return true;
    };
    for (const rule of rules) {
      let type = types.get(rule.foliageTypeId);
      if (!type) {
        const path = assets.assetPath(rule.foliageTypeId);
        if (!path) continue;
        type = normalizeFoliageType(await assets.json(path));
        types.set(rule.foliageTypeId, type);
      }
      const cellSize = foliageRingCellSize(type.cullEnd, rule.density);
      const { radius } = foliageRingRadius(type.cullEnd, HIGH_CONTENT.foliageCullDistanceScale, bounds);
      const plan = planFoliageRing({ center: [camera.x, camera.z], radius, density: HIGH_CONTENT.grassDensity, bounds, built: new Map(), cellSize });
      const stat = { cells: 0, instances: 0, cellSize, radius };
      for (const cell of plan.build) {
        if (!tilesReady(cell.cellX, cell.cellZ, cellSize)) { waiting += 1; continue; }
        const generated = store.generate("t", rule, type, { cellX: cell.cellX, cellZ: cell.cellZ, cellSize, keepFraction: cell.keepFraction });
        if (generated.count === 0) continue;
        foliage.push({ ruleId: rule.id, type, key: `${rule.id}:${cell.key}`, count: generated.count, matrices: generated.matrices });
        stat.cells += 1;
        stat.instances += generated.count;
      }
      ruleStats[rule.id] = stat;

      // Far billboards (proceduralFoliageRing.planFar): blocks from the models' fade start
      // out to farDistance x scale, the ring's outermost keep, over the global map.
      if (foliageTypeHasFarBillboards(type)) {
        const scaleQ = HIGH_CONTENT.foliageCullDistanceScale;
        const end = type.cullEnd * scaleQ;
        const start = type.cullStart > 0 && type.cullStart < type.cullEnd ? type.cullStart * scaleQ : end;
        const farEnd = (type.farDistance ?? 0) * scaleQ;
        const keep = FOLIAGE_RING_BANDS[FOLIAGE_RING_BANDS.length - 1]!.keep * HIGH_CONTENT.grassDensity;
        const farPlan = planFarFoliage({ center: [camera.x, camera.z], nearRadius: start, farRadius: farEnd, bounds, built: new Set() });
        globalMap ??= buildTerrainGlobalAttributes(terrain.source);
        const surface = globalFoliageSurface(terrain.def, globalMap, residentLookup);
        for (const block of farPlan.build) {
          const generated = generateFoliageBlock(rule, type, surface, {
            blockX: block.blockX, blockZ: block.blockZ, cellSize, cellsPerSide: Math.max(1, Math.round(FOLIAGE_FAR_BLOCK_SIZE / cellSize)), keepFraction: keep,
          });
          if (generated.count === 0) continue;
          far.push({ ruleId: rule.id, type, key: `${rule.id}:${block.key}`, count: generated.count, matrices: generated.matrices,
            window: [start, end, Math.max(end, farEnd * (1 - IMPOSTOR_FAR_FADE)), farEnd] });
        }
      }
    }
  }

  const ids = new Set<string>([...batches.map((b) => b.assetId), ...[...types.values()].map((t) => t.meshAssetId).filter(Boolean)]);
  const { models, missing, slotted } = await loadModels(assets, ids);
  const radii = new Map<string, number>();
  for (const [id, scene] of models) {
    const box = new THREE.Box3().setFromObject(scene);
    radii.set(id, box.isEmpty() ? 0 : box.getBoundingSphere(new THREE.Sphere()).radius);
  }
  const staticCastShadow = settings.staticObjectsCastShadow !== false;
  return {
    batches, foliage, far, models, radii, staticCastShadow,
    describe: {
      loadMs: Math.round(performance.now() - started),
      placements: batches.reduce((n, b) => n + b.items.length, 0),
      batches: batches.length,
      assets: new Set(batches.map((b) => b.assetId)).size,
      cells: loadedCells.length,
      foliageCells: foliage.length,
      residentTiles, foliageCellsWaitingForTiles: waiting,
      farBlocks: far.length, farInstances: far.reduce((n, f) => n + f.count, 0),
      foliageInstances: foliage.reduce((n, f) => n + f.count, 0),
      rules: ruleStats,
      missingModels: missing,
      modelsWithMaterialSlots: slotted,
    },
  };
}
