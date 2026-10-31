import { Vector2, Vector4 } from "three";
import { LAKE_MAX_RIPPLES, type LakeRipple } from "../terrain/lakeInteraction";
import { WATER_WHEEL_FOAM_LIFETIME } from "../terrain/waterWheelInteraction";

export function createWaterWheelFoamUniforms() {
  return { wheelFoamCount: { value: 0 }, wheelFoamOrigin: { value: new Vector2() },
    wheelFoamPuffs: { value: Array.from({ length: LAKE_MAX_RIPPLES }, () => new Vector4()) } };
}
export function updateWaterWheelFoamUniforms(u: ReturnType<typeof createWaterWheelFoamUniforms>, puffs: readonly LakeRipple[], x: number, z: number, limit = LAKE_MAX_RIPPLES): void {
  u.wheelFoamOrigin.value.set(x, z);
  const count = Math.min(LAKE_MAX_RIPPLES, puffs.length, Math.max(0, limit));
  u.wheelFoamCount.value = count;
  for (let i = 0; i < count; i++) {
    const p = puffs[puffs.length - count + i]!; u.wheelFoamPuffs.value[i]!.set(p.x - x, p.z - z, p.age, p.strength);
  }
}
/** Density only: the shared water foam erosion, texture and lighting produce
 * the same material as shore/crest foam, with no added passes or GPU targets. */
export const WATER_WHEEL_FOAM_GLSL = /* glsl */ `
uniform int wheelFoamCount;
uniform vec2 wheelFoamOrigin;
uniform vec4 wheelFoamPuffs[${LAKE_MAX_RIPPLES}];
float waterWheelFoam(vec2 world, vec2 surfaceSlope, float pattern) {
  float density=0.;
  vec2 p=world-wheelFoamOrigin;
  for(int i=0;i<${LAKE_MAX_RIPPLES};i++) {
    if(i>=wheelFoamCount) break;
    vec4 puff=wheelFoamPuffs[i];
    vec2 delta=p-puff.xy;
    float height=dot(delta,surfaceSlope),d=sqrt(dot(delta,delta)+height*height);
    float radius=.22+puff.z*.65;
    float spread=1.-smoothstep(radius*.3,radius,d);
    float fade=pow(max(0.,1.-puff.z/${WATER_WHEEL_FOAM_LIFETIME.toFixed(1)}),1.5)*smoothstep(0.,.04,puff.z);
    density=max(density,spread*fade*mix(.45,.95,puff.w));
  }
  return waterFoamErosion(density,pattern)*.9;
}`;
