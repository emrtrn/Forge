// Draw structures for the S4 content (shared/content.ts). Throwaway spike code.
//
// Mode "forge" (S4 (a), G1): Forge WebGL's own structure (src/scene, read only):
//  - static placements: one InstancedMesh per asset x model mesh, per scope (the
//    level, or one World Partition cell) (`createInstancedModelGroup`); level-wide
//    batches never frustum cull, cell batches do; instance colours divided by the base colour;
//  - small static assets (Faz 7e, `detailCullDistance`): size-scaled 4x4 dither
//    fade between 80 % and 100 % of radius x 200 x scale x the quality scale, in
//    colour and shadow; a cell batch past its largest instance's cull distance is
//    hidden whole (`detailBatchCulled`), a level-wide batch only fades;
//  - foliage: one InstancedMesh per ring cell x model mesh (`setPackedGroup`),
//    frustum culled, the cell hidden past cullEnd x scale (`updateCulling`), the
//    same dither fade per instance (hard cut when cullStart is 0), and the type's
//    wind sway (`windSway.ts`) within windSwayDistance;
//  - far billboards (`foliageImpostor.ts`): one InstancedMesh of camera-facing
//    quads per 512 m block, alpha tested, no shadows, the complementary dither
//    of the models' fade and their own fade over the last 15 % of farDistance.
//    Forge bakes an atlas of the model; here the quad shows the type's leaf
//    texture (same draw structure and cost class, approximate look).
// Mode "per-placement" (S4 (a')): every placement x model mesh its own Mesh;
// foliage as in "forge". Worst case of the renderer's per-object cost.
// Mode "instanced" (S4 (b)): an asset's model meshes merged per material (node
// transforms baked), one InstancedMesh per asset x material holding every
// placement of every scope, frustum culled on its bounds (detail fade per
// instance, whole-skip on the merged bounds); foliage ring cells gathered into
// 256 m blocks per rule x material, the block hidden past cullEnd x scale.
// Mode "batched": as "instanced", but static assets that never detail-cull and
// share a material signature go into one BatchedMesh per signature (one draw,
// three's per-instance CPU frustum culling); detail-culled assets keep their
// InstancedMesh (BatchedMesh has no per-instance attribute for the fade).
import * as THREE from "three/webgpu";
import * as TSLTyped from "three/tsl";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { detailBatchCulled, detailCullDistance, detailCullWindow } from "@engine/world/detailCulling";
import { resolveLevelWind } from "@engine/environment/wind";
import { createGpuCulledFoliage, type GpuCulledFoliage } from "./gpuCull";
import { HIGH_CONTENT, type FoliageCellBatch, type FoliageFarBatch, type LevelContent, type PlacementBatch } from "./content";

const TSL = TSLTyped as any;

export type ContentMode = "forge" | "per-placement" | "instanced" | "batched" | "gpu-cull";

export interface ContentOptions {
  /** Mode "gpu-cull": the rule drawn by compute culling + drawIndexedIndirect. */
  cullRule?: string | undefined;
  /** Modes "instanced" / "gpu-cull": the rule drawn as one InstancedMesh without any culling (G7 reference); "*" = every rule (CPU floor diagnostic). */
  noCullRule?: string | undefined;
}

/** An asset's model meshes merged per material (and attribute set), node transforms baked. */
interface MergedPart { material: THREE.Material; geometry: THREE.BufferGeometry; signature: string }

function attributeSignature(geometry: THREE.BufferGeometry): string {
  return `${geometry.index ? "i" : "n"}|${Object.entries(geometry.attributes).map(([n, a]) => `${n}:${a.itemSize}`).sort().join(",")}`;
}

function materialSignature(m: THREE.Material): string {
  const x = m as THREE.MeshStandardMaterial;
  const id = (t: THREE.Texture | null | undefined) => (t ? t.uuid : "-");
  return [m.type, x.color?.getHexString(), id(x.map), id(x.alphaMap), id(x.normalMap), id(x.roughnessMap), id(x.metalnessMap), id(x.aoMap),
    x.roughness, x.metalness, m.transparent, m.alphaTest, m.side, m.vertexColors, m.depthWrite].join("|");
}

const mergedCache = new WeakMap<THREE.Group, MergedPart[]>();
function mergedParts(model: THREE.Group): MergedPart[] {
  let parts = mergedCache.get(model);
  if (parts) return parts;
  const groups = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
  model.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.getAttribute("position") || Array.isArray(mesh.material)) return;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const key = `${mesh.material.uuid}|${attributeSignature(geometry)}`;
    const entry = groups.get(key) ?? { material: mesh.material, geometries: [] };
    entry.geometries.push(geometry);
    groups.set(key, entry);
  });
  parts = [...groups.values()].map(({ material, geometries }) => {
    const geometry = geometries.length === 1 ? geometries[0]! : mergeGeometries(geometries, false)!;
    return { material, geometry, signature: `${materialSignature(material)}#${attributeSignature(geometry)}` };
  });
  mergedCache.set(model, parts);
  return parts;
}

export interface ContentView {
  root: THREE.Group;
  /** Per frame, before rendering. */
  update(camera: THREE.Camera, timeSeconds: number): void;
  /** Mode "gpu-cull": the last cull's visible instance count (diagnostics). */
  gpuVisible(camera: THREE.Camera): Promise<{ gpu: number; cpu: number } | null>;
  /** Static detail whole-skip decisions for the camera (diagnostics). */
  skipDebug(camera: THREE.Camera): Record<string, unknown>[];
  describe: Record<string, unknown>;
}

export interface Shared {
  /** View camera position: fade and sway measure from it, also in shadow passes. */
  viewOrigin: any;
  windTime: any;
  windDirection: any;
  windStrength: any;
  windGust: any;
  swayFadeRange: any;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** Instance origin (xyz) and placement scale (w), one per instance. */
function originAttribute(count: number, matrixAt: (i: number, out: THREE.Matrix4) => void, scaleAt: (i: number) => number): THREE.InstancedBufferAttribute {
  const data = new Float32Array(count * 4);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i += 1) {
    matrixAt(i, m);
    data[i * 4] = m.elements[12]!;
    data[i * 4 + 1] = m.elements[13]!;
    data[i * 4 + 2] = m.elements[14]!;
    data[i * 4 + 3] = scaleAt(i);
  }
  return new THREE.InstancedBufferAttribute(data, 4);
}

/** A geometry sharing the source's attributes, plus its own per-instance origin. */
function withOrigin(source: THREE.BufferGeometry, origin: THREE.InstancedBufferAttribute): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.index = source.index;
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.groups = source.groups;
  geometry.setAttribute("forgeOrigin", origin);
  return geometry;
}

export interface Variant {
  /** Dither fade window uniform (start, end), or null. */
  fade: any | null;
  /** Divide the fade distance by the instance scale (static detail culling). */
  scaled: boolean;
  /** Origin from the instance attribute, or from the object (per-placement meshes). */
  perInstance: boolean;
  sway: { amplitude: number; height: number; frequency: number } | null;
}

/**
 * Wind sway (windSway.ts, world space) and the 4x4 dither fade on a node material,
 * from the instance origin (xyz) and scale (w). `basePosition` is the world
 * position the sway offsets (positionLocal for identity-placed batches).
 */
export function applyInstanceEffects(material: any, origin: any, variant: Variant, s: Shared, basePosition: any): void {
  const { vec2, vec3, float, int, distance, clamp, max, smoothstep, sin, dot, select, screenCoordinate, array } = TSL;
    if (variant.sway) {
      const { amplitude, height, frequency } = variant.sway;
      // windSway.ts, in world space: the batches sit at identity, so positionLocal is world after instancing.
      const p = basePosition;
      const o = origin.xyz;
      const swayFade = select(s.swayFadeRange.y.greaterThan(0), float(1).sub(smoothstep(s.swayFadeRange.x, s.swayFadeRange.y, distance(o, s.viewOrigin))), float(1));
      const mask0 = clamp(p.y.sub(o.y).div(max(origin.w.mul(height), 1e-4)), 0, 1);
      const mask = mask0.mul(mask0);
      const phase = dot(o.xz, vec2(0.37, 0.23));
      const gustWave = sin(dot(o.xz, s.windDirection).mul(0.08).sub(s.windTime.mul(1.3))).mul(0.5).add(0.5);
      const gust = s.windGust.mul(gustWave).mul(gustWave);
      const flutter = sin(s.windTime.mul(6.2831853 * frequency).add(phase));
      const amount = float(amplitude).mul(s.windStrength).mul(mask).mul(swayFade).mul(flutter.mul(0.4).add(0.6).add(gust));
      material.positionNode = p.add(vec3(s.windDirection.x, 0, s.windDirection.y).mul(amount));
    }
    if (variant.fade) {
      const range = variant.fade;
      let d = distance(origin.xyz, s.viewOrigin);
      if (variant.scaled) d = d.div(max(origin.w, 1e-4));
      const fade = clamp(range.y.sub(d).div(max(range.y.sub(range.x), 1e-4)), 0, 1);
      const cell = screenCoordinate.xy.mod(4);
      const threshold = array(BAYER.map((v) => float(v))).element(int(cell.x).add(int(cell.y).mul(4)));
      const keep = fade.greaterThanEqual(threshold);
      material.maskNode = keep;
      material.maskShadowNode = keep;
    }
}

class MaterialCache {
  private readonly cache = new Map<string, THREE.Material>();
  count = 0;
  constructor(private readonly renderer: THREE.WebGPURenderer, private readonly shared: Shared) {}

  get(source: THREE.Material, key: string, variant: Variant): THREE.Material {
    if (!variant.fade && !variant.sway) return source;
    const id = `${source.uuid}|${key}`;
    let material = this.cache.get(id);
    if (!material) {
      material = this.build(source, variant);
      this.cache.set(id, material);
      this.count += 1;
    }
    return material;
  }

  private build(source: THREE.Material, variant: Variant): THREE.Material {
    const library = (this.renderer as unknown as { library: { fromMaterial(m: THREE.Material): THREE.Material } }).library;
    const material = library.fromMaterial(source) as any;
    const { max, attribute, positionLocal, modelWorldMatrix, modelScale } = TSL;
    const s = this.shared;
    const origin = variant.perInstance
      ? attribute("forgeOrigin", "vec4")
      : TSL.vec4(modelWorldMatrix.mul(TSL.vec4(0, 0, 0, 1)).xyz, max(max(modelScale.x, modelScale.y), modelScale.z));
    applyInstanceEffects(material, origin, variant, s, positionLocal);
    return material as THREE.Material;
  }
}

function renderableMeshes(model: THREE.Group): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  model.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry?.getAttribute("position")) out.push(mesh);
  });
  return out;
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

const WHITE = new THREE.Color(1, 1, 1);

export function buildContentView(renderer: THREE.WebGPURenderer, level: Record<string, unknown>, content: LevelContent, mode: ContentMode, options: ContentOptions = {}): ContentView {
  const { uniform } = TSL;
  const shared: Shared = {
    viewOrigin: uniform(new THREE.Vector3()),
    windTime: uniform(0),
    windDirection: uniform(new THREE.Vector2(0, 1)),
    windStrength: uniform(0),
    windGust: uniform(0),
    swayFadeRange: uniform(new THREE.Vector2(0, 0)),
  };
  const wind = resolveLevelWind(level as never, null);
  shared.windDirection.value.set(wind.direction[0], wind.direction[1]);
  shared.windStrength.value = wind.strength;
  shared.windGust.value = wind.gust;
  shared.swayFadeRange.value.set(HIGH_CONTENT.windSwayDistance * 0.75, HIGH_CONTENT.windSwayDistance);

  const materials = new MaterialCache(renderer, shared);
  const root = new THREE.Group();
  root.name = `s4-content-${mode}`;
  const scale = HIGH_CONTENT.foliageCullDistanceScale;
  let meshCount = 0;
  let instanceCount = 0;

  // Static detail fade windows, one per asset.
  const detailWindows = new Map<string, { cullDistance: number; uniform: any }>();
  const detailOf = (assetId: string) => {
    let entry = detailWindows.get(assetId);
    if (entry === undefined) {
      const cullDistance = detailCullDistance(content.radii.get(assetId) ?? 0);
      if (cullDistance === null) return null;
      const [start, end] = detailCullWindow(cullDistance, scale);
      entry = { cullDistance, uniform: uniform(new THREE.Vector2(start, end)) };
      detailWindows.set(assetId, entry);
    }
    return entry;
  };
  const wholeSkip: { mesh: THREE.Object3D; sphere: THREE.Sphere; cullDistance: number; maxScale: number; name: string }[] = [];

  const buildStaticBatch = (batch: PlacementBatch) => {
    const model = content.models.get(batch.assetId);
    if (!model) return;
    const detail = detailOf(batch.assetId);
    const group = new THREE.Group();
    group.name = `static-${batch.assetId}-${batch.cell ?? "level"}`;
    for (const source of renderableMeshes(model)) {
      const sourceMatrix = source.matrixWorld;
      if (mode === "per-placement") {
        for (const item of batch.items) {
          const mats = materialsOf(source).map((m) => {
            let base = m;
            if (item.color !== undefined && (m as { color?: THREE.Color }).color) {
              base = m.clone();
              (base as unknown as { color: THREE.Color }).color.set(item.color);
            }
            return materials.get(base, `pp:${batch.assetId}`, { fade: detail?.uniform ?? null, scaled: true, perInstance: false, sway: null });
          });
          const mesh = new THREE.Mesh(source.geometry, mats.length === 1 ? mats[0]! : mats);
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(item.matrix).multiply(sourceMatrix);
          mesh.castShadow = content.staticCastShadow;
          mesh.receiveShadow = true;
          group.add(mesh);
          meshCount += 1;
        }
        continue;
      }
      const count = batch.items.length;
      const capacity = Math.max(1, count);
      const origin = originAttribute(capacity, (i, out) => (batch.items[i] ? out.copy(batch.items[i]!.matrix).multiply(sourceMatrix) : out.identity()), (i) => batch.items[i]?.scale ?? 1);
      const mats = materialsOf(source).map((m) => materials.get(m, `st:${batch.assetId}`, { fade: detail?.uniform ?? null, scaled: true, perInstance: true, sway: null }));
      const instanced = new THREE.InstancedMesh(withOrigin(source.geometry, origin), mats.length === 1 ? mats[0]! : mats, capacity);
      instanced.count = count;
      // Level-wide eager batches never cull; a cell batch is compact enough to (RuntimeSceneApp).
      instanced.frustumCulled = batch.cell !== null;
      instanced.castShadow = content.staticCastShadow;
      instanced.receiveShadow = true;
      const m = new THREE.Matrix4();
      for (let i = 0; i < count; i += 1) instanced.setMatrixAt(i, m.copy(batch.items[i]!.matrix).multiply(sourceMatrix));
      if (batch.items.some((item) => item.color !== undefined)) {
        const base = (materialsOf(source)[0] as { color?: THREE.Color }).color ?? WHITE;
        const c = new THREE.Color();
        for (let i = 0; i < count; i += 1) {
          const color = batch.items[i]!.color;
          if (color === undefined) { instanced.setColorAt(i, WHITE); continue; }
          c.set(color);
          c.setRGB(base.r > 0 ? c.r / base.r : c.r, base.g > 0 ? c.g / base.g : c.g, base.b > 0 ? c.b / base.b : c.b);
          instanced.setColorAt(i, c);
        }
      }
      if (batch.cell !== null) instanced.computeBoundingSphere();
      group.add(instanced);
      meshCount += 1;
      if (detail && batch.cell !== null) {
        instanced.computeBoundingSphere();
        wholeSkip.push({ mesh: instanced, sphere: instanced.boundingSphere!.clone(), cullDistance: detail.cullDistance, maxScale: Math.max(...batch.items.map((it) => it.scale)), name: group.name });
      }
    }
    instanceCount += batch.items.length;
    root.add(group);
  };
  // Modes "instanced" / "batched": every placement of an asset in one InstancedMesh per merged part.
  let batchedMeshes = 0;
  const buildMergedStatics = () => {
    const byAsset = new Map<string, PlacementBatch["items"]>();
    for (const batch of content.batches) byAsset.set(batch.assetId, [...(byAsset.get(batch.assetId) ?? []), ...batch.items]);
    const batched = new Map<string, { material: THREE.Material; entries: { geometry: THREE.BufferGeometry; items: PlacementBatch["items"] }[] }>();
    const m = new THREE.Matrix4();
    for (const [assetId, items] of byAsset) {
      const model = content.models.get(assetId);
      if (!model || items.length === 0) continue;
      const detail = detailOf(assetId);
      const group = new THREE.Group();
      group.name = `static-${assetId}-merged`;
      for (const part of mergedParts(model)) {
        if (mode === "batched" && !detail && items.every((it) => it.color === undefined)) {
          const entry = batched.get(part.signature) ?? { material: part.material, entries: [] };
          entry.entries.push({ geometry: part.geometry, items });
          batched.set(part.signature, entry);
          continue;
        }
        const count = items.length;
        const origin = originAttribute(count, (i, out) => out.copy(items[i]!.matrix), (i) => items[i]!.scale);
        const material = materials.get(part.material, `st:${assetId}`, { fade: detail?.uniform ?? null, scaled: true, perInstance: true, sway: null });
        const instanced = new THREE.InstancedMesh(withOrigin(part.geometry, origin), material, count);
        for (let i = 0; i < count; i += 1) instanced.setMatrixAt(i, m.copy(items[i]!.matrix));
        if (items.some((it) => it.color !== undefined)) {
          const base = (part.material as { color?: THREE.Color }).color ?? WHITE;
          const c = new THREE.Color();
          for (let i = 0; i < count; i += 1) {
            const color = items[i]!.color;
            if (color === undefined) { instanced.setColorAt(i, WHITE); continue; }
            c.set(color);
            c.setRGB(base.r > 0 ? c.r / base.r : c.r, base.g > 0 ? c.g / base.g : c.g, base.b > 0 ? c.b / base.b : c.b);
            instanced.setColorAt(i, c);
          }
        }
        instanced.castShadow = content.staticCastShadow;
        instanced.receiveShadow = true;
        instanced.computeBoundingSphere();
        instanced.frustumCulled = true;
        group.add(instanced);
        meshCount += 1;
        if (detail) wholeSkip.push({ mesh: instanced, sphere: instanced.boundingSphere!.clone(), cullDistance: detail.cullDistance, maxScale: Math.max(...items.map((it) => it.scale)), name: group.name });
      }
      instanceCount += items.length;
      if (group.children.length) root.add(group);
    }
    for (const [signature, entry] of batched) {
      const vertexCount = entry.entries.reduce((n, e) => n + e.geometry.getAttribute("position").count, 0);
      const indexCount = entry.entries.reduce((n, e) => n + (e.geometry.index?.count ?? 0), 0);
      const instances = entry.entries.reduce((n, e) => n + e.items.length, 0);
      const batch = new THREE.BatchedMesh(instances, vertexCount, Math.max(indexCount, 1), entry.material);
      for (const { geometry, items } of entry.entries) {
        const geometryId = batch.addGeometry(geometry);
        for (const item of items) batch.setMatrixAt(batch.addInstance(geometryId), item.matrix);
      }
      batch.castShadow = content.staticCastShadow;
      batch.receiveShadow = true;
      batch.name = `static-batched-${signature.slice(0, 24)}`;
      const group = new THREE.Group();
      group.name = "static-batched";
      group.add(batch);
      root.add(group);
      meshCount += 1;
      batchedMeshes += 1;
    }
  };
  const merged = mode === "instanced" || mode === "batched" || mode === "gpu-cull";
  if (merged) buildMergedStatics();
  else for (const batch of content.batches) buildStaticBatch(batch);

  // Foliage ring cells.
  const foliageChunks: { group: THREE.Group; center: THREE.Vector3; radius: number; cullEnd: number }[] = [];
  const typeWindows = new Map<string, any>();
  const buildFoliageCell = (cell: FoliageCellBatch, merged = false) => {
    const model = content.models.get(cell.type.meshAssetId);
    if (!model) return;
    const window = cell.type.cullEnd > 0
      ? (typeWindows.get(cell.ruleId) ?? (() => {
        const end = cell.type.cullEnd * scale;
        const start = cell.type.cullStart > 0 && cell.type.cullStart < cell.type.cullEnd ? cell.type.cullStart * scale : end;
        const u = uniform(new THREE.Vector2(start, end));
        typeWindows.set(cell.ruleId, u);
        return u;
      })())
      : null;
    const sway = cell.type.sway && cell.type.sway.amplitude > 0 ? cell.type.sway : null;
    const group = new THREE.Group();
    group.name = `foliage-${cell.key}`;
    const instanceMatrix = new THREE.Matrix4();
    const meshRadius = content.radii.get(cell.type.meshAssetId) ?? 0;
    const sources: { geometry: THREE.BufferGeometry; materials: THREE.Material[]; matrix: THREE.Matrix4 }[] = merged
      ? mergedParts(model).map((part) => ({ geometry: part.geometry, materials: [part.material], matrix: new THREE.Matrix4() }))
      : renderableMeshes(model).map((mesh) => ({ geometry: mesh.geometry, materials: materialsOf(mesh), matrix: mesh.matrixWorld }));
    for (const source of sources) {
      const sourceMatrix = source.matrix;
      const origin = originAttribute(cell.count, (i, out) => out.fromArray(cell.matrices, i * 16).multiply(sourceMatrix), (i) => {
        const e = cell.matrices;
        return Math.hypot(e[i * 16 + 4]!, e[i * 16 + 5]!, e[i * 16 + 6]!);
      });
      const mats = source.materials.map((m) => materials.get(m, `fo:${cell.ruleId}`, { fade: window, scaled: false, perInstance: true, sway }));
      const instanced = new THREE.InstancedMesh(withOrigin(source.geometry, origin), mats.length === 1 ? mats[0]! : mats, cell.count);
      for (let i = 0; i < cell.count; i += 1) instanced.setMatrixAt(i, instanceMatrix.fromArray(cell.matrices, i * 16).multiply(sourceMatrix));
      instanced.castShadow = cell.type.castShadow;
      instanced.receiveShadow = cell.type.receiveShadow;
      instanced.frustumCulled = true;
      instanced.computeBoundingSphere();
      group.add(instanced);
      meshCount += 1;
    }
    const center = new THREE.Vector3();
    for (let i = 0; i < cell.count; i += 1) center.add(new THREE.Vector3(cell.matrices[i * 16 + 12], cell.matrices[i * 16 + 13], cell.matrices[i * 16 + 14]));
    center.multiplyScalar(1 / Math.max(cell.count, 1));
    let maxSq = 0;
    for (let i = 0; i < cell.count; i += 1) {
      const dx = cell.matrices[i * 16 + 12]! - center.x, dy = cell.matrices[i * 16 + 13]! - center.y, dz = cell.matrices[i * 16 + 14]! - center.z;
      maxSq = Math.max(maxSq, dx * dx + dy * dy + dz * dz);
    }
    foliageChunks.push({ group, center, radius: Math.sqrt(maxSq) + meshRadius, cullEnd: cell.type.cullEnd * scale });
    instanceCount += cell.count;
    root.add(group);
  };
  // Modes "instanced" / "batched": ring cells gathered into 256 m blocks per rule x merged part.
  const FOLIAGE_BLOCK = 256;
  let gpu: GpuCulledFoliage | null = null;
  let noCull: Record<string, unknown> | null = null;
  const gatherRule = (ruleId: string) => {
    const cells = content.foliage.filter((c) => c.ruleId === ruleId);
    const count = cells.reduce((n, c) => n + c.count, 0);
    const matrices = new Float32Array(count * 16);
    let at = 0;
    for (const c of cells) { matrices.set(c.matrices, at); at += c.matrices.length; }
    return { cells, count, matrices };
  };
  const buildMergedFoliage = () => {
    const noCullRules = options.noCullRule === "*" ? [...new Set(content.foliage.map((c) => c.ruleId))] : options.noCullRule ? [options.noCullRule] : [];
    const special = new Set([mode === "gpu-cull" ? options.cullRule : undefined, ...noCullRules].filter((r): r is string => !!r));
    if (mode === "gpu-cull" && options.cullRule) {
      const { cells, count, matrices } = gatherRule(options.cullRule);
      const type = cells[0]?.type;
      const model = type ? content.models.get(type.meshAssetId) : undefined;
      const parts = model ? mergedParts(model) : [];
      if (!type || parts.length !== 1) throw new Error(`gpu-cull: rule ${options.cullRule} needs one merged part, has ${parts.length}`);
      const end = type.cullEnd * scale;
      const start = type.cullStart > 0 && type.cullStart < type.cullEnd ? type.cullStart * scale : end;
      const window = type.cullEnd > 0 ? uniform(new THREE.Vector2(start, end)) : null;
      const sway = type.sway && type.sway.amplitude > 0 ? type.sway : null;
      gpu = createGpuCulledFoliage(renderer, {
        geometry: parts[0]!.geometry, material: parts[0]!.material, matrices, count,
        radius: content.radii.get(type.meshAssetId) ?? 1, cullEnd: type.cullEnd > 0 ? end : 0,
        decorate: (material, origin) => applyInstanceEffects(material, origin, { fade: window, scaled: false, perInstance: true, sway }, shared, material.positionNode),
      });
      const group = new THREE.Group();
      group.name = `foliage-gpu-${options.cullRule}`;
      group.add(gpu.object);
      root.add(group);
      meshCount += 1;
      instanceCount += count;
    }
    for (const rule of noCullRules) {
      const { cells, count, matrices } = gatherRule(rule);
      if (!cells.length) continue;
      const before = root.children.length;
      buildFoliageCell({ ruleId: cells[0]!.ruleId, type: cells[0]!.type, key: `${rule}:all`, count, matrices }, true);
      // No culling at all: no frustum test, no distance cull of the batch.
      const group = root.children[before]!;
      group.traverse((o) => { o.frustumCulled = false; });
      foliageChunks.pop();
      noCull = { rules: noCullRules, instances: ((noCull?.instances as number | undefined) ?? 0) + count };
    }
    const blocks = new Map<string, FoliageCellBatch[]>();
    for (const cell of content.foliage) {
      if (special.has(cell.ruleId)) continue;
      const x = Math.floor(cell.matrices[12]! / FOLIAGE_BLOCK);
      const z = Math.floor(cell.matrices[14]! / FOLIAGE_BLOCK);
      const key = `${cell.ruleId}:${x}_${z}`;
      blocks.set(key, [...(blocks.get(key) ?? []), cell]);
    }
    for (const [key, cells] of blocks) {
      const first = cells[0]!;
      const count = cells.reduce((n, c) => n + c.count, 0);
      const matrices = new Float32Array(count * 16);
      let at = 0;
      for (const c of cells) { matrices.set(c.matrices, at); at += c.matrices.length; }
      buildFoliageCell({ ruleId: first.ruleId, type: first.type, key, count, matrices }, true);
    }
  };
  if (merged) buildMergedFoliage();
  else for (const cell of content.foliage) buildFoliageCell(cell);

  let farMeshes = 0;
  let farInstances = 0;
  const buildFarBlock = (far: FoliageFarBatch) => {
    const model = content.models.get(far.type.meshAssetId);
    if (!model) return;
    let leaf: THREE.MeshStandardMaterial | null = null;
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || leaf) return;
      for (const m of materialsOf(mesh)) if ((m as THREE.MeshStandardMaterial).map && ((m as THREE.MeshStandardMaterial).alphaMap || m.alphaTest > 0)) { leaf = m as THREE.MeshStandardMaterial; break; }
    });
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const width = Math.max(size.x, size.z);
    const { vec2, vec3, float, int, distance, clamp, normalize, attribute, positionGeometry, screenCoordinate, array, transformNormalToView } = TSL;
    const material = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.5, roughness: 1, metalness: 0 }) as any;
    const sourceLeaf = leaf as THREE.MeshStandardMaterial | null;
    if (sourceLeaf) { material.map = sourceLeaf.map; material.alphaMap = sourceLeaf.alphaMap; material.color.copy(sourceLeaf.color); }
    const origin = attribute("forgeOrigin", "vec4");
    const toCam = normalize(vec2(shared.viewOrigin.x.sub(origin.x), shared.viewOrigin.z.sub(origin.z)).add(vec2(1e-5, 0)));
    const right = vec3(toCam.y, 0, toCam.x.negate());
    const g = positionGeometry;
    material.positionNode = origin.xyz.add(right.mul(g.x.mul(width).mul(origin.w))).add(vec3(0, g.y.add(0.5).mul(size.y).add(box.min.y).mul(origin.w), 0));
    material.normalNode = transformNormalToView(vec3(0, 1, 0));
    const [w0, w1, w2, w3] = far.window;
    const d = distance(origin.xyz, shared.viewOrigin);
    const modelFade = clamp(float(w1).sub(d).div(Math.max(w1 - w0, 1e-4)), 0, 1);
    const farFade = clamp(float(w3).sub(d).div(Math.max(w3 - w2, 1e-4)), 0, 1);
    const cell = screenCoordinate.xy.mod(4);
    const threshold = array(BAYER.map((v) => float(v))).element(int(cell.x).add(int(cell.y).mul(4)));
    material.maskNode = modelFade.lessThan(threshold).and(farFade.greaterThanEqual(threshold));
    const originData = originAttribute(far.count, (i, out) => out.fromArray(far.matrices, i * 16), (i) => Math.hypot(far.matrices[i * 16]!, far.matrices[i * 16 + 1]!, far.matrices[i * 16 + 2]!));
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute("forgeOrigin", originData);
    const mesh = new THREE.InstancedMesh(geometry, material as THREE.Material, far.count);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < far.count; i += 1) points.push(new THREE.Vector3(far.matrices[i * 16 + 12], far.matrices[i * 16 + 13], far.matrices[i * 16 + 14]));
    const sphere = new THREE.Sphere().setFromPoints(points);
    sphere.radius += Math.max(width, size.y) * 2;
    mesh.boundingSphere = sphere;
    mesh.frustumCulled = true;
    mesh.name = `foliage-far:${far.key}`;
    root.add(mesh);
    farMeshes += 1;
    farInstances += far.count;
  };
  for (const far of content.far) buildFarBlock(far);

  return {
    root,
    update(camera, timeSeconds) {
      const p = camera.position;
      gpu?.cull(camera as THREE.PerspectiveCamera);
      shared.viewOrigin.value.copy(p);
      shared.windTime.value = timeSeconds;
      for (const chunk of foliageChunks) {
        if (chunk.cullEnd <= 0) continue;
        chunk.group.visible = p.distanceTo(chunk.center) - chunk.radius <= chunk.cullEnd;
      }
      for (const entry of wholeSkip) {
        entry.mesh.visible = !detailBatchCulled(entry.sphere.center.distanceTo(p), entry.sphere.radius, entry.cullDistance, entry.maxScale, scale);
      }
    },
    gpuVisible: async (camera) => {
      if (!gpu) return null;
      const g = gpu as GpuCulledFoliage;
      return { gpu: await g.readVisible(), cpu: g.expectedVisible(camera as THREE.PerspectiveCamera) };
    },
    skipDebug(camera) {
      return wholeSkip.map((e) => ({ name: e.name, d: Math.round(e.sphere.center.distanceTo(camera.position)), r: Math.round(e.sphere.radius), cull: Math.round(e.cullDistance), maxScale: e.maxScale,
        culled: detailBatchCulled(e.sphere.center.distanceTo(camera.position), e.sphere.radius, e.cullDistance, e.maxScale, scale) }));
    },
    describe: {
      mode, meshes: meshCount, instances: instanceCount, patchedMaterials: materials.count,
      detailAssets: detailWindows.size, wholeSkipBatches: wholeSkip.length, foliageChunks: foliageChunks.length,
      farMeshes, farInstances, batchedMeshes,
      gpuCull: gpu ? (gpu as GpuCulledFoliage).describe : null, noCull,
      staticInstancedMeshes: root.children.filter((c) => c.name.startsWith("static-")).reduce((n, g) => n + g.children.length, 0),
      staticInstanceSum: root.children.filter((c) => c.name.startsWith("static-")).reduce((n, g) => n + g.children.reduce((k, m) => k + ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1), 0), 0),
      wind: { strength: wind.strength, gust: wind.gust, direction: wind.direction },
    },
  };
}
