import {
  Material,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from "three";
import type { ResolvedWind, WindSwaySettings } from "../environment/wind";

/**
 * Vertex wind sway for foliage and static meshes (DEFORMABLE_FRACTURABLE_WORK_PLAN
 * Faz 6): no physics, a vertex offset only. Each instance leans downwind and
 * flutters around the lean with its own phase; gusts travel along the wind as
 * a slow wave. A height mask keeps the base planted (pivot at the root, as
 * foliage is authored): metres along the mesh's up axis at instance scale 1, so
 * a type's settings read the same whatever unit the model was exported in and
 * a scaled-up instance bends proportionally.
 *
 * Same pattern as `foliageFade.ts`: an `onBeforeCompile` splice on the colour
 * material **and** the depth/distance shadow materials with shared uniforms, so
 * the shadow sways with the leaves. Wind and time are uniforms, so a wind
 * change or a moving camera never recompiles a program.
 */

type ShaderPatch = Parameters<Material["onBeforeCompile"]>[0];

/** Level-wide wind uniforms, one object shared by every swaying material. */
export interface WindSwayGlobalUniforms {
  /** Seconds of sway time (simulation time, so pause freezes the grass). */
  uWindTime: { value: number };
  /** Unit XZ downwind direction. */
  uWindDirection: { value: Vector2 };
  /** Effective strength (`ResolvedWind.strength`); 0 stops all sway. */
  uWindStrength: { value: number };
  uWindGust: { value: number };
  /** View camera position; measured from here in shadow passes too (fade parity). */
  uWindViewOrigin: { value: Vector3 };
  /** `(start, end)` distance over which sway fades out; `end <= 0` never fades. */
  uWindSwayFadeRange: { value: Vector2 };
}

/** Per-material sway response (a foliage type's or a material's sway settings). */
export interface WindSwayMaterialUniforms {
  /** Tip displacement in metres at strength 1, before flutter and gusts. */
  uSwayAmplitude: { value: number };
  /** Height (metres above the pivot at instance scale 1) where the mask reaches 1; at or below the pivot nothing moves. */
  uSwayHeight: { value: number };
  /** Flutter frequency in Hz. */
  uSwayFrequency: { value: number };
}

export function createWindSwayGlobalUniforms(): WindSwayGlobalUniforms {
  return {
    uWindTime: { value: 0 },
    uWindDirection: { value: new Vector2(0, 1) },
    uWindStrength: { value: 0 },
    uWindGust: { value: 0 },
    uWindViewOrigin: { value: new Vector3() },
    uWindSwayFadeRange: { value: new Vector2(0, 0) },
  };
}

export function createWindSwayMaterialUniforms(settings: WindSwaySettings): WindSwayMaterialUniforms {
  return {
    uSwayAmplitude: { value: settings.amplitude },
    uSwayHeight: { value: settings.height },
    uSwayFrequency: { value: settings.frequency },
  };
}

/** Writes the frame's wind into the shared uniforms; `fadeEnd <= 0` keeps sway at every distance. */
export function updateWindSwayUniforms(
  uniforms: WindSwayGlobalUniforms,
  wind: ResolvedWind,
  timeSeconds: number,
  viewOrigin: { x: number; y: number; z: number },
  fadeEnd = 0,
): void {
  uniforms.uWindTime.value = timeSeconds;
  uniforms.uWindDirection.value.set(wind.direction[0], wind.direction[1]);
  uniforms.uWindStrength.value = wind.strength;
  uniforms.uWindGust.value = wind.gust;
  uniforms.uWindViewOrigin.value.set(viewOrigin.x, viewOrigin.y, viewOrigin.z);
  const end = fadeEnd > 0 ? fadeEnd : 0;
  uniforms.uWindSwayFadeRange.value.set(end * 0.75, end);
}

const VERTEX_PARS = [
  "",
  "uniform float uWindTime;",
  "uniform vec2 uWindDirection;",
  "uniform float uWindStrength;",
  "uniform float uWindGust;",
  "uniform vec3 uWindViewOrigin;",
  "uniform vec2 uWindSwayFadeRange;",
  "uniform float uSwayAmplitude;",
  "uniform float uSwayHeight;",
  "uniform float uSwayFrequency;",
].join("\n");

const VERTEX_MAIN = [
  "",
  "{",
  "#ifdef USE_INSTANCING",
  "  mat4 swayModel = modelMatrix * instanceMatrix;",
  "#else",
  "  mat4 swayModel = modelMatrix;",
  "#endif",
  "  vec3 swayOrigin = swayModel[3].xyz;",
  "  float swayFade = uWindSwayFadeRange.y > 0.0",
  "    ? 1.0 - smoothstep(uWindSwayFadeRange.x, uWindSwayFadeRange.y, distance(swayOrigin, uWindViewOrigin))",
  "    : 1.0;",
  // Uniform per instance, so calm air or a far instance really skips the work.
  "  if (uWindStrength > 0.0 && swayFade > 0.0) {",
  // Height in metres at instance scale 1: modelMatrix carries the asset's own
  // node scale (a mesh authored in centimetres), the instance matrix does not.
  "  float swayMask = clamp(transformed.y * length(modelMatrix[1].xyz) / max(uSwayHeight, 1e-4), 0.0, 1.0);",
  "  swayMask *= swayMask;",
  "  float swayPhase = dot(swayOrigin.xz, vec2(0.37, 0.23));",
  "  float swayGustWave = 0.5 + 0.5 * sin(dot(swayOrigin.xz, uWindDirection) * 0.08 - uWindTime * 1.3);",
  "  float swayGust = uWindGust * swayGustWave * swayGustWave;",
  "  float swayFlutter = sin(uWindTime * 6.2831853 * uSwayFrequency + swayPhase);",
  // A downwind lean plus a flutter around it; gusts deepen both.
  "  float swayAmount = uSwayAmplitude * uWindStrength * swayMask * swayFade * (0.6 + 0.4 * swayFlutter + swayGust);",
  "  vec3 swayWorld = vec3(uWindDirection.x, 0.0, uWindDirection.y) * swayAmount;",
  // World offset → mesh-local: transpose ÷ scale² inverts a rotation × uniform scale.
  "  mat3 swayBasis = mat3(swayModel);",
  "  transformed += (transpose(swayBasis) * swayWorld) / max(dot(swayBasis[0], swayBasis[0]), 1e-8);",
  "  }",
  "}",
].join("\n");

/** Splices the sway into a three.js vertex shader; false when an anchor is missing (shader left as is). */
export function patchWindSwayShader(
  shader: ShaderPatch,
  global: WindSwayGlobalUniforms,
  material: WindSwayMaterialUniforms,
): boolean {
  const { vertexShader } = shader;
  if (!vertexShader.includes("#include <common>") || !vertexShader.includes("#include <begin_vertex>")) return false;
  Object.assign(shader.uniforms, global, material);
  shader.vertexShader = vertexShader
    .replace("#include <common>", `#include <common>${VERTEX_PARS}`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>${VERTEX_MAIN}`);
  return true;
}

const SWAY_CACHE_KEY = "forge-wind-sway-v1";

function ownOrNull<K extends "onBeforeCompile" | "customProgramCacheKey">(material: Material, key: K): Material[K] | null {
  return Object.prototype.hasOwnProperty.call(material, key) ? material[key] : null;
}

/**
 * Adds the sway to `material` in place, after any patch it already has (layer
 * blend, fade, …). Idempotent per material: a second call only rebinds uniforms.
 */
export function installWindSway(
  material: Material,
  global: WindSwayGlobalUniforms,
  uniforms: WindSwayMaterialUniforms,
): void {
  const state = material.userData as { forgeWindSway?: { global: WindSwayGlobalUniforms; uniforms: WindSwayMaterialUniforms } };
  if (state.forgeWindSway) {
    state.forgeWindSway.global = global;
    state.forgeWindSway.uniforms = uniforms;
    return;
  }
  const bound = { global, uniforms };
  state.forgeWindSway = bound;
  const priorPatch = ownOrNull(material, "onBeforeCompile");
  const priorKey = ownOrNull(material, "customProgramCacheKey");
  material.onBeforeCompile = (shader: ShaderPatch, renderer: WebGLRenderer) => {
    priorPatch?.call(material, shader, renderer);
    patchWindSwayShader(shader, bound.global, bound.uniforms);
  };
  material.customProgramCacheKey = () => `${priorKey ? `${priorKey.call(material)}|` : ""}${SWAY_CACHE_KEY}`;
  material.needsUpdate = true;
}

/**
 * A clone of `source` that can take further patches. `Material.clone()` drops an
 * instance `onBeforeCompile`/`customProgramCacheKey` and `MeshStandardMaterial.copy()`
 * resets `defines`; all three are carried over so the source's own patch still runs.
 */
export function clonePatchableMaterial(source: Material): Material {
  const material = source.clone();
  const defines = (source as Material & { defines?: Record<string, unknown> }).defines;
  if (defines) (material as Material & { defines?: Record<string, unknown> }).defines = { ...defines };
  const patch = ownOrNull(source, "onBeforeCompile");
  if (patch) material.onBeforeCompile = patch;
  const key = ownOrNull(source, "customProgramCacheKey");
  if (key) material.customProgramCacheKey = key;
  return material;
}

/** Shadow-pass materials (directional/spot depth, point-light distance) applying the same sway. */
export function createWindSwayShadowMaterials(global: WindSwayGlobalUniforms, uniforms: WindSwayMaterialUniforms): {
  depth: MeshDepthMaterial;
  distance: MeshDistanceMaterial;
} {
  const depth = new MeshDepthMaterial();
  const distance = new MeshDistanceMaterial();
  installWindSway(depth, global, uniforms);
  installWindSway(distance, global, uniforms);
  return { depth, distance };
}
