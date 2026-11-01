import {
  Material,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from "three";

/**
 * Per-instance distance fade for foliage InstancedMeshes (OPEN_WORLD_PLAN Faz 6,
 * F1): between a type's `cullStart` and `cullEnd` each instance dissolves with a
 * 4×4 ordered dither (screen-door), measured from the instance origin to the view
 * camera. No blending, so no sort order; the shadow depth/distance materials run
 * the same test so a faded instance stops casting too. The window is a uniform,
 * so moving the camera or changing the quality scale never recompiles a program.
 */

type ShaderPatch = Parameters<Material["onBeforeCompile"]>[0];

/** Uniforms one fade window shares between its colour and shadow materials. */
export interface FoliageFadeUniforms {
  /** World position distances are measured from (the view camera, also in shadow passes). */
  uFoliageFadeOrigin: { value: Vector3 };
  /** `(start, end)` in world units; `start === end` is a hard per-instance cut. */
  uFoliageFadeRange: { value: Vector2 };
}

/**
 * The fade window for a type's authored cull distances, scaled by the quality
 * knob, or null when the type never culls (`cullEnd <= 0`). A fade needs
 * `0 < cullStart < cullEnd`; otherwise instances cut off at `cullEnd`, which is
 * how a type authored before the fade existed (cullStart ignored) still looks.
 */
export function foliageFadeWindow(cullStart: number, cullEnd: number, scale = 1): [number, number] | null {
  const factor = scale > 0 ? scale : 1;
  if (!(cullEnd > 0)) return null;
  const end = cullEnd * factor;
  const start = cullStart > 0 && cullStart < cullEnd ? cullStart * factor : end;
  return [start, end];
}

const VERTEX_PARS = "\nuniform vec3 uFoliageFadeOrigin;\nvarying float vFoliageFadeDistance;";
const VERTEX_MAIN = [
  "",
  "#ifdef USE_INSTANCING",
  "  vFoliageFadeDistance = distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, uFoliageFadeOrigin);",
  "#else",
  "  vFoliageFadeDistance = distance((modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, uFoliageFadeOrigin);",
  "#endif",
].join("\n");
// Size-scaled variant (static detail culling, Faz 7e): the window is authored for
// an instance at scale 1, so a scaled-up instance fades proportionally farther.
const VERTEX_MAIN_SCALED = [
  VERTEX_MAIN,
  "#ifdef USE_INSTANCING",
  "  vFoliageFadeDistance /= max(max(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz)), max(length(instanceMatrix[2].xyz), 1e-4));",
  "#else",
  "  vFoliageFadeDistance /= max(max(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz)), max(length(modelMatrix[2].xyz), 1e-4));",
  "#endif",
].join("\n");
const FRAGMENT_PARS = [
  "",
  "uniform vec2 uFoliageFadeRange;",
  "varying float vFoliageFadeDistance;",
  "float foliageFadeThreshold(vec2 pixel) {",
  "  ivec2 cell = ivec2(mod(pixel, 4.0));",
  "  const float bayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);",
  "  return (bayer[cell.x + cell.y * 4] + 0.5) / 16.0;",
  "}",
].join("\n");
const FRAGMENT_MAIN = [
  "",
  "  float foliageFade = clamp((uFoliageFadeRange.y - vFoliageFadeDistance) / max(uFoliageFadeRange.y - uFoliageFadeRange.x, 1e-4), 0.0, 1.0);",
  "  if (foliageFade < foliageFadeThreshold(gl_FragCoord.xy)) discard;",
].join("\n");
const MAIN = /void\s+main\s*\(\s*\)\s*\{/;

/** How the fade measures an instance: plain distance, or distance ÷ instance scale. */
export type FadeDistanceMode = "distance" | "instanceScaled";

/** Splices the fade into a three.js shader; false when an anchor is missing (shader left as is). */
export function patchFoliageFadeShader(
  shader: ShaderPatch,
  uniforms: FoliageFadeUniforms,
  mode: FadeDistanceMode = "distance",
): boolean {
  const { vertexShader, fragmentShader } = shader;
  if (
    !vertexShader.includes("#include <common>") ||
    !vertexShader.includes("#include <project_vertex>") ||
    !fragmentShader.includes("#include <common>") ||
    !MAIN.test(fragmentShader)
  ) {
    return false;
  }
  shader.uniforms.uFoliageFadeOrigin = uniforms.uFoliageFadeOrigin;
  shader.uniforms.uFoliageFadeRange = uniforms.uFoliageFadeRange;
  shader.vertexShader = vertexShader
    .replace("#include <common>", `#include <common>${VERTEX_PARS}`)
    .replace("#include <project_vertex>", `#include <project_vertex>${mode === "instanceScaled" ? VERTEX_MAIN_SCALED : VERTEX_MAIN}`);
  shader.fragmentShader = fragmentShader
    .replace("#include <common>", `#include <common>${FRAGMENT_PARS}`)
    .replace(MAIN, (main) => `${main}${FRAGMENT_MAIN}`);
  return true;
}

const overrideFades = new WeakMap<Material, { uniforms: FoliageFadeUniforms; mode: FadeDistanceMode }>();
export function applyFoliageFadeToOverride(source: Material, shader: ShaderPatch): void {
  const fade = overrideFades.get(source);
  if (fade) patchFoliageFadeShader(shader, fade.uniforms, fade.mode);
}

function installFade(
  material: Material,
  uniforms: FoliageFadeUniforms,
  priorPatch: Material["onBeforeCompile"] | null,
  priorCacheKey: (() => string) | null,
  mode: FadeDistanceMode,
): void {
  overrideFades.set(material, { uniforms, mode });
  material.onBeforeCompile = (shader: ShaderPatch, renderer: WebGLRenderer) => {
    priorPatch?.call(material, shader, renderer);
    patchFoliageFadeShader(shader, uniforms, mode);
  };
  const key = mode === "instanceScaled" ? "forge-foliage-fade-scaled-v1" : "forge-foliage-fade-v1";
  material.customProgramCacheKey = () => `${priorCacheKey ? `${priorCacheKey.call(material)}|` : ""}${key}`;
  material.needsUpdate = true;
}

function ownOrNull<K extends "onBeforeCompile" | "customProgramCacheKey">(material: Material, key: K): Material[K] | null {
  return Object.prototype.hasOwnProperty.call(material, key) ? material[key] : null;
}

/**
 * A fading clone of `source`. `Material.clone()` drops an instance
 * `onBeforeCompile`/`customProgramCacheKey` and `MeshStandardMaterial.copy()`
 * resets `defines`, so all three are carried over and the source's own patch
 * (layer blend, normal motion, …) runs before the fade.
 */
export function createFoliageFadeMaterial(
  source: Material,
  uniforms: FoliageFadeUniforms,
  mode: FadeDistanceMode = "distance",
): Material {
  const material = source.clone();
  const defines = (source as Material & { defines?: Record<string, unknown> }).defines;
  if (defines) (material as Material & { defines?: Record<string, unknown> }).defines = { ...defines };
  installFade(material, uniforms, ownOrNull(source, "onBeforeCompile"), ownOrNull(source, "customProgramCacheKey"), mode);
  return material;
}

/** Shadow-pass materials (directional/spot depth, point-light distance) applying the same fade. */
export function createFoliageFadeShadowMaterials(uniforms: FoliageFadeUniforms, mode: FadeDistanceMode = "distance"): {
  depth: MeshDepthMaterial;
  distance: MeshDistanceMaterial;
} {
  // Same construction as three's own shadow-pass materials (WebGLShadowMap).
  const depth = new MeshDepthMaterial();
  const distance = new MeshDistanceMaterial();
  installFade(depth, uniforms, null, null, mode);
  installFade(distance, uniforms, null, null, mode);
  return { depth, distance };
}
