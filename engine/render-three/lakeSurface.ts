/** Multiscale micro surface normals, layered over independent geometric waves.
 * Reuses the authored normal map; the third tap adds fine capillary detail. */
export const LAKE_SURFACE_GLSL = /* glsl */ `
uniform float surfaceStrength;
uniform float surfaceRoughness;
// Analytic gradient of 2D value noise: local ripple directions vary across
// both axes rather than repeating the phase of a few straight wave trains.
vec2 lakeRippleGradient(vec2 p) {
  vec2 cell=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);
  float a=waterHash(cell),b=waterHash(cell+vec2(1.,0.));
  float c=waterHash(cell+vec2(0.,1.)),d=waterHash(cell+vec2(1.));
  return vec2(mix(b-a,d-c,u.y)*du.x,mix(c-a,d-b,u.x)*du.y);
}
vec2 lakeSurfaceSlopes(vec2 p, float t) {
  // Derivatives precede the texture/visibility branches: fine ripples fade
  // rather than aliasing into stripes when the camera pulls away.
  float footprint=max(length(dFdx(p)),length(dFdy(p)));
  float fine=1.-smoothstep(.004,.02,footprint);
  mat2 turn=mat2(.8,.6,-.6,.8);
  vec2 warp=vec2(waterNoise(p*1.7+t*vec2(.021,-.017)),
    waterNoise(p*1.91+vec2(7.3,11.7)-t*vec2(.013,.019)))-.5;
  vec2 q=p+warp*.18;
  vec2 a=texture2D(normalMap,q+t*vec2(.035,.022)).xy*2.-1.;
  vec2 b=texture2D(normalMap,turn*q*1.61-t*vec2(.021,.029)+vec2(.31,.17)).xy*2.-1.;
  vec2 c=texture2D(normalMap,q*9.31+t*vec2(-.051,.037)+vec2(.73,.29)).xy*2.-1.;
  vec2 mapped=(a*.42+vec2(.8*b.x+.6*b.y,-.6*b.x+.8*b.y)*.34+c*.24*fine)*hasNormal;
  vec2 broad=lakeRippleGradient(q*6.3+t*vec2(.11,-.08));
  vec2 middle=lakeRippleGradient(turn*q*12.7-t*vec2(.13,.17)+vec2(8.3,2.7));
  middle=vec2(.8*middle.x+.6*middle.y,-.6*middle.x+.8*middle.y);
  vec2 small=lakeRippleGradient(q*43.7+t*vec2(-.19,.23)+vec2(3.1,9.7));
  vec2 waves=broad*.24+middle*.13+small*.075*fine;
  return (mapped+waves*(1.-smoothstep(.04,.16,footprint)))*surfaceStrength;
}
float lakeFilteredRoughness(vec3 normal) {
  return waterFilteredRoughness(normal,surfaceRoughness);
}
`;
