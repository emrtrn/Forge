import {
  AmbientLight,
  BufferAttribute,
  DirectionalLight,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RGBADepthPacking,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Group,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { GltfModelLoader } from "@engine/render-three/gltfModelLoader";
import { createInstancedModelGroup, type InstanceRenderItem } from "@engine/render-three/models";
import { foliageInstanceFromRoll } from "@engine/render-three/foliage";
import { composeTransformMatrix } from "@engine/render-three/transforms";
import { normalizeFoliageType } from "@engine/scene/foliage";
import { makeFoliageRng, passesFoliageFilters, rollFoliageInstance } from "@engine/scene/foliagePaint";
import {
  TerrainTileMap,
  terrainFaceNormalAt,
  terrainHeightAt,
  terrainLayerWeightsAt,
  type TerrainQueryDef,
} from "@engine/terrain/terrainHeightQuery";
import type { TerrainTileData } from "@engine/terrain/terrainTypes";

/**
 * OPEN_WORLD_PLAN Faz 6 / G0 — throwaway, never merged.
 * (a) procedural grass generation cost per 32 m cell, (b) GPU frame cost of a
 * grass ring (50k–300k instances; dither fade and shadows on/off), (c) building
 * and first-drawing one cell batch.
 */

declare global {
  interface Window { __spikeReport?: unknown }
}

const params = new URLSearchParams(location.search);
const DENSITIES = (params.get("densities") ?? "2,4,8").split(",").map(Number);
const RING_COUNTS = (params.get("counts") ?? "50000,150000,300000").split(",").map(Number);
const FRAMES = Number(params.get("frames") ?? 60);
const RING = Number(params.get("ring") ?? 96);
const GRASS_CELL = 32;
const MESH_ID = params.get("mesh") ?? "kenney-grass";

const out = document.getElementById("out") as HTMLPreElement;
const lines: string[] = [];
function log(line: string): void {
  lines.push(line);
  out.textContent = lines.join("\n");
}

interface Stats { avg: number; p95: number; max: number }
function stats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    avg: values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1),
    p95: sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}
const fmt = (s: Stats): string => `avg ${s.avg.toFixed(2)} p95 ${s.p95.toFixed(2)} max ${s.max.toFixed(2)}`;

// --- Synthetic 2×2-tile World Terrain (512 m, 1 m spacing, 2 layers) ----------

const QUADS = 256;
const DEF: TerrainQueryDef = { tileQuads: QUADS, spacing: 1, tilesX: 2, tilesZ: 2, origin: [0, 0, 0] };
const WORLD = QUADS * 2;

function heightField(x: number, z: number): number {
  return 6 * Math.sin(x * 0.021) * Math.cos(z * 0.017) + 2.5 * Math.sin(x * 0.07 + z * 0.05) + 0.6 * Math.sin(x * 0.31) * Math.sin(z * 0.27);
}

/** Grass layer weight: broad patches, ~60% of the surface above 0.5. */
function grassWeight(x: number, z: number): number {
  const v = 0.5 + 0.5 * Math.sin(x * 0.043 + 1.3) * Math.cos(z * 0.037 - 0.4) + 0.15 * Math.sin(x * 0.19 + z * 0.13);
  return Math.min(1, Math.max(0, v + 0.1));
}

function buildTiles(): TerrainTileMap {
  const map = new TerrainTileMap();
  const size = QUADS + 1;
  for (let tz = 0; tz < 2; tz += 1) {
    for (let tx = 0; tx < 2; tx += 1) {
      const heights = new Float32Array(size * size);
      const weights = new Uint8Array(size * size * 4);
      for (let z = 0; z < size; z += 1) {
        for (let x = 0; x < size; x += 1) {
          const wx = tx * QUADS + x;
          const wz = tz * QUADS + z;
          const index = z * size + x;
          heights[index] = heightField(wx, wz);
          const w = Math.round(grassWeight(wx, wz) * 255);
          weights[index * 4] = 255 - w;
          weights[index * 4 + 1] = w;
        }
      }
      const tile: TerrainTileData = { x: tx, z: tz, size, heights, layerCount: 2, weights };
      map.set(tile);
    }
  }
  return map;
}

// --- Generation prototypes ------------------------------------------------------

const TYPE = normalizeFoliageType({
  name: "Grass",
  meshAssetId: MESH_ID,
  scaleMin: [0.8, 0.8, 0.8],
  scaleMax: [1.5, 1.5, 1.5],
  slopeMax: 40,
  alignToNormal: true,
  randomYaw: true,
  castShadow: false,
});
const GRASS_LAYER = 1;
const MIN_WEIGHT = 0.5;

function cellSeed(seed: number, cx: number, cz: number): number {
  let hash = seed >>> 0;
  hash = Math.imul(hash ^ (cx | 0), 0x9e3779b1) >>> 0;
  hash = Math.imul(hash ^ (cz | 0), 0x85ebca77) >>> 0;
  return (hash ^ (hash >>> 15)) >>> 0;
}

/** Through today's helpers: roll → foliageInstanceFromRoll (Euler) → composeTransformMatrix. */
function generateCellHelpers(tiles: TerrainTileMap, cx: number, cz: number, density: number): Matrix4[] {
  const rng = makeFoliageRng(cellSeed(7, cx, cz));
  const perSide = Math.max(1, Math.round(GRASS_CELL * Math.sqrt(density)));
  const step = GRASS_CELL / perSide;
  const matrices: Matrix4[] = [];
  for (let row = 0; row < perSide; row += 1) {
    for (let col = 0; col < perSide; col += 1) {
      const x = cx * GRASS_CELL + (col + rng()) * step;
      const z = cz * GRASS_CELL + (row + rng()) * step;
      const keep = rng();
      void keep;
      const weights = terrainLayerWeightsAt(DEF, tiles, x, z);
      if (!weights || (weights[GRASS_LAYER] ?? 0) + 1e-6 < MIN_WEIGHT) continue;
      const y = terrainHeightAt(DEF, tiles, x, z);
      const normal = terrainFaceNormalAt(DEF, tiles, x, z);
      if (y === null || !normal) continue;
      const hit = { position: [x, y, z] as [number, number, number], normal };
      if (!passesFoliageFilters(TYPE, hit)) continue;
      const instance = foliageInstanceFromRoll(TYPE, rollFoliageInstance(TYPE, hit, rng));
      matrices.push(composeTransformMatrix(instance.position, instance.rotation, instance.scale));
    }
  }
  return matrices;
}

const UP = new Vector3(0, 1, 0);
const tmpUp = new Vector3();
const tmpAlign = new Quaternion();
const tmpYaw = new Quaternion();
const tmpPos = new Vector3();
const tmpScale = new Vector3();
const tmpMatrix = new Matrix4();

/** Direct path: quaternion straight into a packed Float32Array (no Euler, no per-instance objects). */
function generateCellDirect(tiles: TerrainTileMap, cx: number, cz: number, density: number, target: Float32Array): number {
  const rng = makeFoliageRng(cellSeed(7, cx, cz));
  const perSide = Math.max(1, Math.round(GRASS_CELL * Math.sqrt(density)));
  const step = GRASS_CELL / perSide;
  let count = 0;
  for (let row = 0; row < perSide; row += 1) {
    for (let col = 0; col < perSide; col += 1) {
      const x = cx * GRASS_CELL + (col + rng()) * step;
      const z = cz * GRASS_CELL + (row + rng()) * step;
      rng();
      const weights = terrainLayerWeightsAt(DEF, tiles, x, z);
      if (!weights || (weights[GRASS_LAYER] ?? 0) + 1e-6 < MIN_WEIGHT) continue;
      const y = terrainHeightAt(DEF, tiles, x, z);
      const normal = terrainFaceNormalAt(DEF, tiles, x, z);
      if (y === null || !normal) continue;
      const slope = Math.acos(Math.min(1, Math.max(-1, normal[1]))) * MathUtils.RAD2DEG;
      if (slope > TYPE.slopeMax) continue;
      const scale = TYPE.scaleMin[0] + (TYPE.scaleMax[0] - TYPE.scaleMin[0]) * rng();
      const yaw = rng() * Math.PI * 2;
      tmpUp.set(normal[0], normal[1], normal[2]);
      tmpAlign.setFromUnitVectors(UP, tmpUp);
      tmpYaw.setFromAxisAngle(UP, yaw);
      tmpAlign.multiply(tmpYaw);
      tmpMatrix.compose(tmpPos.set(x, y, z), tmpAlign, tmpScale.set(scale, scale, scale));
      if ((count + 1) * 16 > target.length) return count;
      tmpMatrix.toArray(target, count * 16);
      count += 1;
    }
  }
  return count;
}

// --- Dither fade prototype (F1) --------------------------------------------------

const fadeUniforms = {
  uFadeOrigin: { value: new Vector3() },
  uFadeRange: { value: new Vector2(RING * 0.65, RING) },
};

function injectFade(shader: WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, fadeUniforms);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nuniform vec3 uFadeOrigin;\nvarying float vFadeDist;")
    .replace(
      "#include <project_vertex>",
      [
        "#include <project_vertex>",
        "#ifdef USE_INSTANCING",
        "  vec3 fadeCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;",
        "#else",
        "  vec3 fadeCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;",
        "#endif",
        "  vFadeDist = distance(fadeCenter, uFadeOrigin);",
      ].join("\n"),
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      [
        "#include <common>",
        "uniform vec2 uFadeRange;",
        "varying float vFadeDist;",
        "float fadeBayer4(vec2 p) {",
        "  ivec2 i = ivec2(mod(p, 4.0));",
        "  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);",
        "  return (m[i.x + i.y * 4] + 0.5) / 16.0;",
        "}",
      ].join("\n"),
    )
    .replace(
      "void main() {",
      "void main() {\n  if (1.0 - smoothstep(uFadeRange.x, uFadeRange.y, vFadeDist) < fadeBayer4(gl_FragCoord.xy)) discard;",
    );
}

function fadeMaterial(source: Material): Material {
  const material = source.clone();
  material.onBeforeCompile = injectFade;
  material.customProgramCacheKey = () => "forge-foliage-fade";
  return material;
}

function fadeDepthMaterial(): MeshDepthMaterial {
  const material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  material.onBeforeCompile = injectFade;
  material.customProgramCacheKey = () => "forge-foliage-fade-depth";
  return material;
}

// --- Main -------------------------------------------------------------------------

async function main(): Promise<void> {
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  const renderer = new WebGLRenderer({ canvas, antialias: false });
  renderer.shadowMap.enabled = true;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 0.5));
  const tiles = buildTiles();
  const center = new Vector3(WORLD / 2, 0, WORLD / 2);
  center.y = terrainHeightAt(DEF, tiles, center.x, center.z) ?? 0;
  const sun = new DirectionalLight(0xffffff, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -RING; shadowCamera.right = RING; shadowCamera.top = RING; shadowCamera.bottom = -RING;
  shadowCamera.near = 1; shadowCamera.far = 400;
  sun.position.set(center.x + 80, center.y + 150, center.z + 40);
  sun.target.position.copy(center);
  scene.add(sun, sun.target);

  // Visible ground (CPU mesh from the same heights) so the frame has a realistic floor.
  const groundGeometry = new PlaneGeometry(WORLD, WORLD, 256, 256);
  groundGeometry.rotateX(-Math.PI / 2);
  groundGeometry.translate(WORLD / 2, 0, WORLD / 2);
  const positions = groundGeometry.getAttribute("position") as BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(index, terrainHeightAt(DEF, tiles, positions.getX(index), positions.getZ(index)) ?? 0);
  }
  groundGeometry.computeVertexNormals();
  const ground = new Mesh(groundGeometry, new MeshStandardMaterial({ color: 0x557744 }));
  ground.receiveShadow = true;
  scene.add(ground);

  // Third-person eye: 1.7 m above ground, looking along +X slightly down.
  const camera = new PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 2000);
  camera.position.set(center.x - 4, center.y + 2.6, center.z);
  camera.lookAt(center.x + 30, center.y, center.z);
  fadeUniforms.uFadeOrigin.value.copy(camera.position);

  const manifest = await (await fetch("/assets/manifest.json")).json() as { assets: { id: string; path: string }[] };
  const entry = manifest.assets.find((asset) => asset.id === MESH_ID);
  if (!entry) throw new Error(`mesh ${MESH_ID} not in manifest`);
  const loader = new GltfModelLoader(renderer);
  const gltf: GLTF = await loader.load(MESH_ID, `/${entry.path}`);
  let trianglesPerInstance = 0;
  gltf.scene.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh) trianglesPerInstance += (mesh.geometry.getIndex()?.count ?? 0) / 3;
  });
  log(`mesh ${MESH_ID}: ${trianglesPerInstance} tris/instance; timer query ${timer ? "yes" : "no"}`);
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  log(`gpu: ${String(gl.getParameter(debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER))}`);

  const report: Record<string, unknown> = { status: "running", mesh: MESH_ID, trianglesPerInstance, ring: RING };
  const pixel = new Uint8Array(4);
  const drawAndSync = () => {
    renderer.render(scene, camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  };

  // (a) Generation per 32 m cell.
  log(`\n== (a) generation per ${GRASS_CELL} m cell (min weight ${MIN_WEIGHT}, slope <= ${TYPE.slopeMax}), ms`);
  const generation: unknown[] = [];
  const scratch = new Float32Array(GRASS_CELL * GRASS_CELL * 16 * 16);
  for (const density of DENSITIES) {
    const helpers: number[] = [];
    const direct: number[] = [];
    let accepted = 0;
    let candidates = 0;
    for (let index = 0; index < 24; index += 1) {
      const cx = 2 + (index % 6) * 2;
      const cz = 2 + Math.floor(index / 6) * 3;
      let t = performance.now();
      const matrices = generateCellHelpers(tiles, cx, cz, density);
      const helperMs = performance.now() - t;
      t = performance.now();
      const count = generateCellDirect(tiles, cx, cz, density, scratch);
      const directMs = performance.now() - t;
      if (index < 4) continue; // warm-up (JIT)
      helpers.push(helperMs);
      direct.push(directMs);
      accepted += count;
      candidates += Math.round(GRASS_CELL * Math.sqrt(density)) ** 2;
      // Counts differ by a few: the helper roll draws six numbers per instance and the
      // direct path two, so their jitter streams diverge after the first instance.
      void matrices;
    }
    const perCell = accepted / helpers.length;
    const row = { density, candidatesPerCell: candidates / helpers.length, acceptedPerCell: perCell, helpers: stats(helpers), direct: stats(direct) };
    generation.push(row);
    log(`density ${density}/m²: ${row.candidatesPerCell.toFixed(0)} candidates, ${perCell.toFixed(0)} accepted per cell`);
    log(`  helpers ${fmt(row.helpers)}  (${((row.helpers.avg * 1000) / perCell).toFixed(2)} µs/instance)`);
    log(`  direct  ${fmt(row.direct)}  (${((row.direct.avg * 1000) / perCell).toFixed(2)} µs/instance)`);
  }
  report.generation = generation;

  // (b) Ring GPU cost.
  log(`\n== (b) ring of radius ${RING} m around the camera, ${FRAMES} frames each, ms (wall = render + readPixels)`);
  const sourceMeshes: Mesh[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    if ((object as Mesh).isMesh) sourceMeshes.push(object as Mesh);
  });
  const random = makeFoliageRng(99);
  const queries: WebGLQuery[] = [];
  const gpuSamples: number[] = [];
  const pollQueries = () => {
    if (!timer) return;
    while (queries.length > 0) {
      const query = queries[0]!;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      queries.shift();
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpuSamples.push(Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6);
      gl.deleteQuery(query);
    }
  };
  const measure = async (label: string): Promise<Record<string, unknown>> => {
    for (let index = 0; index < 10; index += 1) drawAndSync();
    const wall: number[] = [];
    gpuSamples.length = 0;
    for (let index = 0; index < FRAMES; index += 1) {
      let query: WebGLQuery | null = null;
      if (timer) {
        query = gl.createQuery();
        gl.beginQuery(timer.TIME_ELAPSED_EXT, query!);
      }
      const t = performance.now();
      renderer.render(scene, camera);
      if (timer && query) {
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        queries.push(query);
      }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      wall.push(performance.now() - t);
      pollQueries();
      if (index % 10 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    pollQueries();
    const info = renderer.info.render;
    const row = { label, wall: stats(wall), gpu: gpuSamples.length ? stats(gpuSamples) : null, calls: info.calls, triangles: info.triangles };
    log(`${label.padEnd(34)} wall ${fmt(row.wall)}${row.gpu ? ` | gpu ${fmt(row.gpu)}` : ""} | calls ${info.calls} tris ${(info.triangles / 1e6).toFixed(2)}M`);
    return row;
  };

  const ringRows: unknown[] = [];
  ringRows.push(await measure("baseline (ground only)"));
  for (const count of RING_COUNTS) {
    // Place instances uniformly in the disc, then bucket into 32 m cells (one batch per cell).
    const buckets = new Map<string, number[]>();
    const matrices = new Float32Array(count * 16);
    for (let index = 0; index < count; index += 1) {
      const radius = RING * Math.sqrt(random());
      const angle = random() * Math.PI * 2;
      const x = camera.position.x + Math.cos(angle) * radius;
      const z = camera.position.z + Math.sin(angle) * radius;
      const y = terrainHeightAt(DEF, tiles, x, z) ?? 0;
      const normal = terrainFaceNormalAt(DEF, tiles, x, z) ?? [0, 1, 0];
      tmpAlign.setFromUnitVectors(UP, tmpUp.set(normal[0], normal[1], normal[2]));
      tmpAlign.multiply(tmpYaw.setFromAxisAngle(UP, random() * Math.PI * 2));
      const scale = 0.8 + random() * 0.7;
      tmpMatrix.compose(tmpPos.set(x, y, z), tmpAlign, tmpScale.set(scale, scale, scale)).toArray(matrices, index * 16);
      const key = `${Math.floor(x / GRASS_CELL)}_${Math.floor(z / GRASS_CELL)}`;
      const list = buckets.get(key) ?? [];
      list.push(index);
      buckets.set(key, list);
    }
    const batches: InstancedMesh[] = [];
    const sourceMatrix = new Matrix4();
    const instanceMatrix = new Matrix4();
    for (const indices of buckets.values()) {
      for (const source of sourceMeshes) {
        const mesh = new InstancedMesh(source.geometry, source.material, indices.length);
        sourceMatrix.copy(source.matrixWorld);
        indices.forEach((instanceIndex, slot) => {
          instanceMatrix.fromArray(matrices, instanceIndex * 16).multiply(sourceMatrix);
          mesh.setMatrixAt(slot, instanceMatrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = true;
        mesh.computeBoundingSphere();
        batches.push(mesh);
        scene.add(mesh);
      }
    }
    const originals = batches.map((mesh) => mesh.material as Material);
    const fades = new Map<Material, Material>();
    const fadeOf = (material: Material) => {
      let fade = fades.get(material);
      if (!fade) fades.set(material, (fade = fadeMaterial(material)));
      return fade;
    };
    const depth = fadeDepthMaterial();
    const variant = async (fade: boolean, shadow: boolean) => {
      batches.forEach((mesh, index) => {
        mesh.material = fade ? fadeOf(originals[index]!) : originals[index]!;
        mesh.customDepthMaterial = fade ? depth : undefined;
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
      });
      return measure(`${(count / 1000).toFixed(0)}k, ${batches.length} batches, fade ${fade ? "on " : "off"}, shadow ${shadow ? "on " : "off"}`);
    };
    for (const [fade, shadow] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      ringRows.push({ count, batches: batches.length, fade, shadow, ...(await variant(fade, shadow)) });
    }
    for (const mesh of batches) {
      scene.remove(mesh);
      mesh.dispose();
    }
    for (const fade of fades.values()) fade.dispose();
    depth.dispose();
  }
  report.ring = ringRows;

  // (c) Building and first-drawing one batch.
  log(`\n== (c) one batch: build + first draw (upload), ms`);
  const buildRows: unknown[] = [];
  for (const count of [2_000, 4_000, 8_000, 16_000]) {
    const viaHelpers: number[] = [];
    const direct: number[] = [];
    const upload: number[] = [];
    for (let iteration = 0; iteration < 6; iteration += 1) {
      const items: InstanceRenderItem[] = [];
      const packed = new Float32Array(count * 16);
      for (let index = 0; index < count; index += 1) {
        const x = camera.position.x + 6 + random() * 40;
        const z = camera.position.z - 20 + random() * 40;
        const matrix = new Matrix4().makeTranslation(x, terrainHeightAt(DEF, tiles, x, z) ?? 0, z);
        items.push({ matrix, hidden: false });
        matrix.toArray(packed, index * 16);
      }
      let t = performance.now();
      const built: { group: Group; meshes: InstancedMesh[] } = createInstancedModelGroup({
        assetId: MESH_ID, gltf, items, castShadow: false, receiveShadow: true,
      });
      for (const mesh of built.meshes) mesh.computeBoundingSphere();
      const helperMs = performance.now() - t;
      t = performance.now();
      const meshes: InstancedMesh[] = [];
      for (const source of sourceMeshes) {
        const mesh = new InstancedMesh(source.geometry, source.material, count);
        // A single-node GLTF at identity: the packed world matrices are the instance matrices.
        (mesh.instanceMatrix.array as Float32Array).set(packed);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        meshes.push(mesh);
      }
      const directMs = performance.now() - t;
      for (const mesh of meshes) scene.add(mesh);
      t = performance.now();
      drawAndSync();
      const uploadMs = performance.now() - t;
      for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.dispose();
      }
      for (const mesh of built.meshes) mesh.dispose();
      drawAndSync();
      if (iteration === 0) continue;
      viaHelpers.push(helperMs);
      direct.push(directMs);
      upload.push(uploadMs);
    }
    const row = { count, helpers: stats(viaHelpers), direct: stats(direct), firstDraw: stats(upload) };
    buildRows.push(row);
    log(`${String(count).padStart(6)} instances: createInstancedModelGroup ${fmt(row.helpers)} | packed ${fmt(row.direct)} | first draw ${fmt(row.firstDraw)}`);
  }
  report.build = buildRows;
  report.status = "complete";
  window.__spikeReport = report;
}

main().catch((error) => {
  log(`FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  window.__spikeReport = { status: "failed", error: String(error) };
});
