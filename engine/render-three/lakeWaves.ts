import { Vector4 } from "three";
import { LAKE_WAVE_COMPONENTS, type LakeWaveParameters } from "../terrain/lakeWaves";

export function createLakeWaveUniforms(parameters: LakeWaveParameters) {
  return { surfaceWaveTime: { value: 0 }, surfaceWaveHeight: { value: parameters.height },
    surfaceWaveShoreDepth: { value: parameters.shoreDepth },
    surfaceWaveComponents: { value: parameters.components.map(c => new Vector4(...c)) } };
}
export const LAKE_WAVES_GLSL = /* glsl */ `
uniform float surfaceWaveTime;
uniform float surfaceWaveHeight;
uniform float surfaceWaveShoreDepth;
uniform vec4 surfaceWaveComponents[3];
vec3 lakeWaveSample(vec2 localPosition,float depth,vec2 depthSlope) {
  if(surfaceWaveHeight<=0. || depth<=0.) return vec3(0.);
  float t=clamp(depth/surfaceWaveShoreDepth,0.,1.);
  float fade=t*t*(3.-2.*t),limit=min(surfaceWaveHeight,depth*.25);
  float gain=limit*fade;
  float gainDerivative=(depth*.25<surfaceWaveHeight?.25:0.)*fade+limit*6.*t*(1.-t)/surfaceWaveShoreDepth;
  float wave=0.;vec2 slope=vec2(0.);
  ${LAKE_WAVE_COMPONENTS.map((c, i) => `float phase${i}=dot(localPosition,surfaceWaveComponents[${i}].xy)-surfaceWaveTime*surfaceWaveComponents[${i}].z+surfaceWaveComponents[${i}].w;
  wave+=sin(phase${i})*${c[4].toFixed(2)};slope+=cos(phase${i})*${c[4].toFixed(2)}*surfaceWaveComponents[${i}].xy;`).join("\n")}
  return vec3(wave*gain,slope*gain+wave*gainDerivative*depthSlope);
}
float lakeWaveOffset(vec2 localPosition,float depth) {
  return lakeWaveSample(localPosition,depth,vec2(0.)).x;
}
`;
