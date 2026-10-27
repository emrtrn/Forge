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
`;
