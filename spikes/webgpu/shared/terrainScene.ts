// The S2 terrain scene, shared by s2-terrain and s3-pipeline: WebGPU renderer,
// the reference level's World Terrain (TSL CDLOD), Forge `high` sun shadow, sky
// and fog, camera from the harness pose. Throwaway spike code.
import * as THREE from "three/webgpu";
import { applyCameraPose, consumeCameraPose, createSpikeRenderer, type BackendProof, type SpikeRenderer, type SpikeRendererOptions } from "./spike";
import { createTerrainView, loadTerrain, openProjectAssets, type LoadedTerrain, type TerrainView } from "./terrain";
import { CAMERA_FAR, CAMERA_FOV, setupEnvironment, type LevelEnvironment } from "./environment";

export interface TerrainSelection { nodes: number; slotNodes: number; standIns: number }

export interface TerrainScene {
  spike: SpikeRenderer;
  renderer: THREE.WebGPURenderer;
  proof: BackendProof;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  level: Record<string, unknown>;
  terrain: LoadedTerrain;
  view: TerrainView;
  env: LevelEnvironment;
  /** `performance.now()` when loading started (after renderer init). */
  startedAt: number;
  loadedMs: number;
  /** CDLOD selection of the last reselect. */
  selection(): TerrainSelection;
  /** Reselects the terrain nodes for the current camera. */
  reselect(): void;
  /** Per frame, before rendering: reselects only when the camera moved (as Forge does), keeps the shadow on the camera. */
  update(): void;
}

export async function buildTerrainScene(canvas: HTMLCanvasElement, params: URLSearchParams, rendererOptions: SpikeRendererOptions = {}): Promise<TerrainScene> {
  const levelPath = params.get("level");
  if (!levelPath) throw new Error("?level=<project path> is required");
  const pose = consumeCameraPose();
  const spike = await createSpikeRenderer(canvas, rendererOptions);
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
  let selection: TerrainSelection = { nodes: 0, slotNodes: 0, standIns: 0 };
  const reselect = (): void => {
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen, THREE.WebGPUCoordinateSystem);
    selection = view.select(camera.position, frustum);
    lastSelect.copy(camera.position);
  };
  reselect();
  env.update(camera);

  return {
    spike, renderer, proof, scene, camera, level, terrain, view, env, startedAt: started, loadedMs,
    selection: () => selection,
    reselect,
    update() {
      if (camera.position.distanceToSquared(lastSelect) > 0.01) reselect();
      env.update(camera);
    },
  };
}
