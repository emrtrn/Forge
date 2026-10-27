/** Shared optics, while river flow and lake motion remain separate. */
export const WATER_OPTICS_GLSL = /* glsl */ `
float waterHash(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}
float waterNoise(vec2 point) {
  vec2 cell = floor(point), local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  return mix(mix(waterHash(cell), waterHash(cell + vec2(1.0, 0.0)), local.x),
    mix(waterHash(cell + vec2(0.0, 1.0)), waterHash(cell + vec2(1.0)), local.x), local.y);
}
float waterFresnel(float viewCosine) {
  return 0.02 + 0.98 * pow(1.0 - clamp(viewCosine, 0.0, 1.0), 5.0);
}
// Snell: the ray inside water never has the air-side grazing cosine of zero.
float waterPath(float depth, float airCosine) {
  float waterCosine = sqrt(max(0.0, 1.0 - (1.0 - airCosine * airCosine) / (1.333 * 1.333)));
  return max(depth, 0.0) / max(waterCosine, 0.66);
}
float waterTransmission(float depth, float path, float visibility, float absorption) {
  float wetness = smoothstep(0.0, 0.35, depth);
  return mix(1.0, clamp(visibility, 0.0, 1.0), wetness) * exp(-path / max(absorption, 0.01));
}
// Straight-alpha output for a layered interface. Reflection must contribute R,
// not R * alpha: divide the accumulated surface radiance by the final coverage
// before the renderer performs its one SrcAlpha blend with the visible bed.
vec4 waterComposite(vec3 body, float bodyOpacity, vec3 reflection, float reflectance,
    vec3 foamColor, float foamCoverage, vec3 glint) {
  float r = clamp(reflectance, 0.0, 1.0);
  float b = (1.0 - r) * clamp(bodyOpacity, 0.0, 1.0);
  float f = clamp(foamCoverage, 0.0, 1.0);
  float alpha = f + (1.0 - f) * (r + b);
  vec3 radiance = f * foamColor + (1.0 - f) * (r * reflection + b * body + glint);
  return vec4(radiance / max(alpha, 0.00001), alpha);
}
`;
