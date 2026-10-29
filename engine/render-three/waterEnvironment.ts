import { CubeUVReflectionMapping, DirectionalLight, Matrix3, Matrix4, ShaderChunk, Vector3,
  type Camera, type IUniform, type Scene, type Texture } from "three";
import type { SphereReflectionCaptureBake } from "./reflectionCapture";
import { selectNearestReflectionCapture } from "../scene/reflectionCapture";
import { WATER_SUN_GLINT_GLSL } from "./waterSunGlint";

/** Borrowed, prefiltered maps. Water never creates or owns a capture target. */
export type WaterEnvironmentProbes = () => readonly SphereReflectionCaptureBake[];

export function createWaterEnvironmentUniforms() {
  return {
    waterEnvironment: { value: null as Texture | null }, waterEnvironmentSize: { value: new Vector3(1, 1, 4) },
    waterEnvironmentIntensity: { value: 0 }, waterEnvironmentRotation: { value: new Matrix3() },
    waterProbe: { value: null as Texture | null }, waterProbeSize: { value: new Vector3(1, 1, 4) },
    waterProbePosition: { value: new Vector3() }, waterProbeRadius: { value: 0 }, waterProbeIntensity: { value: 0 },
    waterSunDirection: { value: new Vector3(0, 1, 0) }, waterSunColor: { value: new Vector3() },
    waterSunDiscRadiance: { value: new Vector3() },
    waterSkySunDirection: { value: new Vector3(0, 1, 0) }, waterSkyHasSunDisc: { value: 0 },
    waterLightingEnabled: { value: 1 },
  };
}
type WaterEnvironmentUniforms = ReturnType<typeof createWaterEnvironmentUniforms>;
const rotation = new Matrix4(), lightPosition = new Vector3(), lightTarget = new Vector3(), viewPosition = new Vector3();

function bindMap(texture: Texture | null, map: IUniform<Texture | null>, size: IUniform<Vector3>): boolean {
  const image = texture?.image as { width?: number; height?: number } | undefined;
  const valid = texture?.mapping === CubeUVReflectionMapping && !!image?.width && !!image.height;
  map.value = valid ? texture : null;
  if (valid) size.value.set(1 / image!.width!, 1 / image!.height!, Math.log2(image!.height!) - 2);
  return valid;
}

/** Select one local probe near the view, then fade it per fragment to the sky. */
export function updateWaterEnvironment(
  uniforms: WaterEnvironmentUniforms, scene: Scene, camera: Camera, probes: readonly SphereReflectionCaptureBake[] = [],
): void {
  const hasEnvironment = bindMap(scene.environment, uniforms.waterEnvironment, uniforms.waterEnvironmentSize);
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
  const hasProbe = bindMap(probe?.target.texture ?? null, uniforms.waterProbe, uniforms.waterProbeSize);
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

// Three's PMREM atlas layout, parameterised so a 64px local capture and the
// 256px sky can coexist. This shares the renderer's roughness/mip convention.
const cubeUV = ShaderChunk.cube_uv_reflection_fragment
  .replace("float mipInt ) {", "float mipInt, vec3 atlasSize ) {")
  .replace("vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness )", "vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness, vec3 atlasSize )")
  .replaceAll("CUBEUV_MAX_MIP", "atlasSize.z")
  .replaceAll("CUBEUV_TEXEL_WIDTH", "atlasSize.x")
  .replaceAll("CUBEUV_TEXEL_HEIGHT", "atlasSize.y")
  .replace("bilinearCubeUV( envMap, sampleDir, mipInt )", "bilinearCubeUV( envMap, sampleDir, mipInt, atlasSize )")
  .replace("bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 )", "bilinearCubeUV( envMap, sampleDir, mipInt + 1.0, atlasSize )");

export const WATER_ENVIRONMENT_GLSL = /* glsl */ `
#define ENVMAP_TYPE_CUBE_UV
${cubeUV}
uniform sampler2D waterEnvironment;
uniform vec3 waterEnvironmentSize;
uniform float waterEnvironmentIntensity;
uniform mat3 waterEnvironmentRotation;
uniform sampler2D waterProbe;
uniform vec3 waterProbeSize;
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
  return textureCubeUV(waterEnvironment, waterEnvironmentRotation * direction, roughness, waterEnvironmentSize).rgb * waterEnvironmentIntensity;
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
  vec3 nearby = (textureCubeUV(waterEnvironment, normalize(d + tangent), roughness, waterEnvironmentSize).rgb
    + textureCubeUV(waterEnvironment, normalize(d - tangent), roughness, waterEnvironmentSize).rgb)
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
  vec3 local = textureCubeUV(waterProbe, direction, roughness, waterProbeSize).rgb * waterProbeIntensity;
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
