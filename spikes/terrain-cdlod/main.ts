import {
  BoxGeometry,
  BufferAttribute,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Euler,
  Fog,
  Frustum,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  Sphere,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  Box3,
  type Texture,
} from "three";

import { createSceneRenderer } from "@engine/render-three/renderer";
import { GpuFrameTimer } from "@engine/perf/gpuTimer";
import { terrainHeightAt } from "@engine/terrain/terrainHeightQuery";

import { CdlodSelector, cdlodMorphRanges, type CdlodBox, type CdlodVisit } from "./cdlod";
import {
  TerrainTexturePool,
  createGlobalHeightTexture,
  createGlobalWeightTexture,
  heightBytesPerTexel,
  pickHeightFormat,
  type SlotUploadTiming,
} from "./texturePool";
import { createTerrainMaterials } from "./terrainMaterial";
import { encodedTileHeights, encodedTileWeights, generateSpikeWorld } from "./worldGen";

/**
 * OPEN_WORLD_PLAN Faz 0 / S1+S2 spike page — throwaway, never merged.
 * Open: npm run dev:smoke → http://127.0.0.1:5273/spikes/terrain-cdlod/index.html
 * URL knobs: tiles, patch, slots, range0, shadow, shadowExtent, dpr,
 * uploadsPerFrame, layers (4 | 8), heightFormat (r16-norm | r32f | r16f), pose=x,y,z,yaw,pitch
 * (y is metres above ground).
 */

// --- settings -------------------------------------------------------------------

const params = new URLSearchParams(location.search);
function param(key: string, fallback: number, min: number, max: number): number {
  const raw = Number(params.get(key));
  return params.has(key) && Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : fallback;
}
function powerOfTwo(value: number): number {
  return 2 ** Math.round(Math.log2(value));
}

const TILE_QUADS = 256;
const SPACING = 1;
const TILES = powerOfTwo(param("tiles", 16, 2, 32));
const PATCH = powerOfTwo(param("patch", 32, 8, 64));
// Default covers the LOD3 range (range0 = 4 × leaf → 4 tiles): 1 + 4r + πr² ≈ 67 tiles + hysteresis.
const SLOTS = Math.round(param("slots", 80, 4, 256));
const LEAF = PATCH * SPACING;
const RANGE0 = param("range0", LEAF * 4, LEAF * 2, 4096);
const SHADOW_MAP = Math.round(param("shadow", 2048, 0, 8192));
const SHADOW_EXTENT = param("shadowExtent", 160, 20, 2000);
const DPR = param("dpr", Math.min(devicePixelRatio, 2), 0.5, 3);
const UPLOADS_PER_FRAME = Math.round(param("uploadsPerFrame", 2, 1, 64));
// 8 = the schema maximum: two RGBA8 weight blocks per tile (S3 measures this).
const LAYERS = param("layers", 4, 4, 8) > 4 ? 8 : 4;
const WEIGHT_BLOCKS = LAYERS / 4;
const TILE_SIZE = TILE_QUADS * SPACING;
const WORLD_SIZE = TILES * TILE_SIZE;
const LEVELS = Math.log2(WORLD_SIZE / LEAF) + 1;
const TILE_LEVEL = Math.log2(TILE_SIZE / LEAF);
// One level above a tile, a node's quad equals the global map texel.
const GLOBAL_STRIDE = (2 * TILE_QUADS) / PATCH;
const MAX_INSTANCES = 8192;

// --- DOM --------------------------------------------------------------------------

const canvas = document.getElementById("spike-canvas") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLPreElement;
const status = document.getElementById("status") as HTMLDivElement;
const report = document.getElementById("report") as HTMLTextAreaElement;
const reportPanel = document.getElementById("report-panel") as HTMLDivElement;
const copyButton = document.getElementById("copy-report") as HTMLButtonElement;
const closeButton = document.getElementById("close-report") as HTMLButtonElement;

copyButton.addEventListener("click", () => {
  void navigator.clipboard.writeText(report.value).then(() => {
    copyButton.textContent = "Copied";
    setTimeout(() => (copyButton.textContent = "Copy"), 1200);
  });
});
closeButton.addEventListener("click", () => (reportPanel.hidden = true));

// --- boot -------------------------------------------------------------------------

const renderer = createSceneRenderer(canvas, DPR);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight, false);
// three renders shadow maps before its per-frame info reset, so shadow draws
// would go uncounted; reset by hand before each frame instead.
renderer.info.autoReset = false;
const gl = renderer.getContext() as WebGL2RenderingContext;
const gpuTimer = GpuFrameTimer.create(gl);
const gpuName = (() => {
  const ext = gl.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null;
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
})();
const heightFormat = pickHeightFormat(renderer);

status.textContent = "Generating world…";
const world = await generateSpikeWorld(
  { tiles: TILES, tileQuads: TILE_QUADS, spacing: SPACING, leafQuads: PATCH, globalStride: GLOBAL_STRIDE, seed: 1337, layerCount: LAYERS },
  (done, total) => (status.textContent = `Generating world… ${done}/${total} tiles`),
);
const def = world.def;
const origin = new Vector3(def.origin[0], def.origin[1], def.origin[2]);

status.textContent = "Loading layer textures…";
const loader = new TextureLoader();
async function layerTexture(path: string): Promise<Texture | null> {
  try {
    const texture = await loader.loadAsync(path);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
  } catch {
    console.warn(`[spike] missing layer texture ${path}`);
    return null;
  }
}
const textureRoot = "/assets/starter-content/Textures/";
const [grassTex, dirtTex, rockTex] = await Promise.all([
  layerTexture(`${textureRoot}T_Ground_Grass_D.png`),
  layerTexture(`${textureRoot}T_Ground_Gravel_D.png`),
  layerTexture(`${textureRoot}T_Rock_Slate_D.png`),
]);

// --- terrain GPU resources -----------------------------------------------------------

const pool = new TerrainTexturePool(heightFormat, SLOTS, world.size, WEIGHT_BLOCKS);
renderer.initTexture(pool.heights);
renderer.initTexture(pool.weights);
const globalHeight = createGlobalHeightTexture(heightFormat, world.global.size, world.global.heights);
const globalWeight = createGlobalWeightTexture(world.global.size, world.global.weights);

const cdlodSettings = { leafSize: LEAF, levels: LEVELS, range0: RANGE0, morphStartRatio: 0.7 };
const selector = new CdlodSelector(cdlodSettings, world.pyramid);
const terrain = createTerrainMaterials({
  heightArray: pool.heights,
  weightArray: pool.weights,
  globalHeight,
  globalWeight,
  origin,
  texel: new Vector2(SPACING, GLOBAL_STRIDE * SPACING),
  texels: new Vector2(world.size, world.global.size),
  extent: new Vector2(TILE_SIZE, WORLD_SIZE),
  heightRange: new Vector2(def.heightMin, def.heightMax - def.heightMin),
  morph: cdlodMorphRanges(cdlodSettings),
  patchQuads: PATCH,
  weightBlocks: WEIGHT_BLOCKS,
  layers: [
    { texture: grassTex ?? null, color: "#5d7f3a", repeatMetres: 6 },
    { texture: dirtTex ?? null, color: "#7a6146", repeatMetres: 4 },
    { texture: rockTex ?? null, color: "#6f6d6a", repeatMetres: 12 },
    { texture: null, color: "#e9eef3", repeatMetres: 8 },
  ],
});

function createPatchGeometry(quads: number): {
  geometry: InstancedBufferGeometry;
  nodeA: InstancedBufferAttribute;
  nodeB: InstancedBufferAttribute;
} {
  const side = quads + 1;
  const positions = new Float32Array(side * side * 3);
  for (let z = 0; z < side; z += 1) {
    for (let x = 0; x < side; x += 1) {
      const i = (z * side + x) * 3;
      positions[i] = x / quads;
      positions[i + 2] = z / quads;
    }
  }
  // Same b–c diagonal as the Landscape mesh, the Rapier heightfield and terrainHeightAt.
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
  const nodeA = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4);
  const nodeB = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4);
  nodeA.setUsage(DynamicDrawUsage);
  nodeB.setUsage(DynamicDrawUsage);
  geometry.setAttribute("terrainNodeA", nodeA);
  geometry.setAttribute("terrainNodeB", nodeB);
  geometry.instanceCount = 0;
  geometry.boundingSphere = new Sphere(new Vector3(), 1e7);
  return { geometry, nodeA, nodeB };
}

const patch = createPatchGeometry(PATCH);
const terrainMesh = new Mesh(patch.geometry, terrain.material);
terrainMesh.frustumCulled = false;
terrainMesh.receiveShadow = true;
terrainMesh.castShadow = true;
terrainMesh.customDepthMaterial = terrain.depthMaterial;

// --- scene ------------------------------------------------------------------------------

const scene = new Scene();
const sky = new Color("#9cc3e6");
scene.background = sky;
const fog = new Fog(sky, 1400, 5800);
const crackColor = new Color("#ff00ff");
scene.fog = fog;
scene.add(terrainMesh);
scene.add(new HemisphereLight("#cfe3ff", "#5a5040", 0.7));

const sun = new DirectionalLight("#fff4e0", 2.6);
const sunDir = new Vector3(-0.55, 0.62, 0.35).normalize();
sun.castShadow = SHADOW_MAP > 0;
if (SHADOW_MAP > 0) {
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  const cam = sun.shadow.camera;
  cam.left = -SHADOW_EXTENT;
  cam.right = SHADOW_EXTENT;
  cam.top = SHADOW_EXTENT;
  cam.bottom = -SHADOW_EXTENT;
  cam.near = 1;
  cam.far = 4000;
  sun.shadow.bias = -0.0004;
}
scene.add(sun, sun.target);

const camera = new PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 6000);
scene.add(camera);

function groundAt(x: number, z: number): number {
  return terrainHeightAt(def, world.lookup, x, z) ?? 0;
}

// Spawn on the flat valley floor nearest the world centre, so the shadow test
// props below have open ground to cast on.
function findFlatSpawn(): Vector3 {
  let best = new Vector3(0, 0, 0);
  let bestDistance = Number.POSITIVE_INFINITY;
  const limit = WORLD_SIZE / 2 - 300;
  for (let z = -limit; z <= limit; z += 48) {
    for (let x = -limit; x <= limit; x += 48) {
      const distance = Math.hypot(x, z);
      if (distance >= bestDistance) continue;
      const h = groundAt(x, z);
      let flat = h < 120;
      for (let i = 0; flat && i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2;
        flat = Math.abs(groundAt(x + Math.cos(angle) * 70, z + Math.sin(angle) * 70) - h) < 6;
      }
      if (flat) {
        best = new Vector3(x, 0, z);
        bestDistance = distance;
      }
    }
  }
  return best;
}

// Shadow test props sitting on the exact (triangle-true) surface.
const spawn = findFlatSpawn();
{
  const count = 60;
  const props = new InstancedMesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial({ color: "#b8875a" }), count);
  props.castShadow = true;
  props.receiveShadow = true;
  const dummy = new Object3D();
  let seed = 7;
  const rand = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i += 1) {
    const x = spawn.x + (rand() - 0.5) * 120;
    const z = spawn.z + (rand() - 0.5) * 120;
    const s = 1 + rand() * 3;
    dummy.position.set(x, groundAt(x, z) + s, z);
    dummy.scale.set(s, s * (1 + rand() * 2), s);
    dummy.position.y = groundAt(x, z) + dummy.scale.y;
    dummy.updateMatrix();
    props.setMatrixAt(i, dummy.matrix);
  }
  scene.add(props);
}

// --- residency -------------------------------------------------------------------------

const uploadLog: SlotUploadTiming[] = [];
let uploadQueue: number[] = [];
let residencyAnchor = new Vector2(Number.NaN, Number.NaN);

function tileBoxDistance(tile: number, x: number, z: number): number {
  const tx = tile % TILES;
  const tz = Math.floor(tile / TILES);
  const minX = tx * TILE_SIZE;
  const minZ = tz * TILE_SIZE;
  const dx = Math.max(minX - x, 0, x - (minX + TILE_SIZE));
  const dz = Math.max(minZ - z, 0, z - (minZ + TILE_SIZE));
  return Math.hypot(dx, dz);
}

function updateResidency(localX: number, localZ: number): void {
  if (Math.hypot(localX - residencyAnchor.x, localZ - residencyAnchor.y) < 32) return;
  residencyAnchor = new Vector2(localX, localZ);
  const all = Array.from({ length: TILES * TILES }, (_, i) => i);
  all.sort((a, b) => tileBoxDistance(a, localX, localZ) - tileBoxDistance(b, localX, localZ));
  const desired = new Set(all.slice(0, SLOTS));
  for (const tile of Array.from(pool.residentTiles())) {
    if (!desired.has(tile)) pool.release(tile);
  }
  uploadQueue = all.slice(0, SLOTS).filter((tile) => pool.slot(tile) < 0);
}

function uploadTile(tile: number): SlotUploadTiming | null {
  const bytes = world.encoded[tile]!;
  const timing = pool.upload(
    renderer,
    tile,
    encodedTileHeights(bytes, world.size),
    encodedTileWeights(bytes, world.size, WEIGHT_BLOCKS),
  );
  if (timing) uploadLog.push(timing);
  return timing;
}

function pumpUploads(limit: number): void {
  for (let n = 0; n < limit && uploadQueue.length > 0; n += 1) uploadTile(uploadQueue.shift()!);
}

/** S3: evicts every resident tile and uploads them all again inside one frame. */
function runUploadStress(): void {
  const tiles = Array.from(pool.residentTiles());
  for (const tile of tiles) pool.release(tile);
  const timings: SlotUploadTiming[] = [];
  const t0 = performance.now();
  for (const tile of tiles) {
    const timing = uploadTile(tile);
    if (timing) timings.push(timing);
  }
  const totalMs = performance.now() - t0;
  const perTile = stats(timings.map((t) => t.copyMs + t.uploadMs));
  const copy = stats(timings.map((t) => t.copyMs));
  const upload = stats(timings.map((t) => t.uploadMs));
  const bytesPerTile = world.size ** 2 * (heightBytesPerTexel(heightFormat) + 4 * WEIGHT_BLOCKS);
  report.value = [
    `Forge S3 tile upload stress — ${new Date().toISOString()}`,
    `GPU: ${gpuName}`,
    `UA: ${navigator.userAgent}`,
    `Tile ${world.size}², height ${heightFormat}, ${LAYERS} layers (${WEIGHT_BLOCKS} RGBA8 block${WEIGHT_BLOCKS > 1 ? "s" : ""}), ` +
      `${mb(bytesPerTile)} per tile; ${timings.length} tiles in one frame, ${f(totalMs, 1)} ms total`,
    `per tile (main thread) avg ${f(perTile.avg)} p50 ${f(perTile.p50)} p95 ${f(perTile.p95)} max ${f(perTile.max)} ms`,
    `  copy into slot mirror avg ${f(copy.avg)} max ${f(copy.max)} ms; initTexture (texSubImage3D) avg ${f(upload.avg)} p95 ${f(upload.p95)} max ${f(upload.max)} ms`,
  ].join("\n");
  reportPanel.hidden = false;
  console.info(report.value);
}

// --- node selection ----------------------------------------------------------------------

const mainFrustum = new Frustum();
const projScreen = new Matrix4();
const scratchBox = new Box3();
const lodCamera = terrain.uniforms.uTerrainLodCamera!.value as Vector3;
const perLevel = new Array<number>(LEVELS).fill(0);
let instanceCount = 0;
let fallbackNodes = 0;
// Tiles that selected nodes would need resident (finer than the global grid).
const neededTiles = new Set<number>();
let neededTileCount = 0;
// Effective resolution per leaf cell (level, +1 when drawn fully morphed);
// neighbours two or more apart are a T-junction, i.e. a crack.
const LEAF_N = WORLD_SIZE / LEAF;
const leafLevel = new Int8Array(LEAF_N * LEAF_N);
let lodGapEdges = 0;

function countLodGaps(): number {
  let gaps = 0;
  for (let z = 0; z < LEAF_N; z += 1) {
    for (let x = 0; x < LEAF_N; x += 1) {
      const e = leafLevel[z * LEAF_N + x]!;
      if (e < 0) continue;
      if (x + 1 < LEAF_N) {
        const r = leafLevel[z * LEAF_N + x + 1]!;
        if (r >= 0 && Math.abs(r - e) >= 2) gaps += 1;
      }
      if (z + 1 < LEAF_N) {
        const d = leafLevel[(z + 1) * LEAF_N + x]!;
        if (d >= 0 && Math.abs(d - e) >= 2) gaps += 1;
      }
    }
  }
  return gaps;
}

function visible(box: CdlodBox): boolean {
  scratchBox.min.set(box.minX + origin.x, box.minY, box.minZ + origin.z);
  scratchBox.max.set(box.maxX + origin.x, box.maxY, box.maxZ + origin.z);
  if (mainFrustum.intersectsBox(scratchBox)) return true;
  return sun.castShadow && sun.shadow.getFrustum().intersectsBox(scratchBox);
}

function emit(visit: CdlodVisit): void {
  if (instanceCount >= MAX_INSTANCES) return;
  const size = LEAF * 2 ** visit.level;
  const a = patch.nodeA.array as Float32Array;
  const b = patch.nodeB.array as Float32Array;
  const o = instanceCount * 4;
  let slot = -1;
  let baseX = 0;
  let baseZ = 0;
  if (visit.level <= TILE_LEVEL) {
    const tx = Math.floor(visit.box.minX / TILE_SIZE);
    const tz = Math.floor(visit.box.minZ / TILE_SIZE);
    slot = pool.slot(tz * TILES + tx);
    if (visit.level < TILE_LEVEL || visit.inRange) neededTiles.add(tz * TILES + tx);
    if (slot >= 0) {
      baseX = tx * TILE_SIZE;
      baseZ = tz * TILE_SIZE;
    } else if (visit.level < TILE_LEVEL || visit.inRange) {
      // Finer than the global grid without its tile: may crack against neighbours.
      fallbackNodes += 1;
    }
  }
  a[o] = visit.box.minX - baseX;
  a[o + 1] = visit.box.minZ - baseZ;
  a[o + 2] = size;
  a[o + 3] = visit.level;
  b[o] = slot;
  b[o + 1] = baseX;
  b[o + 2] = baseZ;
  b[o + 3] = 0;
  perLevel[visit.level] = (perLevel[visit.level] ?? 0) + 1;
  instanceCount += 1;
  const cells = 2 ** visit.level;
  const effective = visit.level + (visit.inRange ? 0 : 1);
  for (let z = visit.iz * cells; z < (visit.iz + 1) * cells; z += 1) {
    leafLevel.fill(effective, z * LEAF_N + visit.ix * cells, z * LEAF_N + (visit.ix + 1) * cells);
  }
}

function selectNodes(): number {
  const t0 = performance.now();
  camera.updateMatrixWorld();
  projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  mainFrustum.setFromProjectionMatrix(projScreen);
  if (sun.castShadow) {
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    sun.shadow.updateMatrices(sun);
  }
  instanceCount = 0;
  fallbackNodes = 0;
  perLevel.fill(0);
  neededTiles.clear();
  leafLevel.fill(-1);
  selector.select(camera.position.x - origin.x, camera.position.y, camera.position.z - origin.z, visible, emit);
  neededTileCount = neededTiles.size;
  lodGapEdges = countLodGaps();
  patch.geometry.instanceCount = instanceCount;
  for (const attribute of [patch.nodeA, patch.nodeB]) {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, instanceCount * 4);
    attribute.needsUpdate = true;
  }
  lodCamera.copy(camera.position);
  return performance.now() - t0;
}

// --- camera control ------------------------------------------------------------------------

const keys = new Set<string>();
let yaw = 0;
let pitch = 0;
let baseSpeed = 40;
let walking = false;
let frozen = false;
let dragging = false;

addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLTextAreaElement) return;
  keys.add(event.code);
  switch (event.code) {
    case "KeyB": if (!bench) startBench(); break;
    case "KeyU": if (!bench) runUploadStress(); break;
    case "KeyF": frozen = !frozen; break;
    case "KeyG": walking = !walking; break;
    case "KeyV": terrain.material.wireframe = !terrain.material.wireframe; break;
    case "KeyC": {
      const debug = terrain.uniforms.uTerrainDebug!;
      debug.value = ((debug.value as number) + 1) % 3;
      // Debug views: magenta background and no fog, so any crack shows as magenta.
      scene.background = debug.value === 0 ? sky : crackColor;
      scene.fog = debug.value === 0 ? fog : null;
      break;
    }
    case "KeyT": terrainMesh.visible = !terrainMesh.visible; break;
    case "KeyK": sun.castShadow = SHADOW_MAP > 0 && !sun.castShadow; break;
    default: break;
  }
});
addEventListener("keyup", (event) => keys.delete(event.code));
canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointerup", () => (dragging = false));
canvas.addEventListener("pointermove", (event) => {
  if (!dragging || bench) return;
  yaw -= event.movementX * 0.003;
  pitch = Math.min(1.5, Math.max(-1.5, pitch - event.movementY * 0.003));
});
canvas.addEventListener("wheel", (event) => {
  baseSpeed = Math.min(2000, Math.max(2, baseSpeed * (event.deltaY < 0 ? 1.25 : 0.8)));
});
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const euler = new Euler(0, 0, 0, "YXZ");
const forward = new Vector3();
const right = new Vector3();

function updateControls(dt: number): void {
  euler.set(pitch, yaw, 0);
  camera.quaternion.setFromEuler(euler);
  forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  if (walking) {
    forward.y = 0;
    forward.normalize();
  }
  const speed = (walking ? 6 : baseSpeed) * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 5 : 1);
  const move = new Vector3();
  if (keys.has("KeyW")) move.add(forward);
  if (keys.has("KeyS")) move.sub(forward);
  if (keys.has("KeyD")) move.add(right);
  if (keys.has("KeyA")) move.sub(right);
  if (!walking && keys.has("KeyE")) move.y += 1;
  if (!walking && keys.has("KeyQ")) move.y -= 1;
  if (move.lengthSq() > 0) camera.position.addScaledVector(move.normalize(), speed * dt);
  const half = WORLD_SIZE / 2 - 1;
  camera.position.x = Math.min(half, Math.max(-half, camera.position.x));
  camera.position.z = Math.min(half, Math.max(-half, camera.position.z));
  const ground = groundAt(camera.position.x, camera.position.z);
  camera.position.y = walking ? ground + 1.8 : Math.max(camera.position.y, ground + 1.5);
}

function updateSun(): void {
  // Follow the camera, snapped to shadow texels to limit shimmering.
  const texel = (2 * SHADOW_EXTENT) / Math.max(1, SHADOW_MAP);
  const tx = Math.round(camera.position.x / texel) * texel;
  const tz = Math.round(camera.position.z / texel) * texel;
  const ty = groundAt(tx, tz);
  sun.target.position.set(tx, ty, tz);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 1500);
}

// --- benchmark --------------------------------------------------------------------------

interface BenchPhase {
  name: string;
  seconds: number;
  pose: (t: number) => { x: number; z: number; y: number; yaw: number; pitch: number };
}

function along(ax: number, az: number, bx: number, bz: number, t: number): { x: number; z: number; yaw: number } {
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, yaw: Math.atan2(-(bx - ax), -(bz - az)) };
}

const half = WORLD_SIZE / 2;
const PHASES: BenchPhase[] = [
  {
    name: "low flight (25 m AGL, ~300 m/s)",
    seconds: 12,
    pose: (t) => {
      const p = along(-0.75 * half, -0.6 * half, 0.75 * half, 0.45 * half, t);
      return { ...p, y: groundAt(p.x, p.z) + 25, pitch: -0.1 };
    },
  },
  {
    name: "high orbit (450 m, r = 0.45 world)",
    seconds: 10,
    pose: (t) => {
      const angle = t * Math.PI * 1.5;
      const r = 0.45 * half;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      return { x, z, y: Math.max(450, groundAt(x, z) + 60), yaw: -angle + Math.PI, pitch: -0.32 };
    },
  },
  {
    name: "ground run (2 m AGL, ~100 km/h)",
    seconds: 8,
    pose: (t) => {
      const p = along(spawn.x, spawn.z, spawn.x + 160, spawn.z - 160, t);
      return { ...p, y: groundAt(p.x, p.z) + 2, pitch: -0.05 };
    },
  },
  {
    name: "baseline: terrain hidden",
    seconds: 3,
    pose: () => {
      const x = spawn.x + 160;
      const z = spawn.z - 160;
      return { x, z, y: groundAt(x, z) + 2, yaw: Math.atan2(-160, 160), pitch: -0.05 };
    },
  },
];

interface PhaseSamples {
  frameMs: number[];
  gpuMs: number[];
  nodes: number[];
  triangles: number[];
  calls: number[];
  fallback: number[];
  gaps: number[];
  needed: number[];
  selectMs: number[];
}

interface BenchState {
  phase: number;
  phaseStart: number;
  samples: PhaseSamples[];
  uploadsBefore: number;
  warmup: number;
}

let bench: BenchState | null = null;
// Kept after the run ends so late GPU results still land; the report waits for them.
let lastBenchSamples: PhaseSamples[] | null = null;

function emptySamples(): PhaseSamples {
  return { frameMs: [], gpuMs: [], nodes: [], triangles: [], calls: [], fallback: [], gaps: [], needed: [], selectMs: [] };
}

function startBench(): void {
  reportPanel.hidden = true;
  bench = { phase: 0, phaseStart: performance.now(), samples: PHASES.map(emptySamples), uploadsBefore: uploadLog.length, warmup: 30 };
  lastBenchSamples = bench.samples;
  walking = false;
  frozen = false;
}

function stepBench(now: number): void {
  if (!bench) return;
  const phase = PHASES[bench.phase]!;
  const t = Math.min(1, (now - bench.phaseStart) / (phase.seconds * 1000));
  const pose = phase.pose(t);
  camera.position.set(pose.x, pose.y, pose.z);
  euler.set(pose.pitch, pose.yaw, 0);
  camera.quaternion.setFromEuler(euler);
  terrainMesh.visible = phase.name.startsWith("baseline") ? false : true;
  if (t >= 1) {
    bench.phase += 1;
    bench.phaseStart = now;
    if (bench.phase >= PHASES.length) {
      const done = bench;
      bench = null;
      // Terrain stays hidden until the report: this frame still counts as baseline.
      // Give in-flight GPU timer queries a few frames to resolve.
      setTimeout(() => finishBench(done), 250);
    }
  }
}

function stats(values: number[]): { avg: number; p50: number; p95: number; max: number } {
  if (values.length === 0) return { avg: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return { avg: values.reduce((s, v) => s + v, 0) / values.length, p50: pick(0.5), p95: pick(0.95), max: sorted[sorted.length - 1]! };
}

const f = (value: number, digits = 2): string => value.toFixed(digits);
const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`;

function finishBench(done: BenchState): void {
  terrainMesh.visible = true;
  const lines: string[] = [];
  lines.push(`Forge S1 GPU CDLOD spike — ${new Date().toISOString()}`);
  lines.push(`GPU: ${gpuName}`);
  lines.push(`UA: ${navigator.userAgent}`);
  lines.push(
    `Canvas: ${canvas.width}×${canvas.height} (dpr ${f(DPR, 2)}), height ${heightFormat}, slots ${SLOTS}, patch ${PATCH}, ` +
      `range0 ${RANGE0} m, levels ${LEVELS}, shadow ${SHADOW_MAP > 0 ? `${SHADOW_MAP}² ±${SHADOW_EXTENT} m` : "off"}`,
  );
  lines.push(
    `World: ${TILES}×${TILES} tiles × ${TILE_SIZE} m = ${WORLD_SIZE} m; generate ${f(world.stats.generateMs / 1000, 1)} s, ` +
      `encode ${f(world.stats.encodeMs, 0)} ms, ${mb(world.stats.encodedBytes)} encoded`,
  );
  lines.push(gpuTimer ? "GPU ms = whole frame (terrain colour + shadow pass + 60 boxes), EXT_disjoint_timer_query" : "GPU timer: unavailable in this browser");
  const baselineGpu = stats(done.samples[PHASES.length - 1]!.gpuMs).avg;
  for (let i = 0; i < PHASES.length; i += 1) {
    const s = done.samples[i]!;
    const frame = stats(s.frameMs);
    const gpu = stats(s.gpuMs);
    const isBaseline = i === PHASES.length - 1;
    lines.push(
      `— ${PHASES[i]!.name}: ${s.frameMs.length} frames` +
        (gpuTimer && !isBaseline ? ` → terrain GPU ≈ ${f(gpu.avg - baselineGpu)} ms avg, ${f(gpu.p95 - baselineGpu)} ms p95` : ""),
    );
    lines.push(`  frame ms avg ${f(frame.avg)} p50 ${f(frame.p50)} p95 ${f(frame.p95)} max ${f(frame.max)}`);
    if (gpuTimer) lines.push(`  GPU ms   avg ${f(gpu.avg)} p50 ${f(gpu.p50)} p95 ${f(gpu.p95)} max ${f(gpu.max)} (${s.gpuMs.length} samples)`);
    lines.push(
      `  nodes avg ${f(stats(s.nodes).avg, 0)} max ${stats(s.nodes).max}, triangles max ${(stats(s.triangles).max / 1e6).toFixed(2)} M, ` +
        `draw calls max ${stats(s.calls).max}, select ms avg ${f(stats(s.selectMs).avg)}, crack-risk nodes max ${stats(s.fallback).max}, LOD-gap edges max ${stats(s.gaps).max}, ` +
        `tiles needed max ${stats(s.needed).max}/${SLOTS}`,
    );
  }
  const uploads = uploadLog.slice(done.uploadsBefore);
  const copy = stats(uploads.map((u) => u.copyMs));
  const upload = stats(uploads.map((u) => u.uploadMs));
  lines.push(
    `Tile uploads during run (S3): ${uploads.length}; copy ms avg ${f(copy.avg)} max ${f(copy.max)}; ` +
      `GPU upload ms avg ${f(upload.avg)} p95 ${f(upload.p95)} max ${f(upload.max)}`,
  );
  const lookup = world.lookup;
  lines.push(`CPU tile decode (query path): ${lookup.decodeCount} decodes, avg ${f(lookup.decodeCount ? lookup.decodeTotalMs / lookup.decodeCount : 0)} ms`);
  lines.push(...memoryLines());
  report.value = lines.join("\n");
  reportPanel.hidden = false;
  console.info(report.value);
}

function recordBench(phase: number, frameMs: number, selectMs: number): void {
  if (bench && bench.warmup > 0) {
    bench.warmup -= 1;
    bench.phaseStart = performance.now();
    return;
  }
  const s = lastBenchSamples?.[phase];
  if (!s) return;
  s.frameMs.push(frameMs);
  s.nodes.push(instanceCount);
  s.triangles.push(renderer.info.render.triangles);
  s.calls.push(renderer.info.render.calls);
  s.fallback.push(fallbackNodes);
  s.gaps.push(lodGapEdges);
  s.needed.push(neededTileCount);
  s.selectMs.push(selectMs);
}

// --- memory -------------------------------------------------------------------------------

function memoryLines(): string[] {
  const poolBytes = pool.gpuBytes();
  const globalBytes = world.global.size ** 2 * (heightBytesPerTexel(heightFormat) + 4);
  const layerBytes = [grassTex, dirtTex, rockTex].reduce((sum, texture) => {
    const image = texture?.image as { width?: number; height?: number } | undefined;
    return sum + (image?.width ?? 0) * (image?.height ?? 0) * 4 * (4 / 3);
  }, 0);
  const geometryBytes = (PATCH + 1) ** 2 * 12 + PATCH * PATCH * 6 * 2 + MAX_INSTANCES * 32;
  const terrainTotal = poolBytes.heights + poolBytes.weights + globalBytes + layerBytes + geometryBytes;
  const shadowBytes = SHADOW_MAP > 0 ? SHADOW_MAP * SHADOW_MAP * 4 : 0;
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  return [
    `GPU memory (estimate): terrain ${mb(terrainTotal)} = height slots ${mb(poolBytes.heights)} + weight slots ${mb(poolBytes.weights)} ` +
      `+ global maps ${mb(globalBytes)} + layer textures ${mb(layerBytes)} + patch/instances ${mb(geometryBytes)}; shadow map ${mb(shadowBytes)}`,
    `renderer.info: ${renderer.info.memory.textures} textures, ${renderer.info.memory.geometries} geometries, ${renderer.info.programs?.length ?? 0} programs` +
      (heap ? `; JS heap ${mb(heap)} (encoded tiles ${mb(world.stats.encodedBytes)})` : ""),
  ];
}

// --- frame loop -----------------------------------------------------------------------------

status.textContent = "Uploading initial tiles…";
{
  const pose = (params.get("pose") ?? "").split(",").map(Number);
  if (pose.length === 5 && pose.every(Number.isFinite)) {
    const [x, agl, z, poseYaw, posePitch] = pose as [number, number, number, number, number];
    camera.position.set(x, groundAt(x, z) + agl, z);
    yaw = poseYaw;
    pitch = posePitch;
  } else {
    camera.position.set(spawn.x + 70, groundAt(spawn.x + 70, spawn.z + 70) + 25, spawn.z + 70);
    yaw = Math.PI / 4;
    pitch = -0.3;
  }
}
updateResidency(camera.position.x - origin.x, camera.position.z - origin.z);
const bootUploadStart = performance.now();
pumpUploads(SLOTS);
const bootUploadMs = performance.now() - bootUploadStart;
status.hidden = true;

let last = performance.now();
let frameMsAvg = 16;
let selectMsLast = 0;
let hudTimer = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const frameMs = now - last;
  last = now;
  const dt = Math.min(0.1, frameMs / 1000);
  frameMsAvg += (frameMs - frameMsAvg) * 0.05;

  // Captured before stepping: the frame that ends a phase is still rendered with its pose.
  const benchPhase = bench && bench.warmup <= 0 ? bench.phase : -1;
  if (bench) stepBench(now);
  else updateControls(dt);
  updateSun();
  if (!frozen) {
    updateResidency(camera.position.x - origin.x, camera.position.z - origin.z);
    selectMsLast = selectNodes();
  }
  pumpUploads(UPLOADS_PER_FRAME);

  renderer.info.reset();
  // GPU results land frames later; the tag carries the phase they belong to.
  const timed = gpuTimer?.begin(benchPhase + 1) ?? false;
  renderer.render(scene, camera);
  if (timed) gpuTimer?.end();
  for (const sample of gpuTimer?.poll() ?? []) {
    if (sample.tag > 0) lastBenchSamples?.[sample.tag - 1]?.gpuMs.push(sample.ms);
  }
  recordBench(benchPhase, frameMs, selectMsLast);

  hudTimer += frameMs;
  if (hudTimer > 250) {
    hudTimer = 0;
    drawHud();
  }
}

function drawHud(): void {
  const gpu = gpuTimer?.stats();
  const lastUpload = uploadLog[uploadLog.length - 1];
  const uploadStats = stats(uploadLog.map((u) => u.uploadMs));
  const ground = groundAt(camera.position.x, camera.position.z);
  hud.textContent = [
    `S1 GPU CDLOD spike — ${gpuName}`,
    `frame ${f(frameMsAvg)} ms (${f(1000 / Math.max(1, frameMsAvg), 0)} fps)   GPU ${gpu ? `${f(gpu.averageMs)} avg / ${f(gpu.maxMs)} max ms` : "n/a (no timer query)"}`,
    `draw calls ${renderer.info.render.calls}   triangles ${(renderer.info.render.triangles / 1e6).toFixed(2)} M   select ${f(selectMsLast)} ms`,
    `nodes ${instanceCount}  per LOD [${perLevel.join(" ")}]   crack-risk ${fallbackNodes}   LOD gaps ${lodGapEdges}   tiles needed ${neededTileCount}/${SLOTS}`,
    `resident ${pool.resident}/${SLOTS} slots   queue ${uploadQueue.length}   boot upload ${f(bootUploadMs, 0)} ms`,
    `tile upload last ${lastUpload ? f(lastUpload.copyMs + lastUpload.uploadMs) : "-"} ms, avg ${f(uploadStats.avg)} / max ${f(uploadStats.max)} ms (${uploadLog.length})`,
    `height ${heightFormat}${heightFormat === "r16f" ? " (LOSSY)" : ""}, ${LAYERS} layers   ${canvas.width}×${canvas.height} @${f(DPR, 2)}   reversed-depth support ${renderer.capabilities.reversedDepthBuffer ? "yes" : "no"}`,
    ...memoryLines(),
    `cam ${f(camera.position.x, 0)}, ${f(camera.position.y, 1)}, ${f(camera.position.z, 0)}   AGL ${f(camera.position.y - ground, 1)} m   speed ${f(baseSpeed, 0)} m/s`,
    `${walking ? "WALK" : "FLY"}${frozen ? "  FROZEN" : ""}${terrain.material.wireframe ? "  WIRE" : ""}  view ${["lit", "LOD", "residency"][terrain.uniforms.uTerrainDebug!.value as number]}${bench ? `  BENCH ${PHASES[bench.phase]?.name ?? ""}` : ""}`,
    "",
    "drag look · WASD move · Q/E down/up · Shift ×5 · wheel speed",
    "B benchmark · U upload stress (S3) · C view (lit/LOD/residency) · V wireframe · F freeze LOD",
    "G walk · K shadows · T hide terrain",
  ].join("\n");
}

requestAnimationFrame(frame);
