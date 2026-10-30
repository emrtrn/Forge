import { DataTexture, FloatType, NearestFilter, NoColorSpace, RGBAFormat, Vector2, Vector3 } from "three";
import { RiverSurfaceQuery } from "../terrain/riverSurface";
import type { RiverWaterRibbonData } from "./riverWater";
import { RIVER_WAVE_GLSL } from "./riverWaves";

export const RIVER_REFRACTION_LIMITS = {
  vertices: 65536, triangles: 32768, references: 262144, candidates: 16, bytes: 8 * 1024 * 1024,
} as const;

/** Exact source triangles, not a rasterised wet mask. The existing spatial grid
 * only accelerates lookup; holes and signed dry-bed clipping stay barycentric.
 * One immutable float atlas per mesh, <=8 MiB CPU backing and <=8 MiB GPU data.
 * Reject a budget overflow explicitly rather than coarsening water coverage. */
export function createRiverRefractionSurface(data: RiverWaterRibbonData, query?: RiverSurfaceQuery) {
  const vertices = data.positions.length / 3, triangles = data.indices.length / 3;
  const limit = RIVER_REFRACTION_LIMITS;
  if (!Number.isInteger(vertices) || !Number.isInteger(triangles) || vertices < 3 || triangles < 1
    || vertices > limit.vertices || triangles > limit.triangles) throw new Error("River refraction vertex/triangle budget exceeded");
  for (const [values, length] of [[data.positions, vertices * 3], [data.bedDepths, vertices],
    [data.uvs, vertices * 2], [data.shoreDistances, vertices], [data.rapidness, vertices],
    [data.flowSpeedMultipliers, vertices]] as const) {
    if (values.length !== length || !values.every(Number.isFinite)) throw new Error("Invalid River refraction attributes");
  }
  if (data.indices.some(i => !Number.isInteger(i) || i < 0 || i >= vertices)) throw new Error("Invalid River refraction triangle index");
  const surface = query ?? new RiverSurfaceQuery(data);
  if (surface.data !== data) throw new Error("River refraction query must own the same ribbon");
  if (surface.triangles.length > limit.references) throw new Error("River refraction reference budget exceeded");
  for (let cell = 0; cell < surface.offsets.length - 1; cell++) {
    if (surface.offsets[cell + 1]! - surface.offsets[cell]! > limit.candidates) throw new Error("River refraction cell exceeds 16 candidate triangles");
  }
  const referenceBase = surface.nx * surface.nz;
  const triangleBase = referenceBase + Math.ceil(surface.triangles.length / 4);
  const vertexBase = triangleBase + triangles;
  const texels = vertexBase + vertices * 3;
  const width = Math.min(1024, texels), height = Math.ceil(texels / width);
  const bytes = width * height * 16;
  if (bytes > limit.bytes) throw new Error("River refraction atlas exceeds 8 MiB");
  const pixels = new Float32Array(width * height * 4);
  for (let cell = 0; cell < referenceBase; cell++) {
    pixels[cell * 4] = surface.offsets[cell]!;
    pixels[cell * 4 + 1] = surface.offsets[cell + 1]! - surface.offsets[cell]!;
  }
  pixels.set(surface.triangles, referenceBase * 4);
  for (let t = 0; t < triangles; t++) for (let k = 0; k < 3; k++) pixels[(triangleBase + t) * 4 + k] = data.indices[t * 3 + k]!;
  for (let v = 0; v < vertices; v++) {
    const i = (vertexBase + v * 3) * 4;
    pixels.set([data.positions[v * 3]!, data.positions[v * 3 + 1]!, data.positions[v * 3 + 2]!, data.bedDepths[v]!], i);
    pixels.set([data.uvs[v * 2]!, data.uvs[v * 2 + 1]!, data.shoreDistances[v]!, data.rapidness[v]!], i + 4);
    pixels[i + 8] = data.flowSpeedMultipliers[v]!;
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat, FloatType);
  texture.name = "River.refractionExactSurface";
  texture.colorSpace = NoColorSpace; texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false; texture.flipY = false; texture.needsUpdate = true;
  return { texture, bytes, size: new Vector2(width, height), min: new Vector2(...surface.min),
    grid: new Vector2(surface.nx, surface.nz), spacing: surface.spacing,
    bases: new Vector3(referenceBase, triangleBase, vertexBase) };
}

/** Screen offset/depth fallback follows Forge's lakeRefraction.ts, inspired by
 * Ultra-Water OceanSurface.js ce9248fa20afbdf63fd4c11709f68d7368aca0a0,
 * MIT, (c) 2026 Humpalumps; public/licenses/ultra-water.txt. River adds its own
 * exact moving-triangle atlas, local ray tests and colour-footprint guards. */
export const RIVER_REFRACTION_GLSL = /* glsl */ `
uniform sampler2D riverRefractionSurface;
uniform vec2 riverRefractionSize;
uniform vec2 riverRefractionMin;
uniform vec2 riverRefractionGrid;
uniform vec3 riverRefractionBases;
uniform float riverRefractionSpacing;
uniform float riverRefractionStrength;
uniform mat4 riverViewToLocal;
uniform mat4 riverLocalToView;
uniform float waveAmplitude;
uniform float waveLength;
${RIVER_WAVE_GLSL}
vec4 riverSurfaceTexel(float index) {
  return texture2D(riverRefractionSurface,
    (vec2(mod(index, riverRefractionSize.x), floor(index / riverRefractionSize.x)) + 0.5) / riverRefractionSize);
}
vec4 riverSurfaceVertex(float index) {
  float base = riverRefractionBases.z + index * 3.0;
  vec4 p = riverSurfaceTexel(base), a = riverSurfaceTexel(base + 1.0);
  p.y += riverVertexWave(a.xy, a.z, a.w, riverSurfaceTexel(base + 2.0).x, time, flowSpeed, waveAmplitude, waveLength);
  return p;
}
float riverRefractionFootprint(vec2 uv, vec3 seedView, vec3 normalView) {
  // Colour is bilinear while depth is nearest. Validate all four colour taps;
  // otherwise a valid bed depth can still blend an above-water rock silhouette.
  vec2 pixel = floor(uv * waterSceneSize - 0.5) + 0.5;
  for (int tap = 0; tap < 4; tap++) {
    vec2 corner = (pixel + vec2(mod(float(tap), 2.0), floor(float(tap) / 2.0))) / waterSceneSize;
    float depth = texture2D(waterSceneDepth, corner).r;
    if (abs(depth - mix(1.0, 0.0, waterSceneReversed)) < 0.000001) return 0.0;
    if (dot(normalView, seedView - waterScenePosition(corner, depth)) <= 0.02) return 0.0;
  }
  return 1.0;
}
float riverRefractionCandidate(vec2 uv, vec3 seedView, vec3 normalView, out float path) {
  path = 0.0;
  vec2 border = min(uv, vec2(1.0) - uv) * waterSceneSize;
  if (min(border.x, border.y) < 2.0) return 0.0;
  if (riverRefractionFootprint(uv, seedView, normalView) < 0.5) return 0.0;
  float depth = texture2D(waterSceneDepth, uv).r;
  if (abs(depth - mix(1.0, 0.0, waterSceneReversed)) < 0.000001) return 0.0;
  vec3 bedView = waterScenePosition(uv, depth);
  vec3 nearView = waterScenePosition(uv, mix(0.0, 1.0, waterSceneReversed));
  vec3 rayView = bedView - nearView;
  float denominator = dot(normalView, rayView);
  if (abs(denominator) < 0.00001) return 0.0;
  float guess = dot(normalView, seedView - nearView) / denominator;
  if (guess <= 0.0 || guess >= 1.0) return 0.0;
  vec3 predicted = (riverViewToLocal * vec4(nearView + rayView * guess, 1.0)).xyz;
  vec2 cell = floor((predicted.xz - riverRefractionMin) / riverRefractionSpacing);
  if (any(lessThan(cell, vec2(0.0))) || any(greaterThanEqual(cell, riverRefractionGrid))) return 0.0;
  vec2 range = riverSurfaceTexel(cell.y * riverRefractionGrid.x + cell.x).xy;
  vec3 origin = (riverViewToLocal * vec4(nearView, 1.0)).xyz;
  vec3 ray = mat3(riverViewToLocal) * rayView;
  float nearest = 1.0;
  for (int candidate = 0; candidate < 16; candidate++) {
    if (float(candidate) >= range.y) break;
    float reference = range.x + float(candidate);
    vec4 packed = riverSurfaceTexel(riverRefractionBases.x + floor(reference / 4.0));
    float component = mod(reference, 4.0);
    float triangle = component < 0.5 ? packed.x : component < 1.5 ? packed.y : component < 2.5 ? packed.z : packed.w;
    vec3 indices = riverSurfaceTexel(riverRefractionBases.y + triangle).xyz;
    vec4 a = riverSurfaceVertex(indices.x), b = riverSurfaceVertex(indices.y), c = riverSurfaceVertex(indices.z);
    vec3 e1 = b.xyz - a.xyz, e2 = c.xyz - a.xyz;
    vec3 p = cross(ray, e2);
    float det = dot(e1, p);
    if (abs(det) < 0.0000001) continue;
    vec3 delta = origin - a.xyz;
    float u = dot(delta, p) / det;
    if (u < 0.0 || u > 1.0) continue;
    vec3 q = cross(delta, e1);
    float v = dot(ray, q) / det;
    if (v < 0.0 || u + v > 1.0) continue;
    float t = dot(e2, q) / det;
    if (t <= 0.0 || t >= nearest) continue;
    if (a.w * (1.0 - u - v) + b.w * u + c.w * v <= 0.02) continue;
    vec3 hitView = (riverLocalToView * vec4(origin + ray * t, 1.0)).xyz;
    // Reject a disconnected level/crossing even when its XZ occupies this grid.
    float margin = 0.025 + abs(waveAmplitude) * 2.7 * length(riverLocalToView[1].xyz);
    if (abs(dot(normalView, hitView - seedView)) > margin) continue;
    if (dot(normalView, hitView - bedView) <= 0.02) continue;
    nearest = t;
    path = min(length(hitView - bedView), 100.0);
  }
  if (nearest >= 1.0) return 0.0;
  return smoothstep(2.0, 10.0, min(border.x, border.y));
}
void riverRefract(vec2 uv, vec3 opticalNormal, vec3 geometricNormal, vec3 shadingNormal, vec3 seedView,
  float edgeDepth, inout vec3 bedColor, inout float path) {
  if (riverRefractionStrength <= 0.0 || edgeDepth <= 0.02) return;
  vec3 normalView = normalize(mat3(viewMatrix) * geometricNormal);
  vec3 viewRay = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-seedView);
  float facing = dot(normalView, viewRay);
  if (facing <= 0.03) return;
  // Only micro slope bends the bed. A sloped but perfectly calm river stays calm.
  vec3 tilt = mat3(viewMatrix) * (opticalNormal - shadingNormal);
  vec2 projected = tilt.xy;
  if (!isOrthographic) projected -= seedView.xy / min(seedView.z, -0.001) * tilt.z;
  vec2 offset = projected * 0.06 * riverRefractionStrength * vec2(waterSceneSize.y / waterSceneSize.x, 1.0)
    * smoothstep(0.02, 0.35, edgeDepth) * clamp(path * 0.5, 0.0, 1.0) * smoothstep(0.03, 0.2, facing);
  float pixels = length(offset * waterSceneSize);
  offset *= min(1.0, 8.0 / max(pixels, 0.00001));
  if (pixels < 0.01) return;
  float candidatePath, midPath;
  float keep = riverRefractionCandidate(uv + offset * 0.5, seedView, normalView, midPath);
  if (keep <= 0.0) return;
  keep *= riverRefractionCandidate(uv + offset, seedView, normalView, candidatePath);
  if (keep <= 0.0) return;
  // A short screen offset must not jump between a rock face and a distant bed.
  float continuity = max(0.12, path * 0.25);
  if (abs(candidatePath - path) > continuity || abs(midPath - path) > continuity) return;
  bedColor = mix(bedColor, texture2D(waterSceneColor, uv + offset).rgb, keep);
  path = mix(path, candidatePath, keep);
}
`;
