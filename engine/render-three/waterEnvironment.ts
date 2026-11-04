import { DirectionalLight, Matrix3, Matrix4, Vector3,
  type Camera, type IUniform, type Scene, type Texture } from "three";
import type { SphereReflectionCaptureBake } from "./reflectionCapture";
import { selectNearestReflectionCapture } from "../scene/reflectionCapture";
import { WATER_SUN_GLINT_GLSL } from "./waterSunGlint";

/** Borrowed, prefiltered maps. Water never creates or owns a capture target. */
export type WaterEnvironmentProbes = () => readonly SphereReflectionCaptureBake[];

export function createWaterEnvironmentUniforms() {
  return {
    waterEnvironment: { value: null as Texture | null }, waterEnvironmentMaxLod: { value: 0 },
    waterEnvironmentIntensity: { value: 0 }, waterEnvironmentRotation: { value: new Matrix3() },
    waterProbe: { value: null as Texture | null }, waterProbeMaxLod: { value: 0 },
    waterProbePosition: { value: new Vector3() }, waterProbeRadius: { value: 0 }, waterProbeIntensity: { value: 0 },
    waterSunDirection: { value: new Vector3(0, 1, 0) }, waterSunColor: { value: new Vector3() },
    waterSunDiscRadiance: { value: new Vector3() },
    waterSkySunDirection: { value: new Vector3(0, 1, 0) }, waterSkyHasSunDisc: { value: 0 },
    waterLightingEnabled: { value: 1 },
  };
}
type WaterEnvironmentUniforms = ReturnType<typeof createWaterEnvironmentUniforms>;
const rotation = new Matrix4(), lightPosition = new Vector3(), lightTarget = new Vector3(), viewPosition = new Vector3();

function bindMap(texture: Texture | null, map: IUniform<Texture | null>, maxLod: IUniform<number>): boolean {
  const pmrem = texture as (Texture & { isPMREMTexture?: boolean }) | null;
  const valid = pmrem?.isPMREMTexture === true && pmrem.mipmaps!.length > 0;
  map.value = valid ? pmrem : null;
  if (valid) maxLod.value = pmrem.mipmaps!.length - 1;
  return valid;
}

/** Select one local probe near the view, then fade it per fragment to the sky. */
export function updateWaterEnvironment(
  uniforms: WaterEnvironmentUniforms, scene: Scene, camera: Camera, probes: readonly SphereReflectionCaptureBake[] = [],
): void {
  const hasEnvironment = bindMap(scene.environment, uniforms.waterEnvironment, uniforms.waterEnvironmentMaxLod);
  uniforms.waterEnvironmentIntensity.value = hasEnvironment ? scene.environmentIntensity : 0;
  const capturedSun = hasEnvironment ? scene.environment?.userData.waterSkySunDirection : null;
  const hasCapturedSun = Array.isArray(capturedSun) && capturedSun.length === 3
    && capturedSun.every((v: unknown) => typeof v === "number" && Number.isFinite(v));
  uniforms.waterSkyHasSunDisc.value = hasCapturedSun ? 1 : 0;
  if (hasCapturedSun) uniforms.waterSkySunDirection.value.fromArray(capturedSun).normalize();
  uniforms.waterEnvironmentRotation.value.setFromMatrix4(rotation.makeRotationFromEuler(scene.environmentRotation)).transpose();
  camera.getWorldPosition(viewPosition);
  const index = selectNearestReflectionCapture([viewPosition.x, viewPosition.y, viewPosition.z], probes);
  const probe = index === null ? null : probes[index]!;
  const hasProbe = bindMap(probe?.target.texture ?? null, uniforms.waterProbe, uniforms.waterProbeMaxLod);
  uniforms.waterProbeIntensity.value = hasProbe ? probe!.intensity : 0;
  uniforms.waterProbeRadius.value = hasProbe ? probe!.radius : 0;
  if (hasProbe) uniforms.waterProbePosition.value.fromArray(probe!.position);
  let brightest: DirectionalLight | null = null;
  let skyRadiance: Vector3 | null = null, skyDirection: Vector3 | null = null;
  scene.traverseVisible((object) => {
    if (object instanceof DirectionalLight && object.intensity > (brightest?.intensity ?? 0)) brightest = object;
    if (object.userData.waterSunDiscRadiance instanceof Vector3 && object.userData.waterSunDiscDirection instanceof Vector3) {
      skyRadiance = object.userData.waterSunDiscRadiance;
      skyDirection = object.userData.waterSunDiscDirection;
    }
  });
  // CSM lights represent one sun; take the strongest, never sum its cascades.
  const sun = brightest as DirectionalLight | null;
  uniforms.waterSunDiscRadiance.value.set(0, 0, 0);
  if (sun) {
    sun.getWorldPosition(lightPosition); sun.target.getWorldPosition(lightTarget);
    uniforms.waterSunDirection.value.copy(lightPosition).sub(lightTarget).normalize();
    uniforms.waterSunColor.value.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(Math.min(sun.intensity, 8));
    const discDirection = skyDirection as Vector3 | null;
    if (skyRadiance && discDirection && sun.intensity > 0 && discDirection.dot(uniforms.waterSunDirection.value) > 0.999) {
      uniforms.waterSunDiscRadiance.value.copy(skyRadiance);
    }
  } else uniforms.waterSunColor.value.set(0, 0, 0);
}

// `waterMip` is three's `roughnessToMip` with the LOD count as a parameter: a 64px
// local capture and the 256px sky coexist here, and three's version reads one
// compile-time ENVMAP_MAX_LOD. An engine test watches three's formula for changes.
export const WATER_ENVIRONMENT_GLSL = /* glsl */ `
float waterMip(float roughness, float maxLod) {
  float r = clamp(roughness, 0.0, 1.0);
  return maxLod * r * (2.0 - r);
}
uniform samplerCube waterEnvironment;
uniform float waterEnvironmentMaxLod;
uniform float waterEnvironmentIntensity;
uniform mat3 waterEnvironmentRotation;
uniform samplerCube waterProbe;
uniform float waterProbeMaxLod;
uniform vec3 waterProbePosition;
uniform float waterProbeRadius;
uniform float waterProbeIntensity;
uniform vec3 waterSunDirection;
uniform vec3 waterSunColor;
uniform vec3 waterSunDiscRadiance;
uniform vec3 waterSkySunDirection;
uniform float waterSkyHasSunDisc;
uniform float waterLightingEnabled;
vec3 waterSky(vec3 direction, float roughness) {
  if (waterEnvironmentIntensity <= 0.0) return vec3(0.0);
  return textureLod(waterEnvironment, waterEnvironmentRotation * direction, waterMip(roughness, waterEnvironmentMaxLod)).rgb * waterEnvironmentIntensity;
}
float waterEnvironmentCoverage(vec3 worldPosition) {
  if (waterEnvironmentIntensity > 0.0) return 1.0;
  if (waterProbeRadius <= 0.0 || waterProbeIntensity <= 0.0) return 0.0;
  return 1.0 - smoothstep(0.55, 1.0, length(worldPosition - waterProbePosition) / waterProbeRadius);
}
vec3 waterReflectedSky(vec3 direction, float roughness) {
  vec3 sky = waterSky(direction, roughness);
  if (waterSkyHasSunDisc < 0.5 || roughness >= 0.6) return sky;
  vec3 d = normalize(waterEnvironmentRotation * direction);
  float width = 0.12 + roughness * 0.6;
  float solar = 1.0 - smoothstep(width * 0.5, width, distance(d, waterSkySunDirection));
  if (solar <= 0.0) return sky;
  vec3 axis = abs(waterSkySunDirection.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 tangent = normalize(cross(waterSkySunDirection, axis)) * width * 2.0;
  float mip = waterMip(roughness, waterEnvironmentMaxLod);
  vec3 nearby = (textureLod(waterEnvironment, normalize(d + tangent), mip).rgb
    + textureLod(waterEnvironment, normalize(d - tangent), mip).rgb)
    * 0.5 * waterEnvironmentIntensity;
  // Suppress the low-resolution solar texels only in reflected sky, retaining
  // the ambient Sky lookup and every non-water material's original PMREM.
  return mix(sky, min(sky, nearby * 1.25), solar);
}
vec3 waterReflectedEnvironment(vec3 worldPosition, vec3 direction, float roughness) {
  vec3 global = waterReflectedSky(direction, roughness);
  if (waterProbeRadius <= 0.0 || waterProbeIntensity <= 0.0) return global;
  float distanceToProbe = length(worldPosition - waterProbePosition) / waterProbeRadius;
  float weight = 1.0 - smoothstep(0.55, 1.0, distanceToProbe);
  if (weight <= 0.0) return global;
  // A rough local capture provides a faint environmental cue, not a local mirror.
  vec3 local = textureLod(waterProbe, direction, waterMip(roughness, waterProbeMaxLod)).rgb * waterProbeIntensity;
  return mix(global, local, weight);
}
vec3 waterSurfaceLight(vec3 normal, vec3 viewDirection, float roughness, float sunVisibility) {
  vec3 ambient = waterEnvironmentIntensity > 0.0 ? waterSky(vec3(0.0, 1.0, 0.0), 1.0) : vec3(0.6);
  vec3 illumination = clamp(vec3(0.5) + ambient * 0.5, vec3(0.4), vec3(1.8));
  // Body illumination is diffuse. The interface's one GGX lobe below owns
  // the sun highlight, instead of adding another specular lobe into the tint.
  float diffuse = max(dot(normal, waterSunDirection), 0.0);
  return mix(vec3(1.0), illumination, waterLightingEnabled)
    + waterSunColor * diffuse * 0.08 * waterLightingEnabled * sunVisibility;
}
vec3 waterSurfaceLight(vec3 normal, vec3 viewDirection, float roughness) {
  return waterSurfaceLight(normal, viewDirection, roughness, 1.0);
}
${WATER_SUN_GLINT_GLSL}
vec3 waterSunGlint(vec3 normal, vec3 viewDirection, float roughness) {
  return waterSunGlint(normal, viewDirection, roughness, 1.0);
}
`;
