import {
  ACESFilmicToneMapping,
  Euler,
  MathUtils,
  NoToneMapping,
  Vector3,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

import type { Vec3 } from "@engine/scene/layout";
import type { ResolvedSkyAtmosphere } from "@engine/scene/skyAtmosphere";

export {
  resolveSkyAtmosphere,
  SKY_ATMOSPHERE_DEFAULTS,
  type ResolvedSkyAtmosphere,
} from "@engine/scene/skyAtmosphere";

/**
 * Sky Atmosphere render binding - Unreal-style physically-inspired sky built on
 * three.js's analytic `Sky` shader (Rayleigh + Mie scattering). The dome is a
 * camera-following, depth-test-disabled background box: the scene camera's far
 * plane is small (100u), so the textbook 450000u sky sphere would be frustum-
 * culled. Instead we render a modest box that always surrounds the camera and
 * draws first (`renderOrder = -1`, no depth write/test) as a pure backdrop.
 *
 * The sky never illuminates by itself (its shader only colors the backdrop). Like
 * Unreal, the scene's directional Sun light is the source of truth for the sun:
 * {@link sunDirectionFromLightRotation} derives the sun direction from that light's
 * rotation, so rotating the Sun moves the sky. There is no sun data on the sky.
 */

/** Box half-extent the camera sits inside; well within the 100u camera far plane. */
const SKY_BOX_SCALE = 100;
export const SKY_ATMOSPHERE_RENDER_EXPOSURE_SCALE = 0.2;

const SKY_LOCAL_TONE_MAPPING_EXPOSURE = "forgeSkyLocalToneMappingExposure";
const SKY_PREVIOUS_TONE_MAPPING_EXPOSURE = "forgeSkyPreviousToneMappingExposure";

export function skyAtmosphereToneMappingExposure(exposure: number): number {
  return Math.max(0, exposure * SKY_ATMOSPHERE_RENDER_EXPOSURE_SCALE);
}

function installSkyLocalToneMappingExposure(sky: Sky): void {
  sky.onBeforeRender = (renderer: WebGLRenderer) => {
    const exposure = sky.userData[SKY_LOCAL_TONE_MAPPING_EXPOSURE];
    if (typeof exposure !== "number") return;
    sky.userData[SKY_PREVIOUS_TONE_MAPPING_EXPOSURE] = renderer.toneMappingExposure;
    renderer.toneMappingExposure = exposure;
  };
  sky.onAfterRender = (renderer: WebGLRenderer) => {
    const previous = sky.userData[SKY_PREVIOUS_TONE_MAPPING_EXPOSURE];
    if (typeof previous !== "number") return;
    renderer.toneMappingExposure = previous;
    delete sky.userData[SKY_PREVIOUS_TONE_MAPPING_EXPOSURE];
  };
}

export function setSkyLocalToneMappingExposure(sky: Sky, exposure: number | null): void {
  if (typeof exposure === "number" && Number.isFinite(exposure)) {
    sky.userData[SKY_LOCAL_TONE_MAPPING_EXPOSURE] = Math.max(0, exposure);
  } else {
    delete sky.userData[SKY_LOCAL_TONE_MAPPING_EXPOSURE];
  }
}

/** Builds the sky dome mesh (uniforms still need {@link applySkyUniforms}). */
export function createSkyObject(): Sky {
  const sky = new Sky();
  sky.name = "sky-atmosphere";
  sky.scale.setScalar(SKY_BOX_SCALE);
  // Pure backdrop: draw before everything, never write/test depth, never cull.
  sky.material.depthWrite = false;
  sky.material.depthTest = false;
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  // The water reflection already samples the environment. A low-resolution
  // planar capture must not rasterise this enormous HDR solar disc again.
  sky.userData.waterReflectionBackground = true;
  sky.userData.waterSunDiscRadiance = new Vector3();
  sky.userData.waterSunDiscDirection = new Vector3(0, 1, 0);
  // Background geometry is never a pick target.
  sky.raycast = () => {};
  installSkyLocalToneMappingExposure(sky);
  return sky;
}

/**
 * Keeps the dome centered on the camera so it always fills the (small) frustum.
 * Call once per frame from the render loop.
 */
export function followCameraWithSky(sky: Sky, camera: PerspectiveCamera): void {
  sky.position.copy(camera.position);
}

/**
 * Pushes the resolved scattering settings onto the sky shader. The sun direction
 * is applied separately via {@link applySkySunDirection} because it is owned by
 * the directional Sun light, not the sky.
 */
export function applySkyUniforms(sky: Sky, resolved: ResolvedSkyAtmosphere): void {
  const uniforms = sky.material.uniforms;
  uniforms.turbidity!.value = resolved.turbidity;
  uniforms.rayleigh!.value = resolved.rayleigh;
  uniforms.mieCoefficient!.value = resolved.mie;
  uniforms.mieDirectionalG!.value = resolved.mieDirectionalG;
  // Some three builds ship a clouds-extended Sky; disable its procedural clouds so
  // this stays a pure atmosphere (clouds are a separate concern, a la UE's
  // Volumetric Clouds) and we don't need to animate the `time` uniform.
  if (uniforms.cloudCoverage) uniforms.cloudCoverage.value = 0;
  sky.visible = !resolved.hidden;
  updateWaterSunDisc(sky);
}

/** Sets the sky's sun-disc/horizon position from a ground->sun direction. */
export function applySkySunDirection(sky: Sky, sunDirection: Vector3): void {
  (sky.material.uniforms.sunPosition!.value as Vector3).copy(sunDirection);
  updateWaterSunDisc(sky);
}

/** The live Sky's linear solar core, before tone mapping/bloom. Reproduce its
 * atmospheric extinction on the CPU; no capture, pixel readback or new texture.
 * Coefficients match the installed three.js Sky shader. This only supplies
 * water metadata and never changes the authored backdrop or its exposure. */
function updateWaterSunDisc(sky: Sky): void {
  const u = sky.material.uniforms;
  const direction = (sky.userData.waterSunDiscDirection ??= new Vector3()) as Vector3;
  const radiance = (sky.userData.waterSunDiscRadiance ??= new Vector3()) as Vector3;
  direction.copy(u.sunPosition!.value as Vector3).normalize();
  const y = MathUtils.clamp(direction.y, 0, 1);
  if (direction.y <= 0 || (u.showSunDisc && u.showSunDisc.value <= 0)) { radiance.set(0, 0, 0); return; }
  const zenith = Math.acos(y);
  const opticalPath = 1 / (y + 0.15 * Math.pow(93.885 - zenith * 180 / Math.PI, -1.253));
  const energy = 1000 * Math.max(0, 1 - Math.exp(-(1.6110731556870734 - zenith) / 1.5));
  const rayleigh = Number(u.rayleigh!.value), mie = Number(u.mieCoefficient!.value);
  const turbidity = Number(u.turbidity!.value);
  const mieScale = 0.434 * (0.2 * turbidity * 1e-17) * mie;
  const core = energy * 19000 * 0.04 * (u.showSunDisc ? Number(u.showSunDisc.value) : 1);
  const extinction = (r: number, m: number) => Math.exp(-opticalPath * (r * rayleigh * 8400 + m * mieScale * 1250));
  radiance.set(core * extinction(5.804542996261093e-6, 1.8399918514433978e14),
    core * extinction(1.3562911419845635e-5, 2.7798023919660528e14),
    core * extinction(3.0265902468824876e-5, 4.0790479543861094e14));
}

const LIGHT_FORWARD = new Vector3(0, 0, -1);

/**
 * Ground->sun direction derived from a directional light's Euler rotation. The
 * light travels FROM the sun TOWARD the scene (local forward -Z, see
 * `applyLightTransform` in lights.ts), so the direction to the sun is the negated
 * forward. This makes the Sun light the source of truth for the sky's sun.
 */
export function sunDirectionFromLightRotation(rotationDeg: Vec3): Vector3 {
  const euler = new Euler(
    MathUtils.degToRad(rotationDeg[0]),
    MathUtils.degToRad(rotationDeg[1]),
    MathUtils.degToRad(rotationDeg[2]),
    "XYZ",
  );
  return LIGHT_FORWARD.clone().applyEuler(euler).negate().normalize();
}

/**
 * The three.js `Sky` shader relies on the renderer's tone mapping for a correct
 * look (its fragment includes `<tonemapping_fragment>`). Opt into ACES filmic
 * tone mapping with the sky's exposure only while an active sky is present, and
 * restore the neutral default otherwise so sky-less scenes are unaffected.
 */
export function applySkyToneMapping(
  renderer: WebGLRenderer,
  resolved: ResolvedSkyAtmosphere | null,
): void {
  if (resolved && !resolved.hidden) {
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = skyAtmosphereToneMappingExposure(resolved.exposure);
  } else {
    renderer.toneMapping = NoToneMapping;
    renderer.toneMappingExposure = 1;
  }
}
