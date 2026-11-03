/** Seeded, static normal stamps. Long overlapping patches preserve directional
 * patterns while varying coverage, phase, orientation, variant and wear.
 * Atlas variants occupy separate array slices, so repeat/mip filtering is safe.
 */
export const TERRAIN_STATIC_DETAIL_PARS = /* glsl */ `
uniform float uLayerDetailIndex[8];
uniform vec3 uLayerDetailUv[8]; // detail repeat XY, base normal strength
uniform vec4 uLayerDetailParams[8]; // strength, coverage, patch metres, seed
uniform vec4 uLayerDetailShape[8]; // direction, angular variation, roughness, atlas grid
float forgeDetailHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float forgeDetailNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(forgeDetailHash(i), forgeDetailHash(i+vec2(1,0)), f.x),
    mix(forgeDetailHash(i+vec2(0,1)), forgeDetailHash(i+vec2(1,1)), f.x), f.y);
}
mat2 forgeDetailRotation(float a) { float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
vec4 forgeStaticDetail(vec2 p, vec2 dx, vec2 dy, vec2 uvScale, float index, vec4 params, vec4 shape) {
  if (index < 0.0 || params.x <= 0.0 || params.y <= 0.0) return vec4(0,0,1,0);
  mat2 direction = forgeDetailRotation(shape.x);
  vec2 oriented = direction*p;
  vec2 span = vec2(params.z, params.z*3.0);
  vec2 cell = floor(oriented/span);
  vec2 selectedKey = vec2(0), selectedLocal = vec2(0);
  float bestWeight = 0.0;
  // Choose one coherent stamp before sampling. Averaging differently phased
  // structured normals erases the tread shapes, even though pixels change.
  // Every choice depends on terrain position and
  // seed only, never the tile slot, camera, frame time or paint rebuild order.
  for (int y=0; y<2; y++) for (int x=0; x<2; x++) {
    vec2 id = cell+vec2(float(x),float(y));
    vec2 key = id+vec2(params.w, params.w*.37);
    if (forgeDetailHash(key) >= params.y) continue;
    vec2 jitter = vec2(forgeDetailHash(key+17.0),forgeDetailHash(key+31.0))-.5;
    vec2 local = oriented-(id+jitter*.2)*span;
    vec2 edge = 1.0-smoothstep(vec2(.25),vec2(.85),abs(local/span));
    float weight = edge.x*edge.y;
    if (weight > bestWeight) { bestWeight=weight; selectedKey=key; selectedLocal=local; }
  }
  if (bestWeight <= .001) return vec4(0,0,1,0);
    vec2 key = selectedKey;
    float angle = (forgeDetailHash(key+9.0)*2.0-1.0)*shape.y;
    mat2 turn = forgeDetailRotation(angle);
    mat2 rotation = turn*direction;
    float sizeVariation = mix(.9,1.1,forgeDetailHash(key+43.0));
    vec2 scale = uvScale*sizeVariation;
    vec2 uv = (turn*selectedLocal)*scale+vec2(forgeDetailHash(key+51.0),forgeDetailHash(key+73.0));
    float variant = floor(forgeDetailHash(key+101.0)*shape.w*shape.w);
    vec3 n = normalize(textureGrad(uLayerNormalArray,vec3(uv,index+variant),
      (rotation*dx)*scale,(rotation*dy)*scale).xyz*2.0-1.0);
    // Rotate normal directions as well as UVs. Otherwise highlights rotate incorrectly.
    vec2 slope = transpose(rotation)*n.xy;
    float wear = mix(.5,1.0,forgeDetailNoise(oriented/vec2(1.7,3.1)+key));
    float fade = smoothstep(0.0,.25,bestWeight);
    vec2 slopes = slope/max(n.z,.2)*params.x*wear*fade;
    float relief = smoothstep(.025,.15,length(n.xy))*wear*fade;
  return vec4(normalize(vec3(slopes,1)), relief);
}
`;
