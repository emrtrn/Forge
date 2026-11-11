// Level lighting for the WebGPU spike, mirroring what Forge WebGL's `high`
// profile sets up: sun from the level (light rotation, or the World Environment
// clock), Forge's cascade splits (200 m x 0.75, lambda 0.75, 3 x 1024) for a
// `cascadedShadows` sun and a camera-following single map (60 m x 0.75 half
// extent) otherwise, SkyMesh with the level's scattering, ACES at Forge's sky
// exposure, ambient and exponential fog from the level. Throwaway spike code.
import * as THREE from "three/webgpu";
import { CSMShadowNode } from "three/examples/jsm/csm/CSMShadowNode.js";
import { SkyMesh } from "three/examples/jsm/objects/SkyMesh.js";
import { evaluateSunLight, sunDirectionFromRotation } from "@engine/environment/sunPath";
import { resolveWorldEnvironment } from "@engine/environment/worldEnvironment";
import { computeCascadeSplits, SUN_CASCADE_NEAR, SUN_CASCADE_SPLIT_LAMBDA, sunCascadeDistance } from "@engine/world/sunCascades";

/** Forge `high` (engine/perf/qualityProfiles.ts). */
const HIGH = { shadowMapSize: 1024, shadowDistanceScale: 0.75, shadowCascades: 3 };
/** engine/render-three/sunFollowShadow.ts */
const FOLLOW_SHADOW_HALF_EXTENT = 60;
/** engine/render-three/skyAtmosphere.ts */
const SKY_EXPOSURE_SCALE = 0.2;
/** engine/render-three/camera.ts */
export const CAMERA_FOV = 44;
export const CAMERA_FAR = 2000;

interface LevelLight { type: string; rotation?: [number, number, number]; color?: string; intensity?: number; castShadow?: boolean; cascadedShadows?: boolean }

export interface LevelEnvironment {
  sun: THREE.DirectionalLight;
  sunDirection: THREE.Vector3;
  /** Call before rendering: keeps the follow shadow on the camera. */
  update(camera: THREE.Camera): void;
  describe: Record<string, unknown>;
}

export function setupEnvironment(level: Record<string, unknown>, scene: THREE.Scene, renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera, options: { fog?: boolean; csm?: boolean } = {}): LevelEnvironment {
  const lights = (level.lights as LevelLight[] | undefined) ?? [];
  const sunLight = lights.find((l) => l.type === "directional");
  const settings = (level.worldSettings as Record<string, unknown> | undefined) ?? {};
  const sky = (level.skyAtmosphere as Record<string, number | undefined> | undefined) ?? null;
  const fog = (level.heightFog as { mode?: string; color?: string; density?: number } | undefined) ?? null;

  let direction: THREE.Vector3;
  let intensityFactor = 1;
  if (level.worldEnvironment) {
    const env = resolveWorldEnvironment(level.worldEnvironment as never);
    const state = evaluateSunLight(env.time.hour, env);
    direction = new THREE.Vector3(...state.lightDirection);
    intensityFactor = state.intensityFactor;
  } else {
    direction = new THREE.Vector3(...sunDirectionFromRotation(sunLight?.rotation ?? [-55, 35, 0]));
  }
  direction.normalize();

  const sun = new THREE.DirectionalLight(sunLight?.color ?? "#ffffff", (sunLight?.intensity ?? 2) * intensityFactor);
  sun.castShadow = sunLight?.castShadow !== false;
  sun.shadow.mapSize.set(HIGH.shadowMapSize, HIGH.shadowMapSize);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const cascaded = sunLight?.cascadedShadows === true && options.csm !== false;
  const distance = sunCascadeDistance(HIGH.shadowDistanceScale);
  if (cascaded && sun.castShadow) {
    const csm = new CSMShadowNode(sun, {
      cascades: HIGH.shadowCascades,
      maxFar: distance,
      mode: "custom",
      lightMargin: 100,
      customSplitsCallback: (cascades: number, _near: number, far: number, breaks: number[]) => {
        const splits = computeCascadeSplits(cascades, SUN_CASCADE_NEAR, far, SUN_CASCADE_SPLIT_LAMBDA);
        for (let i = 0; i < cascades - 1; i += 1) breaks.push(splits[i]! / far);
        breaks.push(1);
      },
    });
    // CSMShadowNode takes the rendering camera in its own setup(); assigning it here skips _init().
    sun.shadow.shadowNode = csm;
  } else {
    const half = FOLLOW_SHADOW_HALF_EXTENT * HIGH.shadowDistanceScale;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 1000 });
    sun.shadow.camera.updateProjectionMatrix();
  }

  const settingsColor = (key: string, fallback: string) => (typeof settings[key] === "string" ? settings[key] as string : fallback);
  scene.add(new THREE.AmbientLight(settingsColor("ambientColor", "#ffffff"), typeof settings.ambientIntensity === "number" ? settings.ambientIntensity : 0.4));

  if (sky) {
    const skyMesh = new SkyMesh();
    skyMesh.scale.setScalar(CAMERA_FAR * 0.95);
    skyMesh.turbidity.value = sky.turbidity ?? 2;
    skyMesh.rayleigh.value = sky.rayleigh ?? 1;
    skyMesh.mieCoefficient.value = sky.mie ?? 0.005;
    skyMesh.mieDirectionalG.value = sky.mieDirectionalG ?? 0.8;
    skyMesh.sunPosition.value.copy(direction);
    scene.add(skyMesh);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = Math.max(0, (sky.exposure ?? 1) * SKY_EXPOSURE_SCALE);
  } else {
    scene.background = new THREE.Color(settingsColor("backgroundColor", "#a9c9df"));
    renderer.toneMapping = THREE.NoToneMapping;
  }
  if (options.fog !== false && fog && (fog.mode ?? "exp") === "exp" && typeof fog.density === "number") {
    scene.fog = new THREE.FogExp2(fog.color ?? "#ffffff", fog.density);
  }

  const offset = new THREE.Vector3();
  return {
    sun,
    sunDirection: direction,
    update(cam) {
      // Light sits up-sun of the camera; the follow map's frustum moves with it.
      offset.copy(direction).multiplyScalar(500);
      sun.target.position.copy(cam.position);
      sun.position.copy(cam.position).add(offset);
      sun.target.updateMatrixWorld();
    },
    describe: { cascaded, shadowDistance: cascaded ? distance : FOLLOW_SHADOW_HALF_EXTENT * HIGH.shadowDistanceScale, mapSize: HIGH.shadowMapSize, cascades: cascaded ? HIGH.shadowCascades : 1, sky: Boolean(sky), fog: scene.fog ? "exp2" : null, exposure: renderer.toneMappingExposure },
  };
}
