/**
 * Paint a dent scrapes off (three.js boundary).
 *
 * A dent writes how far each vertex was pushed into a float attribute of its own
 * mesh; the materials named by the asset's `wear` block read it and show bare metal
 * where it is high, broken up by noise. The attribute lives only on dented copies:
 * on every other mesh WebGL reads it as 0, so a shared material can carry the patch
 * and an undented truck looks and costs as before. The patch goes on when the
 * object is first seen, not at the first crash, so the shader compile stays out of
 * the crash.
 */

import { Color, type Material, type Mesh, type Object3D } from "three";

import type { AssetDeformableWear } from "@engine/physics/deformable/deformableTypes";

export const DENT_WEAR_ATTRIBUTE = "forgeDentWear";

type ShaderPatch = Parameters<Material["onBeforeCompile"]>[0];

const patched = new WeakSet<Material>();

const WEAR_FUNCTIONS = /* glsl */ `
uniform vec3 forgeDentWearColor;
uniform float forgeDentWearRoughness;
varying float vForgeDentWear;
varying vec3 vForgeDentWearPosition;
float forgeDentWearHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float forgeDentWearNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(forgeDentWearHash(i), forgeDentWearHash(i + vec3(1, 0, 0)), f.x),
        mix(forgeDentWearHash(i + vec3(0, 1, 0)), forgeDentWearHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(forgeDentWearHash(i + vec3(0, 0, 1)), forgeDentWearHash(i + vec3(1, 0, 1)), f.x),
        mix(forgeDentWearHash(i + vec3(0, 1, 1)), forgeDentWearHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

const WEAR_COLOUR = /* glsl */ `
float forgeDentWearMask = 0.0;
if (vForgeDentWear > 0.002) {
  vec3 forgeP = vForgeDentWearPosition;
  float forgeBroad = forgeDentWearNoise(forgeP * 24.0) * 0.65 + forgeDentWearNoise(forgeP * 85.0) * 0.35;
  float forgeScratch = forgeDentWearNoise(forgeP * vec3(150.0, 16.0, 150.0));
  float forgeReach = vForgeDentWear * 1.3 - 0.32 + (forgeBroad - 0.5) * 0.85 + (forgeScratch - 0.5) * 0.3;
  forgeDentWearMask = smoothstep(0.0, 0.05, forgeReach);
  vec3 forgeBare = forgeDentWearColor * (0.7 + 0.6 * forgeBroad);
  // A dark rim where the paint let go.
  diffuseColor.rgb *= 1.0 - 0.45 * smoothstep(-0.07, 0.0, forgeReach) * (1.0 - forgeDentWearMask);
  diffuseColor.rgb = mix(diffuseColor.rgb, forgeBare, forgeDentWearMask);
}
`;

function patchShader(shader: ShaderPatch, wear: AssetDeformableWear): void {
  shader.uniforms.forgeDentWearColor = { value: new Color(...wear.color) };
  shader.uniforms.forgeDentWearRoughness = { value: wear.roughness };
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>
attribute float ${DENT_WEAR_ATTRIBUTE};
varying float vForgeDentWear;
varying vec3 vForgeDentWearPosition;`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>
vForgeDentWear = ${DENT_WEAR_ATTRIBUTE};
vForgeDentWearPosition = position;`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${WEAR_FUNCTIONS}`)
    .replace("#include <map_fragment>", `#include <map_fragment>\n${WEAR_COLOUR}`)
    .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, forgeDentWearRoughness, forgeDentWearMask);`);
}

function patchMaterial(material: Material, wear: AssetDeformableWear): void {
  if (patched.has(material)) return;
  patched.add(material);
  const priorPatch = material.onBeforeCompile;
  const priorCacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    priorPatch.call(material, shader, renderer);
    patchShader(shader, wear);
  };
  material.customProgramCacheKey = () => `${priorCacheKey.call(material)}|forge-dent-wear-v1:${wear.color.join()}:${wear.roughness}`;
  material.needsUpdate = true;
}

/** Puts the wear on the object's named materials; safe to call again. */
export function prepareDentWear(root: Object3D, wear: AssetDeformableWear): void {
  const wanted = new Set(wear.materials);
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (wanted.has(material.name)) patchMaterial(material, wear);
    }
  });
}
