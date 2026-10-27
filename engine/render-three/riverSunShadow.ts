import { DirectionalLight, Vector2, type Camera, type Scene } from "three";
import { sunCascadesFor } from "./sunCascadeShadow";

export function createRiverSunShadowUniforms() {
  return { riverSunShadowIndex: { value: -1 }, riverSunCascadeCount: { value: 0 },
    riverSunShadowFade: { value: new Vector2(1e9, 1e9) } };
}

/** Match Three's shadow-casting directional-light order and the selected sun.
 * UniformsLib.lights supplies the renderer's maps/matrices, including reversed Z.
 * No shadow map, reflection target or render pass is owned by this receiver. */
export function updateRiverSunShadow(uniforms: ReturnType<typeof createRiverSunShadowUniforms>, scene: Scene, camera: Camera): void {
  const lights: DirectionalLight[] = [];
  let sun: DirectionalLight | undefined;
  scene.traverseVisible(object => {
    if (!(object instanceof DirectionalLight) || !object.layers.test(camera.layers)) return;
    if (object.intensity > (sun?.intensity ?? 0)) sun = object;
    if (object.castShadow) lights.push(object);
  });
  const cascades = sunCascadesFor(scene);
  uniforms.riverSunShadowIndex.value = sun ? lights.indexOf(sun) : -1;
  uniforms.riverSunCascadeCount.value = cascades && sun === cascades.cascadeLights[0] ? cascades.cascadeLights.length : 0;
  if (cascades) uniforms.riverSunShadowFade.value.copy(cascades.fadeUniform.value);
  else uniforms.riverSunShadowFade.value.set(1e9, 1e9);
}

export const RIVER_SUN_SHADOW_GLSL = /* glsl */ `
#include <common>
#include <packing>
#include <shadowmap_pars_fragment>
uniform float riverSunShadowIndex;
uniform float riverSunCascadeCount;
uniform vec2 riverSunShadowFade;
float riverSunVisibility() {
  float visibility = 1.0;
  #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
  float remaining = 1.0;
  float accumulated = 0.0;
  vec3 coord;
  float inside;
  #pragma unroll_loop_start
  for (int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i++) {
    coord = vDirectionalShadowCoord[i].xyz / vDirectionalShadowCoord[i].w;
    inside = step(0.0,coord.z) * step(coord.z,1.0);
    if (riverSunCascadeCount > float(UNROLLED_LOOP_INDEX)) {
      // Same first-containing-cascade and 5% edge blend as SunCascadeShadow.
      float weight = clamp(min(min(coord.x,1.0-coord.x),min(coord.y,1.0-coord.y)) / 0.05,0.0,1.0) * inside;
      if (remaining * weight > 0.0) {
        accumulated += remaining * weight * getShadow(directionalShadowMap[i], directionalLightShadows[i].shadowMapSize,
          directionalLightShadows[i].shadowIntensity, directionalLightShadows[i].shadowBias,
          directionalLightShadows[i].shadowRadius, vDirectionalShadowCoord[i]);
        remaining *= 1.0-weight;
      }
    } else if (riverSunCascadeCount < 0.5 && riverSunShadowIndex == float(UNROLLED_LOOP_INDEX) && inside > 0.0) {
      visibility = getShadow(directionalShadowMap[i], directionalLightShadows[i].shadowMapSize,
        directionalLightShadows[i].shadowIntensity, directionalLightShadows[i].shadowBias,
        directionalLightShadows[i].shadowRadius, vDirectionalShadowCoord[i]);
    }
  }
  #pragma unroll_loop_end
  if (riverSunCascadeCount > 0.5) {
    visibility = accumulated + remaining;
    visibility = mix(visibility,1.0,smoothstep(riverSunShadowFade.x,riverSunShadowFade.y,length(cameraPosition-vWorldPosition)));
  }
  #endif
  return visibility;
}
`;
