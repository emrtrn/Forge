import { Color, ColorManagement, Material, Fog, FogExp2, Vector3, Vector4, type Scene } from "three";

import type { ResolvedHeightFog } from "@engine/scene/heightFog";

export {
  resolveHeightFog,
  HEIGHT_FOG_DEFAULTS,
  type HeightFogMode,
  type ResolvedHeightFog,
} from "@engine/scene/heightFog";

/** Keeps the stock fog object for built-in material support and legacy scenes. */
export function applySceneFog(scene: Scene, resolved: ResolvedHeightFog | null): void {
  if (!resolved || resolved.hidden) { scene.fog = null; return; }
  const current = scene.fog;
  if (resolved.mode === "linear") {
    if (current instanceof Fog) { current.color.set(resolved.color); current.near = resolved.start; current.far = resolved.end; }
    else scene.fog = new Fog(resolved.color, resolved.start, resolved.end);
  } else {
    if (current instanceof FogExp2) { current.color.set(resolved.color); current.density = resolved.density; }
    else scene.fog = new FogExp2(resolved.color, resolved.density);
  }
}

interface FogState {
  settings: ResolvedHeightFog;
  sun: Vector3;
  shape: Vector4;
  sunParams: Vector4;
  tint: Color;
  tintHex: string;
  colors: Map<string, Color>;
}
const sceneStates = new WeakMap<Scene, FogState>();
const patched = new WeakSet<Material>();
const defaultShape = new Vector4(0, 0, 0, 1);
const defaultSun = new Vector4(0, -1, 0, 0);
type Shader = Parameters<Material["onBeforeCompile"]>[0];

/** Analytic exponential-density integral. No textures, shadow samples or march loop.
 * The stock view-depth metric is retained when falloff=0, preserving FogExp2 looks.
 * Offset reconstructed from mvPosition includes wind, instancing and water waves.
 */
export const HEIGHT_FOG_FRAGMENT = `
#ifdef USE_FOG
  float fogFactor;
  #ifdef FOG_EXP2
    float distanceToFog = max(0.0, vFogDepth - forgeFogShape.z);
    float opticalDepth = fogDensity * distanceToFog;
    if (forgeFogShape.x > 0.0 && distanceToFog > 0.0) {
      float rayStart = forgeFogShape.z / max(vFogDepth, 0.0001);
      float rayY = isOrthographic ? -viewMatrix[1][2] * vFogDepth : vForgeFogOffset.y;
      float originY = isOrthographic ? cameraPosition.y + vForgeFogOffset.y - rayY : cameraPosition.y;
      float startY = originY + rayY * rayStart;
      float endY = originY + rayY;
      float lowExponent = clamp(-forgeFogShape.x * (min(startY, endY) - forgeFogShape.y), -20.0, 20.0);
      float delta = forgeFogShape.x * abs(endY - startY);
      float integral = delta < 0.001 ? 1.0 - delta * 0.5 + delta * delta / 6.0 : (1.0 - exp(-delta)) / delta;
      opticalDepth *= exp(lowExponent) * integral;
    }
    fogFactor = 1.0 - exp(-opticalDepth * opticalDepth);
  #else
    fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  fogFactor = min(fogFactor, forgeFogShape.w);
  vec3 inscattering = fogColor;
  if (forgeFogSun.w > 0.0) {
    vec3 viewRay = isOrthographic ? -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) : vForgeFogOffset / max(length(vForgeFogOffset), 0.0001);
    float alignment = max(0.0, dot(viewRay, forgeFogSun.xyz));
    float sunLobe = alignment * alignment;
    sunLobe *= sunLobe;
    inscattering = mix(fogColor, forgeFogSunColor, sunLobe * forgeFogSun.w);
  }
  gl_FragColor.rgb = mix(gl_FragColor.rgb, inscattering, fogFactor);
#endif
`;

/** Once per material; chains terrain/wind/CSM patches and works with ShaderMaterial water.
 * Each material reads the rendering scene's state, so shared assets and reflection
 * cameras cannot retain another scene's fog uniforms. Weak ownership permits streaming.
 */
export function patchHeightFogMaterial(material: Material): void {
  if (patched.has(material) || !(material as Material & { fog?: boolean }).fog) return;
  patched.add(material);
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const baseKey = previousKey.call(material);
  const previousRender = material.onBeforeRender;
  const shape = { value: new Vector4(0, 0, 0, 1) };
  const sun = { value: new Vector4() };
  const color = { value: new Color() };
  material.onBeforeCompile = (shader: Shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    // A clone can inherit a prior fog compile hook without its render hook.
    // Always rebind uniforms to this material before the idempotence guard.
    shader.uniforms.forgeFogShape = shape;
    shader.uniforms.forgeFogSun = sun;
    shader.uniforms.forgeFogSunColor = color;
    if (shader.fragmentShader.includes("uniform vec4 forgeFogShape;")) return;
    if (!shader.vertexShader.includes("#include <fog_vertex>") || !shader.fragmentShader.includes("#include <fog_fragment>")) return;
    shader.vertexShader = shader.vertexShader
      .replace("#include <fog_pars_vertex>", "#include <fog_pars_vertex>\n#ifdef USE_FOG\nvarying vec3 vForgeFogOffset;\n#endif")
      .replace("#include <fog_vertex>", "#include <fog_vertex>\n#ifdef USE_FOG\nvForgeFogOffset = mvPosition.xyz * mat3(viewMatrix);\n#endif");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <fog_pars_fragment>", "#include <fog_pars_fragment>\n#ifdef USE_FOG\nvarying vec3 vForgeFogOffset;\nuniform vec4 forgeFogShape;\nuniform vec4 forgeFogSun;\nuniform vec3 forgeFogSunColor;\n#endif")
      .replace("#include <fog_fragment>", HEIGHT_FOG_FRAGMENT);
  };
  material.customProgramCacheKey = () => `${previousKey === Material.prototype.customProgramCacheKey ? baseKey : previousKey.call(material)}|forge-height-fog-v1`;
  material.onBeforeRender = function (renderer, scene, camera, geometry, object, group) {
    previousRender.call(this, renderer, scene, camera, geometry, object, group);
    const state = sceneStates.get(scene);
    shape.value = state?.shape ?? defaultShape;
    sun.value = state?.sunParams ?? defaultSun;
    if (state) {
      const target = renderer.getRenderTarget();
      const colorSpace = target === null ? renderer.outputColorSpace
        : "isXRRenderTarget" in target && target.isXRRenderTarget === true ? target.texture.colorSpace : ColorManagement.workingColorSpace;
      let converted = state.colors.get(colorSpace);
      if (!converted) {
        converted = new Color();
        state.tint.getRGB(converted, colorSpace);
        state.colors.set(colorSpace, converted);
      }
      color.value = converted;
    }
    // Custom water shaders need their added uniforms refreshed on every draw.
    if ("uniformsNeedUpdate" in this) this.uniformsNeedUpdate = true;
  };
  material.needsUpdate = true;
}

/** Registers streamed materials in the same frame they enter the visible graph.
 * Legacy fog does not require registration. No render targets or per-mesh state.
 */
export function updateHeightFog(scene: Scene, settings: ResolvedHeightFog | null, direction: Vector3 | null): void {
  if (!settings || settings.hidden) { sceneStates.delete(scene); return; }
  let state = sceneStates.get(scene);
  if (!state) {
    state = { settings, sun: new Vector3(0, 1, 0), shape: new Vector4(), sunParams: new Vector4(),
      tint: new Color(settings.sunColor), tintHex: settings.sunColor, colors: new Map() };
    sceneStates.set(scene, state);
  }
  state.settings = settings;
  if (direction) state.sun.copy(direction).normalize();
  else state.sun.set(0, -1, 0);
  state.shape.set(settings.heightFalloff, settings.baseHeight, settings.startDistance, settings.maxOpacity);
  state.sunParams.set(state.sun.x, state.sun.y, state.sun.z, settings.sunStrength * Math.max(0, Math.min(1, state.sun.y * 10)));
  if (state.tintHex !== settings.sunColor) {
    state.tintHex = settings.sunColor;
    state.tint.set(settings.sunColor);
    state.colors.clear();
  }
  if (settings.heightFalloff === 0 && settings.startDistance === 0 && settings.maxOpacity === 1 && settings.sunStrength === 0) return;
  scene.traverseVisible((object) => {
    const material = (object as { material?: Material | Material[] }).material;
    if (material) {
      if (Array.isArray(material)) for (const item of material) patchHeightFogMaterial(item);
      else patchHeightFogMaterial(material);
    }
  });
}
