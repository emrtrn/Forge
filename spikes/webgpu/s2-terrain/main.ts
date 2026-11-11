// S2 Terrain: Forge's CDLOD World Terrain on WebGPU (TSL), CSM / follow shadow,
// SkyMesh + fog from the level. Two modes:
//  - default: draws the reference level's terrain from the harness pose and
//    publishes the perf witness (the Phase 0 harness measures it);
//  - ?g8=1: G8 "terrain = collider". The terrain is drawn top-down into a float
//    target with the main camera's LOD selection and morph, every pixel carrying
//    its world X / Y / Z; each pixel's height is compared with a ray cast onto
//    Forge's Rapier heightfield (terrainTileHeightfieldShape) at the same X / Z.
// URL: level=<project path of *.level.json>, g8=1, region=<metres, default 256>.
import * as THREE from "three/webgpu";
import RAPIER from "@dimforge/rapier3d-compat";
import { terrainTileHeightfieldShape } from "@engine/physics/terrainCollider";
import { parseTileKey, terrainTileWorldBounds } from "@engine/terrain/terrainTypes";
import { applyCameraPose, consumeCameraPose, createSpikeRenderer, report, startMeasuredLoop } from "../shared/spike";
import { createTerrainView, HEIGHT_READBACK_OFFSET, loadTerrain, openProjectAssets, type LoadedTerrain, type TerrainView } from "../shared/terrain";
import { CAMERA_FAR, CAMERA_FOV, setupEnvironment } from "../shared/environment";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const loading = document.querySelector<HTMLElement>(".forge-loading")!;

async function main(): Promise<void> {
  const levelPath = params.get("level");
  if (!levelPath) throw new Error("?level=<project path> is required");
  const pose = consumeCameraPose();
  const spike = await createSpikeRenderer(canvas);
  const { renderer, proof } = spike;
  if (!proof.isWebGPUBackend) throw new Error("not a WebGPU backend");
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;

  const started = performance.now();
  const assets = await openProjectAssets();
  const { level, terrain } = await loadTerrain(assets, levelPath);
  const loadedMs = performance.now() - started;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, CAMERA_FAR);
  if (pose) applyCameraPose(camera, pose);
  else {
    const def = terrain.def;
    camera.position.set(def.origin[0] + 200, 150, def.origin[2] + 200);
    camera.lookAt(def.origin[0] + 600, 0, def.origin[2] + 600);
  }
  camera.updateMatrixWorld();
  const view = createTerrainView(terrain, camera.position);
  scene.add(view.mesh);
  const env = setupEnvironment(level, scene, renderer, camera, { fog: params.get("nofog") !== "1", csm: params.get("nocsm") !== "1" });

  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  const lastSelect = new THREE.Vector3(Infinity, 0, 0);
  let selection = { nodes: 0, slotNodes: 0, standIns: 0 };
  const reselect = () => {
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen, THREE.WebGPUCoordinateSystem);
    selection = view.select(camera.position, frustum);
    lastSelect.copy(camera.position);
  };
  reselect();
  env.update(camera);
  await renderer.compileAsync(scene, camera);
  const readyMs = performance.now() - started;

  if (params.get("g8") === "1") {
    const g8 = await measureG8(renderer, terrain, view, camera, Number(params.get("region") ?? 256));
    reselect();
    report("complete", { mode: "g8", proof: { backend: proof.backend, isWebGPUBackend: proof.isWebGPUBackend }, level: levelPath, camera: camera.position.toArray(), g8 });
    loading.hidden = true;
    renderer.render(scene, camera);
    return;
  }

  // Forge reselects only when the camera moved; the harness camera is static.
  startMeasuredLoop(spike, () => {
    if (camera.position.distanceToSquared(lastSelect) > 0.01) reselect();
    env.update(camera);
    renderer.render(scene, camera);
  }, "s2-high");
  await new Promise((r) => setTimeout(r, 500));
  loading.hidden = true;
  report("complete", {
    mode: "view", level: levelPath, loadMs: Math.round(loadedMs), readyMs: Math.round(readyMs),
    terrain: { tiles: terrain.tiles.size, tileQuads: terrain.def.tileQuads, spacing: terrain.def.spacing, resident: view.residentKeys.length, layers: terrain.layers.length },
    selection, environment: env.describe, canvas: [canvas.width, canvas.height],
  });
}

interface Band { name: string; from: number; to: number; samples: number; max: number; sum: number; over5cm: number; values: number[] }

async function measureG8(renderer: THREE.WebGPURenderer, terrain: LoadedTerrain, view: TerrainView, camera: THREE.PerspectiveCamera, region: number) {
  // All nodes around the camera (no frustum culling), same LOD camera.
  const selection = view.select(camera.position, null);
  const size = Math.round(region);
  const cx = Math.floor(camera.position.x);
  const cz = Math.floor(camera.position.z);
  const ortho = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 1, 20000);
  ortho.position.set(cx, 10000, cz);
  ortho.up.set(0, 0, -1);
  ortho.lookAt(cx, 0, cz);
  ortho.updateMatrixWorld();
  const target = new THREE.RenderTarget(size, size, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(view.mesh.geometry, view.heightMaterial);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const toneMapping = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, ortho);
  renderer.setRenderTarget(null);
  renderer.toneMapping = toneMapping;
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size) as Float32Array;
  const centreIndex = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
  const probe = {
    length: pixels.length, expected: size * size * 4, type: pixels.constructor.name,
    first: Array.from(pixels.slice(0, 4)), centre: Array.from(pixels.slice(centreIndex, centreIndex + 4)),
    last: Array.from(pixels.slice(pixels.length - 4)), outputColorSpace: renderer.outputColorSpace,
  };

  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const def = terrain.def;
  let colliders = 0;
  for (const [key, tile] of terrain.tiles) {
    const { x, z } = parseTileKey(key)!;
    const b = terrainTileWorldBounds(def, x, z);
    if (b.maxX < cx - size / 2 - 1 || b.minX > cx + size / 2 + 1 || b.maxZ < cz - size / 2 - 1 || b.minZ > cz + size / 2 + 1) continue;
    const shape = terrainTileHeightfieldShape(def, tile);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...shape.translation));
    world.createCollider(RAPIER.ColliderDesc.heightfield(shape.nrows, shape.ncols, shape.heights, { x: shape.scale[0], y: shape.scale[1], z: shape.scale[2] }), body);
    colliders += 1;
  }
  world.step();

  const morph0 = view.lod.morphRanges[0]!;
  const morph1 = view.lod.morphRanges[1]!;
  const bands: Band[] = [
    { name: "level-0 unmorphed", from: 0, to: morph0[0] },
    { name: "level-0 morph", from: morph0[0], to: morph0[1] },
    { name: "level-1", from: morph0[1], to: morph1[1] },
    { name: "beyond", from: morph1[1], to: Infinity },
  ].map((b) => ({ ...b, samples: 0, max: 0, sum: 0, over5cm: 0, values: [] }));
  let misses = 0;
  let covered = 0;
  const worst: { x: number; z: number; gpu: number; rapier: number; d: number }[] = [];
  for (let i = 0; i < size * size; i += 1) {
    const o = HEIGHT_READBACK_OFFSET;
    const [y, x, z, a] = [pixels[i * 4]! - o, pixels[i * 4 + 1]! - o, pixels[i * 4 + 2]! - o, pixels[i * 4 + 3]!];
    if (a < 0.5) continue;
    covered += 1;
    const hit = world.castRay(new RAPIER.Ray({ x, y: 9000, z }, { x: 0, y: -1, z: 0 }), 20000, true);
    if (!hit) { misses += 1; continue; }
    const toi = (hit as unknown as { timeOfImpact?: number; toi?: number }).timeOfImpact ?? (hit as unknown as { toi: number }).toi;
    const rapierY = 9000 - toi;
    const diff = Math.abs(y - rapierY);
    const d = Math.hypot(x - camera.position.x, rapierY - camera.position.y, z - camera.position.z);
    const band = bands.find((b) => d >= b.from && d < b.to)!;
    band.samples += 1;
    band.sum += diff;
    band.max = Math.max(band.max, diff);
    if (diff > 0.05) band.over5cm += 1;
    band.values.push(diff);
    if (band === bands[0] && diff > 0.05 && worst.length < 8) worst.push({ x, z, gpu: y, rapier: rapierY, d });
  }
  world.free();
  target.dispose();
  const p = (values: number[], q: number) => (values.length ? [...values].sort((u, v) => u - v)[Math.floor((values.length - 1) * q)]! : 0);
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  return {
    regionMetres: size, centre: [cx, cz], probe, selection, colliders, covered, misses,
    lod: { range0: view.lod.settings.range0, leafSize: view.lod.settings.leafSize, morph0, morph1 },
    bands: bands.map((b) => ({ name: b.name, from: r4(b.from), to: b.to === Infinity ? null : r4(b.to), samples: b.samples, maxM: r4(b.max), meanM: r4(b.samples ? b.sum / b.samples : 0), p99M: r4(p(b.values, 0.99)), over5cm: b.over5cm })),
    worstNear: worst,
  };
}

main().catch((error: unknown) => {
  loading.hidden = true;
  document.getElementById("out")?.classList.remove("quiet");
  report("failed", { error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) });
});
