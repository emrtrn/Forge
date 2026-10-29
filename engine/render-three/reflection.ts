import {
  NoToneMapping,
  PMREMGenerator,
  Scene,
  Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

import type { ResolvedReflection } from "@engine/scene/reflection";
import type { ResolvedSkyAtmosphere } from "@engine/scene/skyAtmosphere";

export {
  resolveReflection,
  REFLECTION_DEFAULTS,
  type ResolvedReflection,
} from "@engine/scene/reflection";

/**
 * Sky Light Capture render binding â€” the web/three counterpart to Unreal's
 * Sky Light static capture. {@link captureSkyEnvironment} renders a throwaway sky
 * dome (built from the resolved Sky Atmosphere settings + the Sun direction) into
 * a prefiltered PMREM cubemap; {@link applyReflectionEnvironment} hangs that on
 * `scene.environment`, so every `MeshStandardMaterial` reflects it and picks up
 * its ambient bounce. The capture is a snapshot ("static"): callers recapture
 * when the sky/sun changes (or on demand), never per frame.
 */

/**
 * Half-extent of the throwaway capture-sky box. The PMREM cube camera sits at the
 * origin inside it; the sky shader colors purely by view direction, so the exact
 * scale is irrelevant as long as the box surrounds the camera within the PMREM
 * far plane.
 */
const CAPTURE_SKY_SCALE = 100;

/** PMREM cube-camera far plane; comfortably covers the capture box corners (~173u). */
const CAPTURE_FAR = 1000;

/**
 * Captures the Sky Atmosphere into a PMREM environment render target. Builds a
 * disposable sky in its own scene (so the live backdrop is never disturbed) and
 * prefilters it. The renderer's tone mapping is forced off during the bake so the
 * environment is stored in a neutral/linear space regardless of the active tone
 * mapper. The caller owns the returned target and must dispose the previous one
 * before replacing it.
 */
export function captureSkyEnvironment(
  renderer: WebGLRenderer,
  sky: ResolvedSkyAtmosphere,
  sunDirection: Vector3,
): WebGLRenderTarget {
  const pmrem = new PMREMGenerator(renderer);
  const envScene = new Scene();
  const captureSky = new Sky();
  captureSky.scale.setScalar(CAPTURE_SKY_SCALE);

  const uniforms = captureSky.material.uniforms;
  uniforms.turbidity!.value = sky.turbidity;
  uniforms.rayleigh!.value = sky.rayleigh;
  uniforms.mieCoefficient!.value = sky.mie;
  uniforms.mieDirectionalG!.value = sky.mieDirectionalG;
  // Match the live sky: some three builds ship a clouds-extended Sky â€” keep this a
  // pure atmosphere so the captured IBL is just sky scattering.
  if (uniforms.cloudCoverage) uniforms.cloudCoverage.value = 0;
  (uniforms.sunPosition!.value as Vector3).copy(sunDirection);
  envScene.add(captureSky);

  const previousToneMapping = renderer.toneMapping;
  renderer.toneMapping = NoToneMapping;
  const target = pmrem.fromScene(envScene, 0, 0.1, CAPTURE_FAR);
  // Water removes only this captured solar hotspot before adding its own
  // finite analytic sun. Other PBR materials retain the original environment.
  target.texture.userData.waterSkySunDirection = sunDirection.toArray();
  renderer.toneMapping = previousToneMapping;

  captureSky.geometry.dispose();
  captureSky.material.dispose();
  pmrem.dispose();
  return target;
}

/**
 * Hangs a captured environment on the scene (or clears it). A hidden/absent
 * reflection â€” or a missing capture target â€” removes the environment so PBR
 * materials fall back to the scene lights alone.
 */
export function applyReflectionEnvironment(
  scene: Scene,
  target: WebGLRenderTarget | null,
  resolved: ResolvedReflection | null,
): void {
  if (!target || !resolved || resolved.hidden) {
    scene.environment = null;
    return;
  }
  scene.environment = target.texture;
  scene.environmentIntensity = resolved.intensity;
}
