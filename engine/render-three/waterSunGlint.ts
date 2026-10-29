/** GGX sun and footprint-aware facets adapted from Ultra-Water OceanSurface.js
 * at ce9248fa20afbdf63fd4c11709f68d7368aca0a0, MIT, (c) 2026 Humpalumps.
 * See public/licenses/ultra-water.txt. No FFT, texture or history is required. */
export const WATER_SUN_GLINT_GLSL = /* glsl */ `
float waterFilteredRoughness(vec3 normal, float roughness) {
  vec3 dx = dFdx(normal), dy = dFdy(normal);
  float variance = min(0.15, 0.5 * (dot(dx, dx) + dot(dy, dy)));
  return clamp(sqrt(roughness * roughness + variance), 0.04, 1.0);
}
vec3 waterSunGlint(vec3 normal, vec3 viewDirection, float roughness, float sunVisibility) {
  float noV = dot(normal, viewDirection);
  float noL = max(dot(normal, waterSunDirection), 0.0);
  float nv = max(noV, 0.0001);
  vec3 halfDirection = normalize(viewDirection + waterSunDirection + vec3(0.00001));
  float noH = max(dot(normal, halfDirection), 0.0);
  // The authored value is perceptual roughness; GGX alpha is its square.
  // A finite sun footprint bounds the peak on otherwise perfectly calm water.
  float alpha = max(roughness * roughness, 0.045);
  float a2 = alpha * alpha;
  float denominator = noH * noH * (a2 - 1.0) + 1.0;
  float distribution = a2 / (3.141592654 * denominator * denominator);
  float masking = 0.5 / max(noL * sqrt(nv * nv * (1.0 - a2) + a2)
    + nv * sqrt(noL * noL * (1.0 - a2) + a2), 0.00001);
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(viewDirection, halfDirection), 0.0), 5.0);
  vec3 irradiance = waterSunColor;
  vec3 core = vec3(0.0);
  if (dot(waterSunDiscRadiance, vec3(1.0)) > 0.0) {
    // Sky's solar disc is much brighter than its directional light. Reflect
    // its linear HDR radiance so existing bloom can respond before tone mapping.
    // Split the energy between a soft finite disc and the broad GGX trail.
    const float sunRadius = 0.008;
    float radius = sunRadius + alpha * 0.25;
    float separation = distance(reflect(-viewDirection, normal), waterSunDirection);
    float edge = max(0.0015, radius * 0.3);
    float disc = 1.0 - smoothstep(radius - edge, radius + edge, separation);
    float coreWeight = 1.0 - smoothstep(0.04, 0.38, roughness);
    float interfaceFresnel = 0.02 + 0.98 * pow(1.0 - clamp(noV, 0.0, 1.0), 5.0);
    core = waterSunDiscRadiance * disc * interfaceFresnel * coreWeight
      * (sunRadius * sunRadius / (radius * radius));
    irradiance = waterSunDiscRadiance * (3.141592654 * sunRadius * sunRadius) * (1.0 - coreWeight);
  }
  return (core + irradiance * (distribution * masking * fresnel * noL))
    * step(0.0001, noV) * smoothstep(0.0, 0.025, waterSunDirection.y)
    * clamp(sunVisibility, 0.0, 1.0) * waterLightingEnabled;
}
float waterSunSparkle(vec3 worldPosition, float seconds, float detail) {
  // World-anchored cells at two pixel-footprint scales avoid a fixed glitter
  // grid. Interpolating levels and times keeps camera/time transitions smooth.
  vec2 footprint = fwidth(worldPosition.xz);
  if (detail <= 0.0) return 1.0;
  float pixelSize = max(max(footprint.x, footprint.y), 0.002);
  float level = log2(pixelSize * 2.0);
  float baseLevel = floor(level);
  float modulation = 0.0;
  for (int i = 0; i < 2; i++) {
    float lod = baseLevel + float(i);
    vec2 cell = floor(worldPosition.xz / exp2(lod));
    float clock = seconds * 1.4 + waterHash(cell + lod * 17.17) * 32.0;
    float tick = floor(clock);
    float a = waterHash(cell * 1.31 + tick * 3.7 + lod);
    float b = waterHash(cell * 1.31 + (tick + 1.0) * 3.7 + lod);
    // Interpolate the bounded facet brightness, rather than its random seed.
    // Mean brightness is one for uniform hashes; no rare, unbounded flashes.
    float brightness = mix(0.65 + 1.05 * a * a, 0.65 + 1.05 * b * b,
      smoothstep(0.0, 1.0, fract(clock)));
    modulation += brightness * (i == 0 ? 1.0 - fract(level) : fract(level));
  }
  float distanceToEye = length(cameraPosition - worldPosition);
  float amount = clamp(detail, 0.0, 1.0) * smoothstep(2.0, 12.0, distanceToEye)
    * (1.0 - smoothstep(0.05, 0.4, pixelSize));
  return mix(1.0, modulation, amount * 0.7);
}
`;
