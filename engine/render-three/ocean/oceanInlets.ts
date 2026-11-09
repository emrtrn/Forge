import { Vector4 } from "three";
import type { OceanInlet } from "../../terrain/oceanCoverage";

export function createOceanInletUniforms(inlets: readonly OceanInlet[] = []) {
  return { oceanInletCount: { value: inlets.length },
    oceanInletStart: { value: Array.from({ length: 3 }, (_, i) => new Vector4(...(inlets[i]?.start ?? [0, 0]), inlets[i]?.width ?? 0, 0)) },
    oceanInletEnd: { value: Array.from({ length: 3 }, (_, i) => new Vector4(...(inlets[i]?.end ?? [0, 0]), 0, 0)) } };
}

/** Same finite, constant-width reaches as the native CPU coverage query. */
export const OCEAN_INLETS_GLSL = /* glsl */ `
uniform int oceanInletCount;
uniform vec4 oceanInletStart[3];
uniform vec4 oceanInletEnd[3];
bool oceanInletContains(vec2 world) {
  for(int i=0;i<3;i++) {
    if(i>=oceanInletCount) break;
    vec2 delta=oceanInletEnd[i].xy-oceanInletStart[i].xy;
    float len=length(delta); vec2 p=world-oceanInletStart[i].xy;
    float along=dot(p,delta)/len;
    float across=abs(p.x*delta.y-p.y*delta.x)/len;
    if(along>=0.&&along<=len&&across<=oceanInletStart[i].z) return true;
  }
  return false;
}`;
