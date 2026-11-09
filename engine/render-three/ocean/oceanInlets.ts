import { Vector4 } from "three";
import type { OceanInlet } from "../../terrain/oceanCoverage";

export function createOceanInletUniforms(inlets: readonly OceanInlet[] = []) {
  const uniforms = { oceanInletCount: { value: 0 },
    oceanInletStart: { value: Array.from({ length: 3 }, () => new Vector4()) },
    oceanInletEnd: { value: Array.from({ length: 3 }, () => new Vector4()) } };
  updateOceanInletUniforms(uniforms, inlets);
  return uniforms;
}

export function updateOceanInletUniforms(uniforms: ReturnType<typeof createOceanInletUniforms>, inlets: readonly OceanInlet[]) {
  const active = inlets.filter(inlet => inlet.active !== false);
  if (active.length > 3) throw new Error("Ocean supports at most three active inlet reaches");
  uniforms.oceanInletCount.value = active.length;
  for (let i = 0; i < 3; i++) {
    const inlet = active[i];
    // A local calm collar follows the live half-width, without changing ownership.
    // Leave a flat inner apron for the camera-anchored grid's edge triangles.
    const transition = inlet ? Math.max(8, Math.min(24, inlet.width * 1.5)) : 0;
    uniforms.oceanInletStart.value[i]!.set(...(inlet?.start ?? [0, 0]), inlet?.width ?? 0, transition);
    uniforms.oceanInletEnd.value[i]!.set(...(inlet?.end ?? [0, 0]), 0, 0);
  }
}

/** Same finite, constant-width reaches as the native CPU coverage query. */
export const OCEAN_INLETS_GLSL = /* glsl */ `
uniform int oceanInletCount;
uniform vec4 oceanInletStart[3];
uniform vec4 oceanInletEnd[3];
// Distance to the finite rectangle, including its sides and end-cap corners.
// The CPU/fragment exclusion remains exact; this only damps presentation outside it.
float oceanInletWaveWeight(vec2 world) {
  float weight=1.;
  for(int i=0;i<3;i++) {
    if(i>=oceanInletCount) break;
    vec2 delta=oceanInletEnd[i].xy-oceanInletStart[i].xy;
    float len=length(delta); vec2 p=world-oceanInletStart[i].xy;
    float along=dot(p,delta)/len;
    float across=abs(p.x*delta.y-p.y*delta.x)/len;
    vec2 outside=max(vec2(abs(along-len*.5)-len*.5,across-oceanInletStart[i].z),vec2(0.));
    float band=oceanInletStart[i].w;
    weight=min(weight,smoothstep(band*.25,band,length(outside)));
  }
  return weight;
}
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
