/** Multiscale presentation normals. The mesh and exact shoreline stay flat.
 * Reuses the authored normal map; the third tap adds fine capillary detail. */
export const LAKE_SURFACE_GLSL = /* glsl */ `
uniform float surfaceStrength;
uniform float surfaceRoughness;
vec2 lakeSurfaceSlopes(vec2 p, float t) {
  // Derivatives precede the texture/visibility branches: fine ripples fade
  // rather than aliasing into stripes when the camera pulls away.
  float footprint=max(length(dFdx(p)),length(dFdy(p)));
  float fine=1.-smoothstep(.004,.02,footprint);
  mat2 turn=mat2(.8,.6,-.6,.8);
  vec2 a=texture2D(normalMap,p+t*vec2(.035,.022)).xy*2.-1.;
  vec2 b=texture2D(normalMap,turn*p*1.61-t*vec2(.021,.029)+vec2(.31,.17)).xy*2.-1.;
  vec2 c=texture2D(normalMap,p*9.31+t*vec2(-.051,.037)+vec2(.73,.29)).xy*2.-1.;
  // Rotate sampled slopes back into the world frame as well as rotating UVs.
  vec2 mapped=(a*.5+vec2(.8*b.x+.6*b.y,-.6*b.x+.8*b.y)*.3+c*.2*fine)*hasNormal;
  // Warp phase as well as amplitude; straight interfering sinusoids otherwise
  // form a visible diamond lattice, especially in the far sun reflection.
  vec2 warp=vec2(waterNoise(p*1.7+t*vec2(.021,-.017)),
    waterNoise(p*1.91+vec2(7.3,11.7)-t*vec2(.013,.019)))-.5;
  float packet0=.35+.65*waterNoise(p*3.7+t*vec2(.019,-.013));
  float packet1=.3+.7*waterNoise(p*4.1+vec2(13.2,5.7)-t*vec2(.011,.023));
  float w0=dot(p,vec2(17.1,8.7))+t*.83+warp.x*4.;
  float w1=dot(p,vec2(-11.3,24.2))-t*1.07+warp.y*4.7;
  float w2=dot(p,vec2(83.7,-57.1))+t*1.91+dot(warp,vec2(2.3,2.7));
  vec2 waves=vec2(.891,.454)*cos(w0)*.38*packet0+vec2(-.423,.906)*cos(w1)*.17*packet1;
  waves+=vec2(.826,-.564)*cos(w2)*.24*fine*sqrt(packet0*packet1);
  return (mapped+waves*(1.-smoothstep(.04,.16,footprint)))*surfaceStrength;
}
float lakeFilteredRoughness(vec3 normal) {
  vec3 dx=dFdx(normal),dy=dFdy(normal);
  // Widen unresolved specular lobes instead of producing subpixel glitter.
  float variance=min(.15,.5*(dot(dx,dx)+dot(dy,dy)));
  return clamp(sqrt(surfaceRoughness*surfaceRoughness+variance),.04,1.);
}
vec3 lakeSunGlint(vec3 normal,vec3 viewDirection,float roughness,float visibility) {
  vec3 halfDirection=normalize(viewDirection+waterSunDirection+vec3(.00001));
  float exponent=clamp(2./max(pow(roughness,4.),.00001)-2.,24.,1600.);
  float highlight=pow(max(0.,dot(normal,halfDirection)),exponent);
  return waterSunColor*highlight*.12*visibility*waterLightingEnabled;
}
`;
