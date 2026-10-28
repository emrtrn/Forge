import { Vector4 } from "three";
import { LAKE_MAX_RIPPLES, type LakeRipple } from "../terrain/lakeInteraction";
import { LAKE_WHEEL_RIPPLE_DEFAULTS } from "../scene/waterBody";

export function createLakeRippleUniforms(settings: typeof LAKE_WHEEL_RIPPLE_DEFAULTS = LAKE_WHEEL_RIPPLE_DEFAULTS) {
  return { wheelRippleCount: { value: 0 }, wheelRipples: { value: Array.from({ length: LAKE_MAX_RIPPLES }, () => new Vector4()) },
    wheelRippleParams: { value: new Vector4(settings.wheelRipplesEnabled ? settings.wheelRippleStrength : 0,
      settings.wheelRippleSpeed, settings.wheelRippleWidth, settings.wheelRippleLifetime) },
    wheelRippleWavelength: { value: settings.wheelRippleWavelength } };
}
export function updateLakeRippleUniforms(uniforms: ReturnType<typeof createLakeRippleUniforms>, ripples: readonly LakeRipple[], x: number, z: number): void {
  uniforms.wheelRippleCount.value = Math.min(LAKE_MAX_RIPPLES, ripples.length);
  for (let i = 0; i < uniforms.wheelRippleCount.value; i++) {
    const r = ripples[i]!; uniforms.wheelRipples.value[i]!.set(r.x - x, r.z - z, r.age, r.strength);
  }
}
/** Bounded analytic wavefronts in metres; normals only, no new render passes. */
export const LAKE_RIPPLES_GLSL = /* glsl */ `
uniform int wheelRippleCount;
uniform vec4 wheelRippleParams;
uniform float wheelRippleWavelength;
uniform vec4 wheelRipples[${LAKE_MAX_RIPPLES}];
vec2 lakeWheelSlopes(vec2 localPosition) {
  vec2 slope=vec2(0.);
  float footprint=max(length(dFdx(localPosition)),length(dFdy(localPosition)));
  float resolved=1.-smoothstep(wheelRippleWavelength*.22,wheelRippleWavelength,footprint);
  for(int i=0;i<${LAKE_MAX_RIPPLES};i++) {
    if(i>=wheelRippleCount) break;
    vec4 r=wheelRipples[i];
    vec2 delta=localPosition-r.xy;
    float d=length(delta),front=.15+r.z*wheelRippleParams.y;
    float envelope=exp(-pow((d-front)/wheelRippleParams.z,2.))*smoothstep(0.,.06,r.z)
      *pow(max(0.,1.-r.z/wheelRippleParams.w),2.);
    slope+=delta/max(d,.001)*cos((d-front)*6.2831853/wheelRippleWavelength)*envelope*r.w*1.6*wheelRippleParams.x*resolved;
  }
  return slope;
}
`;
