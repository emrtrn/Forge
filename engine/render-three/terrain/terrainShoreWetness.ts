import { DataArrayTexture, LinearFilter, RGFormat, Vector4, type DataTexture, type Object3D, type Scene } from "three";
import type { LayoutLakeWaterBody } from "../../scene/layout";
import { resolveLakeAppearance } from "../../scene/waterBody";
import type { LakeGeometry } from "../../terrain/terrainLakeWater";
import type { TerrainUniforms } from "./terrainMaterial";
import { createLakeFoamMask } from "../waterFoam";

const SIDE = 1024, MAX = 8;
interface Source { lake: LayoutLakeWaterBody; object: Object3D; mask: DataTexture; coverage: NonNullable<LakeGeometry["coverage"]> }
interface Registry { sources: Set<Source>; texture: DataArrayTexture | null; dirty: boolean }
const registries = new WeakMap<Scene, Registry>();

/** Presentation only. No paint weights, soil physics or save state is written. */
export function registerLakeShoreWetness(scene: Scene, lake: LayoutLakeWaterBody, geometry: LakeGeometry, object: Object3D): () => void {
  const a = resolveLakeAppearance(lake);
  if (!a.shoreWetnessEnabled || geometry.status !== "ready" || !geometry.coverage) return () => {};
  let registry = registries.get(scene);
  if (registry && registry.sources.size >= MAX) throw new Error("over-budget: at most eight wet Lake shores");
  const width = a.shoreWetnessWidth;
  const padded = { ...lake, bounds: { min: [lake.bounds.min[0] - width, lake.bounds.min[1] - width] as [number, number],
    max: [lake.bounds.max[0] + width, lake.bounds.max[1] + width] as [number, number] } };
  let mask: DataTexture;
  try { mask = createLakeFoamMask(padded, geometry, width); }
  catch (error) { throw new Error(`Wet shore: ${error instanceof Error ? error.message : String(error)}`); }
  if (!registry) { registry = { sources: new Set(), texture: null, dirty: true }; registries.set(scene, registry); }
  const source = { lake, object, mask, coverage: geometry.coverage }; registry.sources.add(source); registry.dirty = true;
  let released = false;
  return () => {
    if (released) return; released = true;
    mask.dispose(); registry.sources.delete(source); registry.dirty = true;
    if (!registry.sources.size) { registry.texture?.dispose(); registry.texture = null; registries.delete(scene); }
  };
}

export function createTerrainShoreWetnessUniforms() {
  return { uShoreWetMask: { value: null }, uShoreWetCount: { value: 0 },
    uShoreWetBounds: { value: Array.from({ length: MAX }, () => new Vector4()) },
    uShoreWetGrid: { value: Array.from({ length: MAX }, () => new Vector4()) },
    uShoreWetRows: { value: Array.from({ length: MAX }, () => 0) },
    uShoreWetParams: { value: Array.from({ length: MAX }, () => new Vector4()) } };
}

export function updateTerrainShoreWetness(uniforms: TerrainUniforms, scene: Scene, terrainRef?: string): void {
  const registry = registries.get(scene);
  uniforms.uShoreWetCount!.value = registry?.sources.size ?? 0;
  if (!registry) { uniforms.uShoreWetMask!.value = null; return; }
  if (registry.dirty) {
    // R: filtered shore distance; G: exact packed connected-face flags.
    // texelFetch reads flags independently of the distance field resolution.
    const values = new Uint8Array(SIDE * SIDE * registry.sources.size * 2);
    for (let i = 0; i < values.length; i += 2) values[i] = 255;
    let layer = 0;
    for (const { mask, coverage } of registry.sources) {
      const { data, width, height } = mask.image;
      const start = layer * SIDE * SIDE * 2;
      for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) values[start + (z * SIDE + x) * 2] = data![z * width + x]!;
      for (let cell = 0; cell < coverage.nx * coverage.nz; cell++) {
        values[start + cell * 2 + 1] = coverage.triangles[cell * 2]! | (coverage.triangles[cell * 2 + 1]! << 1);
      }
      layer++;
    }
    registry.texture?.dispose(); registry.texture = new DataArrayTexture(values, SIDE, SIDE, registry.sources.size);
    registry.texture.format = RGFormat; registry.texture.minFilter = registry.texture.magFilter = LinearFilter;
    registry.texture.generateMipmaps = false; registry.texture.unpackAlignment = 1; registry.texture.needsUpdate = true;
    registry.texture.name = "LakeShoreWetness.distanceAndConnectedFaces"; registry.dirty = false;
  }
  uniforms.uShoreWetMask!.value = registry.texture;
  let i = 0;
  for (const { lake, object, mask, coverage } of registry.sources) {
    const a = resolveLakeAppearance(lake), w = a.shoreWetnessWidth;
    let visible = true; for (let p: Object3D | null = object; p; p = p.parent) visible &&= p.visible;
    const sizeX = lake.bounds.max[0] - lake.bounds.min[0] + 2 * w, sizeZ = lake.bounds.max[1] - lake.bounds.min[1] + 2 * w;
    (uniforms.uShoreWetGrid!.value as Vector4[])[i]!.set(...coverage.min, 1 / coverage.spacing, coverage.nx);
    (uniforms.uShoreWetRows!.value as number[])[i] = coverage.nz;
    (uniforms.uShoreWetBounds!.value as Vector4[])[i]!.set(lake.bounds.min[0] - w, lake.bounds.min[1] - w, sizeX, sizeZ);
    (uniforms.uShoreWetParams!.value as Vector4[])[i]!.set(mask.image.width, mask.image.height, lake.surfaceLevel,
      visible && (!terrainRef || terrainRef === lake.terrainRef) ? a.shoreWetnessStrength : 0);
    i++;
  }
}

export const TERRAIN_SHORE_WETNESS_PARS = /* glsl */ `
uniform highp sampler2DArray uShoreWetMask;
uniform int uShoreWetCount;
uniform vec4 uShoreWetBounds[8];
uniform vec4 uShoreWetParams[8];
uniform vec4 uShoreWetGrid[8];
uniform float uShoreWetRows[8];
float forgeShoreWetness() {
  if(uTerrainView>.5) return 0.;
  float wet=0.;
  #if FORGE_TERRAIN_WET_SHORES > 0
  for(int i=0;i<8;i++) {
    if(i>=uShoreWetCount) break;
    vec4 bounds=uShoreWetBounds[i], p=uShoreWetParams[i];
    vec2 uv=(vCausticWorld.xz-bounds.xy)/bounds.zw;
    float above=vCausticWorld.y-p.z;
    if(p.w>0. && above<.35 && all(greaterThanEqual(uv,vec2(0.))) && all(lessThanEqual(uv,vec2(1.)))) {
      vec2 texel=clamp(uv*p.xy,vec2(.5),p.xy-.5)/1024.;
      float distance=texture(uShoreWetMask,vec3(texel,float(i))).r;
      vec4 grid=uShoreWetGrid[i];
      vec2 source=(vCausticWorld.xz-grid.xy)*grid.z;
      ivec2 cell=ivec2(floor(source));
      bool submerged=false;
      if(above<0. && cell.x>=0 && cell.y>=0 && float(cell.x)<grid.w && float(cell.y)<uShoreWetRows[i]) {
        int index=cell.y*int(grid.w)+cell.x;
        int faces=int(round(texelFetch(uShoreWetMask,ivec3(index%1024,index/1024,i),0).g*255.));
        vec2 f=fract(source);
        int face=f.x+f.y<=1.?1:2;
        submerged=(faces & face)!=0;
      }
      float edge=1.-smoothstep(0.,1.,distance);
      float height=1.-smoothstep(.08,.35,above);
      // Every connected underwater face is fully wet, independent of shore
      // distance/depth. Unconnected basins below the water level stay unchanged.
      float coverage=submerged?1.:(above>=0.?edge*height:0.);
      wet=max(wet,coverage*p.w);
    }
  }
  #endif
  return wet;
}
float forgeShoreWet = 0.;
`;
