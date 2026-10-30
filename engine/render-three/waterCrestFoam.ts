import { resolveWaterCrestFoam, type WaterCrestFoamSettings } from "../scene/waterCrestFoam";

export function createWaterCrestFoamUniforms(settings: WaterCrestFoamSettings, allowed: boolean) {
  const a = resolveWaterCrestFoam(settings);
  return { crestFoamStrength: { value: allowed && a.crestFoamEnabled ? a.crestFoamStrength : 0 },
    crestFoamThreshold: { value: a.crestFoamThreshold } };
}

/** Whitecaps from the drawn geometric wave: `vCrestWave` is (displacement,
 * steepness |∇h|). Foam needs a steep face on the raised side, so gentle swell
 * of any height stays clear; Threshold maps 0–1 onto the steepness range
 * {@link crestFoamSteepness} (engine/scene/waterCrestFoam.ts). Never absolute
 * world Y or micro-normal brightness; no history buffer or extra capture. */
export const WATER_CREST_FOAM_GLSL = /* glsl */ `
uniform float crestFoamStrength;
uniform float crestFoamThreshold;
varying vec2 vCrestWave;
float waterCrestFoamDensity(float depth) {
  float limit=mix(.02,.12,clamp(crestFoamThreshold,0.,1.));
  float slope=vCrestWave.y;
  float aa=max(fwidth(slope),.002);
  float steep=smoothstep(limit-aa,limit*1.4+aa,slope);
  float crest=smoothstep(0.,.006,vCrestWave.x);
  // The pinned dry shoreline cannot become a white sheet.
  float activity=smoothstep(.02,.18,depth);
  return steep*crest*activity*max(crestFoamStrength,0.);
}
float waterCrestFoamPattern(float depth, float pattern) {
  return waterFoamErosion(waterCrestFoamDensity(depth),pattern);
}
float waterCrestFoam(vec2 p, float clock, float scale, float depth) {
  float pattern=waterFoamReady>.5 ? waterFoamDetail(p,clock,scale,.3).r
    : waterFoamFallbackPattern(p/max(scale,.1)*2.7,clock*vec2(.09,-.07),0.);
  // Whitecaps are sporadic: only some steep crests break at any moment.
  float gusts=mix(.25,1.,smoothstep(.3,.7,waterNoise(p*.11+clock*vec2(.02,-.015))));
  return waterFoamErosion(waterCrestFoamDensity(depth)*gusts,pattern);
}
`;
