import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType, Vector2, Vector4, type Object3D, type Scene } from "three";
import type { LayoutLakeWaterBody } from "../../scene/layout";
import { resolveLakeAppearance } from "../../scene/waterBody";
import type { LakeGeometry } from "../../terrain/terrainLakeWater";
import type { TerrainUniforms } from "./terrainMaterial";
import { terrainCausticPattern } from "./terrainCausticPattern";

const SIDE = 256, MAX_BODIES = 8;
interface Source { lake: LayoutLakeWaterBody; coverage: NonNullable<LakeGeometry["coverage"]>; object: Object3D }
interface Registry { sources: Map<Object3D, Source>; texture: DataArrayTexture | null; dirty: boolean }
const registries = new WeakMap<Scene, Registry>();

/** Two exact connected-face flags per terrain cell. No raster edge leakage. */
export function lakeCausticsContains(coverage: NonNullable<LakeGeometry["coverage"]>, x: number, z: number): boolean {
  const gx = (x - coverage.min[0]) / coverage.spacing, gz = (z - coverage.min[1]) / coverage.spacing;
  const ix = Math.floor(gx), iz = Math.floor(gz);
  if (ix < 0 || iz < 0 || ix >= coverage.nx || iz >= coverage.nz) return false;
  return coverage.triangles[(iz * coverage.nx + ix) * 2 + (gx - ix + gz - iz <= 1 ? 0 : 1)] === 1;
}

export function registerLakeCaustics(scene: Scene, lake: LayoutLakeWaterBody, geometry: LakeGeometry, object: Object3D): () => void {
  if (geometry.status !== "ready" || !geometry.coverage || !resolveLakeAppearance(lake).causticsEnabled) return () => {};
  let registry = registries.get(scene);
  if (!registry) { registry = { sources: new Map(), texture: null, dirty: true }; registries.set(scene, registry); }
  // The persistent level validator bounds Lakes to eight. Refuse additional preview owners.
  if (registry.sources.size >= MAX_BODIES) return () => {};
  registry.sources.set(object, { lake, coverage: geometry.coverage, object }); registry.dirty = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    registry.sources.delete(object); registry.dirty = true;
    if (!registry.sources.size) { registry.texture?.dispose(); registry.texture = null; registries.delete(scene); }
  };
}

export function createTerrainCausticsUniforms() {
  return { uCausticMask: { value: null }, uCausticCount: { value: 0 }, uCausticTime: { value: 0 },
    uCausticGrid: { value: Array.from({ length: MAX_BODIES }, () => new Vector4()) },
    uCausticArea: { value: Array.from({ length: MAX_BODIES }, () => new Vector4()) },
    uCausticMotion: { value: Array.from({ length: MAX_BODIES }, () => new Vector2()) } };
}

export function updateTerrainCaustics(uniforms: TerrainUniforms, scene: Scene, terrainRef?: string): void {
  const registry = registries.get(scene);
  uniforms.uCausticCount!.value = registry?.sources.size ?? 0;
  uniforms.uCausticTime!.value = performance.now() / 1000;
  if (!registry) { uniforms.uCausticMask!.value = null; return; }
  if (registry.dirty) {
    // RG: exact face flags; BA: shared original light/warp tile. The masks use
    // texelFetch at level zero, while animated patterns use filtered mip levels.
    const data = new Uint8Array(SIDE * SIDE * 4 * registry.sources.size), pattern = terrainCausticPattern();
    let layer = 0;
    for (const { coverage } of registry.sources.values()) {
      const start = layer++ * SIDE * SIDE * 4;
      for (let cell = 0; cell < SIDE * SIDE; cell++) {
        const offset = start + cell * 4;
        data[offset] = coverage.triangles[cell * 2] ?? 0;
        data[offset + 1] = coverage.triangles[cell * 2 + 1] ?? 0;
        data[offset + 2] = pattern[cell * 2]!; data[offset + 3] = pattern[cell * 2 + 1]!;
      }
    }
    registry.texture?.dispose();
    registry.texture = new DataArrayTexture(data, SIDE, SIDE, registry.sources.size);
    registry.texture.format = RGBAFormat; registry.texture.type = UnsignedByteType;
    registry.texture.wrapS = registry.texture.wrapT = RepeatWrapping;
    registry.texture.minFilter = LinearMipmapLinearFilter; registry.texture.magFilter = LinearFilter;
    registry.texture.generateMipmaps = true; registry.texture.needsUpdate = true;
    registry.texture.name = "LakeCaustics.connectedFaces"; registry.dirty = false;
  }
  uniforms.uCausticMask!.value = registry.texture;
  let i = 0;
  for (const { lake, coverage, object } of registry.sources.values()) {
    const a = resolveLakeAppearance(lake);
    let visible = true;
    for (let parent: Object3D | null = object; parent; parent = parent.parent) visible &&= parent.visible;
    (uniforms.uCausticGrid!.value as Vector4[])[i]!.set(...coverage.min, 1 / coverage.spacing, coverage.nx);
    (uniforms.uCausticArea!.value as Vector4[])[i]!.set(coverage.nz, lake.surfaceLevel, visible && (!terrainRef || lake.terrainRef === terrainRef) ? a.causticsStrength : 0, a.causticsScale);
    (uniforms.uCausticMotion!.value as Vector2[])[i]!.set(a.causticsSpeed, a.causticsDepthFade);
    i++;
  }
}

export const TERRAIN_CAUSTICS_VERTEX_PARS = /* glsl */ `varying vec3 vCausticWorld;`;
export const TERRAIN_CAUSTICS_VERTEX = /* glsl */ `vCausticWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
export const TERRAIN_CAUSTICS_PARS = /* glsl */ `
uniform highp sampler2DArray uCausticMask;
uniform int uCausticCount;
uniform float uCausticTime;
uniform vec4 uCausticGrid[8]; // world min XZ, inverse spacing, cells X
uniform vec4 uCausticArea[8]; // cells Z, world surface Y, strength, pattern metres
uniform vec2 uCausticMotion[8]; // speed, extinction depth
varying vec3 vCausticWorld;
float forgeCausticFootprint = 0.0;

// Evolve two filtered light networks with a moving warp. Explicit LOD keeps
// derivatives outside divergent mask/body branches and avoids repeated SFU work.
float forgeCausticPattern(vec2 p, float t, int layer, float scale) {
  float lod = max(0.0, log2(max(1.0, forgeCausticFootprint * 256.0 / scale)));
  vec2 drift = t * vec2(0.027, 0.019);
  vec2 warp = vec2(textureLod(uCausticMask, vec3(fract(p * 0.61 + drift), layer), lod).a,
    textureLod(uCausticMask, vec3(fract(p.yx * 0.83 - drift + 0.37), layer), lod).a) - 0.5;
  vec2 uv = p + warp * 0.24;
  float a = textureLod(uCausticMask, vec3(fract(uv + drift), layer), lod).b;
  float b = textureLod(uCausticMask, vec3(fract(vec2(-uv.y, uv.x) * 1.37 - drift + 0.61), layer), lod).b;
  return max(a, b * 0.75);
}
float forgeCausticLight(vec3 sun) {
  if (uCausticCount == 0 || uTerrainView > 0.5 || sun.y < 0.05) return 0.0;
  float result = 0.0;
  ${Array.from({ length: MAX_BODIES }, (_, i) => `
  #if FORGE_TERRAIN_CAUSTIC_BODIES > ${i}
  if (uCausticCount > ${i}) {
    vec4 grid = uCausticGrid[${i}], area = uCausticArea[${i}];
    vec2 p = (vCausticWorld.xz - grid.xy) * grid.z;
    ivec2 cell = ivec2(floor(p));
    float depth = area.y - vCausticWorld.y;
    if (area.z > 0.0 && depth > 0.0 && cell.x >= 0 && cell.y >= 0 && float(cell.x) < grid.w && float(cell.y) < area.x) {
    int index = cell.y * int(grid.w) + cell.x;
    vec2 faces = texelFetch(uCausticMask, ivec3(index % 256, index / 256, ${i}), 0).rg;
    vec2 f = fract(p);
    if ((f.x + f.y <= 1.0 ? faces.r : faces.g) >= 0.001) {
    vec2 motion = uCausticMotion[${i}];
    // Project along the refracted sun direction (IOR ~1.33); near-horizon
    // inputs remain bounded. The world position anchors all tile seams.
    vec2 refracted = -sun.xz / 1.333;
    vec2 samplePosition = vCausticWorld.xz - refracted * depth / sqrt(max(0.01, 1.0 - dot(refracted, refracted)));
    float pattern = forgeCausticPattern(samplePosition / area.w, uCausticTime * motion.x, ${i}, area.w);
    float fade = smoothstep(0.0, 0.12, depth) * exp(-depth / motion.y) * smoothstep(0.05, 0.3, sun.y);
    result = max(result, pattern * fade * area.z);
    }
    }
  }
  #endif`).join("\n")}
  return result;
}
// Preserve <lights_fragment_begin>: the cascaded sun binder patches that include
// after the terrain callback. Its shadow factor then attenuates this irradiance.
#if NUM_DIR_LIGHTS > 0
float forgeCausticPreparedLight = 0.0;
vec3 forgeCausticSunDirection = vec3(0.0);
void forgePrepareCaustics() {
  if (uCausticCount == 0 || uTerrainView > 0.5) return;
  forgeCausticFootprint = max(length(dFdx(vCausticWorld)), length(dFdy(vCausticWorld)));
  // Select the dominant directional source. CSM's copies have the same colour
  // and direction. Prepare one field outside the light loop; a cache inside
  // that loop can still be flattened by GPU compilers.
  float brightest = 0.0;
  float energy;
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
    energy = dot(directionalLights[ i ].color, vec3(0.2126, 0.7152, 0.0722));
    if (energy > brightest) {
      brightest = energy;
      forgeCausticSunDirection = inverseTransformDirection(directionalLights[ i ].direction, viewMatrix);
    }
  }
  #pragma unroll_loop_end
  if (brightest > 0.0) forgeCausticPreparedLight = forgeCausticLight(forgeCausticSunDirection);
}
void forgeCausticDirectionalLightInfo(const in DirectionalLight light, out IncidentLight incident) {
  getDirectionalLightInfo(light, incident);
  vec3 delta = inverseTransformDirection(incident.direction, viewMatrix) - forgeCausticSunDirection;
  if (dot(delta, delta) < 0.00000001) incident.color *= 1.0 + forgeCausticPreparedLight;
}
#define getDirectionalLightInfo forgeCausticDirectionalLightInfo
#else
void forgePrepareCaustics() {}
#endif
`;
