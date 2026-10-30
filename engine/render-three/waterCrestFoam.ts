import { resolveWaterCrestFoam, type WaterCrestFoamSettings } from "../scene/waterCrestFoam";

export function createWaterCrestFoamUniforms(settings: WaterCrestFoamSettings, allowed: boolean) {
  const a = resolveWaterCrestFoam(settings);
  return { crestFoamStrength: { value: allowed && a.crestFoamEnabled ? a.crestFoamStrength : 0 },
    crestFoamThreshold: { value: a.crestFoamThreshold } };
}

/** Interpolated displacement is the one actually drawn, never absolute world Y
 * or micro-normal brightness. No history buffer, extra capture or wave model. */
export const WATER_CREST_FOAM_GLSL = /* glsl */ `
uniform float crestFoamStrength;
uniform float crestFoamThreshold;
varying vec2 vCrestWave;
float waterCrestFoam(vec2 p, float clock, float scale, float depth) {
  float amplitude=vCrestWave.y;
  float crest=max(0.,vCrestWave.x)/max(amplitude,.00001);
  float aa=max(fwidth(crest),.025);
  if(crestFoamStrength<=0. || amplitude<=.003) return 0.;
  float ridge=smoothstep(crestFoamThreshold-aa,min(1.01,crestFoamThreshold+.22)+aa,crest);
  // Tiny ripples and the pinned dry shoreline cannot become white sheets.
  float activity=smoothstep(.003,.035,amplitude)*smoothstep(.02,.18,depth);
  vec2 q=p/max(scale,.1);
  float pattern=waterNoise(q*2.7+clock*vec2(.09,-.07))*.65
    +waterNoise(q*7.1-clock*vec2(.05,.11)+vec2(3.7,8.1))*.35;
  float patches=smoothstep(.42,.72,pattern);
  return clamp(ridge*patches*activity*crestFoamStrength,0.,1.);
}
`;
