import { DataArrayTexture, LinearFilter, RGFormat, Vector4, type DataTexture, type Object3D, type Scene } from "three";
import type { LayoutLakeWaterBody } from "../../scene/layout";
import { resolveLakeAppearance } from "../../scene/waterBody";
import type { LakeGeometry } from "../../terrain/terrainLakeWater";
import type { TerrainUniforms } from "./terrainMaterial";
import { createLakeFoamMask, createLakeFoamMaskAsync } from "../waterFoam";
import type { CooperativeWork } from "../../core/cooperativeWork";
import type { ResolvedRiverWater } from "../../scene/riverWater";
import type { RiverSurfaceQuery } from "../../terrain/riverSurface";
import { riverShoreMask } from "./riverShoreMask";
import { terrainRiverSurfaceIndex } from "./terrainCaustics";

const SIDE = 1024, MAX = 8;
interface Source { id:string; terrainRef:string; level:number; width:number; strength:number;
  min:readonly number[]; max:readonly number[]; object:Object3D; mask:DataTexture;
  coverage?:NonNullable<LakeGeometry["coverage"]>; river?:{surface:RiverSurfaceQuery;low:number;range:number} }
interface Registry { sources: Set<Source>; texture: DataArrayTexture | null; dirty: boolean; layers: Source[] }
const registries = new WeakMap<Scene, Registry>();

/** Presentation only. No paint weights, soil physics or save state is written. */
export function assertLakeShoreCapacity(scene: Scene, replacing?: Object3D): void {
  const registry = registries.get(scene);
  if (registry && registry.sources.size - Number([...registry.sources].some(s => s.object === replacing)) >= MAX)
    throw new Error("over-budget: at most eight wet shores (Lake + River)");
}

function shoreBounds(lake: LayoutLakeWaterBody, width: number): LayoutLakeWaterBody {
  return { ...lake, bounds: { min: [lake.bounds.min[0] - width, lake.bounds.min[1] - width],
    max: [lake.bounds.max[0] + width, lake.bounds.max[1] + width] } };
}

export function prepareLakeShoreMask(lake: LayoutLakeWaterBody, geometry: LakeGeometry, work: CooperativeWork): Promise<DataTexture> {
  const width = resolveLakeAppearance(lake).shoreWetnessWidth;
  return createLakeFoamMaskAsync(shoreBounds(lake, width), geometry, width, work, "wet-shore");
}

export function registerLakeShoreWetness(scene: Scene, lake: LayoutLakeWaterBody, geometry: LakeGeometry, object: Object3D, prepared?: DataTexture | null): () => void {
  const a = resolveLakeAppearance(lake);
  if (!a.shoreWetnessEnabled || geometry.status !== "ready" || !geometry.coverage) return () => {};
  let registry = registries.get(scene);
  assertLakeShoreCapacity(scene);
  const width = a.shoreWetnessWidth;
  const padded = shoreBounds(lake, width);
  let mask: DataTexture;
  try { mask = prepared ?? createLakeFoamMask(padded, geometry, width); }
  catch (error) { throw new Error(`Wet shore: ${error instanceof Error ? error.message : String(error)}`); }
  if (!registry) { registry = { sources: new Set(), texture: null, dirty: true, layers: [] }; registries.set(scene, registry); }
  const source:Source = { id:`lake:${lake.id}`,terrainRef:lake.terrainRef,level:lake.surfaceLevel,width,strength:a.shoreWetnessStrength,
    min:padded.bounds.min,max:padded.bounds.max,object,mask,coverage:geometry.coverage };
  return registerShoreSource(scene,source,registry);
}

export function registerRiverShoreWetness(scene:Scene,water:ResolvedRiverWater,surface:RiverSurfaceQuery,object:Object3D):()=>void {
  if(!water.shoreWetness?.enabled)return ()=>{};
  assertLakeShoreCapacity(scene);
  const {width,strength}=water.shoreWetness,field=riverShoreMask(surface,width);
  let registry=registries.get(scene);
  if(!registry){registry={sources:new Set(),texture:null,dirty:true,layers:[]};registries.set(scene,registry);}
  return registerShoreSource(scene,{id:`river:${water.id}`,terrainRef:water.landscapeRef,level:surface.origin[1],width,strength,
    min:field.min,max:field.max,object,mask:field.texture,river:{surface,low:field.low,range:field.range}},registry);
}

function registerShoreSource(scene:Scene,source:Source,registry:Registry):()=>void {
  registry.sources.add(source);registry.dirty=true;
  let released = false;
  return () => {
    if (released) return; released = true;
    source.mask.dispose(); registry.sources.delete(source); registry.dirty = true;
    if (!registry.sources.size) { registry.texture?.dispose(); registry.texture = null; registries.delete(scene); }
  };
}

/**
 * The dry-side shore wetness the terrain shader shows at a world point (0..1),
 * mirroring `forgeShoreWetness` for ground at or above a Lake's level: shore
 * distance × height above the level × strength. Connected underwater faces are
 * the Lake's own query (`LakeSurfaceQuery`), so points below a level read 0.
 * Presentation only (wet tyre prints).
 */
export function terrainShoreWetnessAt(scene: Scene, x: number, y: number, z: number, terrainRef?: string, lakeId?: string): number {
  const registry = registries.get(scene);
  if (!registry || ![x, y, z].every(Number.isFinite)) return 0;
  const smooth = (edge0: number, edge1: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };
  let wet = 0;
  for (const source of registry.sources) {
    const {object,mask,river}=source;
    let visible = true; for (let p: Object3D | null = object; p; p = p.parent) visible &&= p.visible;
    if (!visible || (terrainRef && terrainRef !== source.terrainRef) || (lakeId && source.id!==`lake:${lakeId}`)) continue;
    const u=(x-source.min[0]!)/(source.max[0]!-source.min[0]!),v=(z-source.min[1]!)/(source.max[1]!-source.min[1]!);
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) continue;
    // Linear filtering between texel centres, clamped like the shader's lookup.
    const { data, width, height } = mask.image;
    const px = Math.max(0.5, Math.min(width - 0.5, u * width)) - 0.5, pz = Math.max(0.5, Math.min(height - 0.5, v * height)) - 0.5;
    const x0 = Math.floor(px), z0 = Math.floor(pz), x1 = Math.min(width - 1, x0 + 1), z1 = Math.min(height - 1, z0 + 1);
    const fx = px - x0, fz = pz - z0;
    const stride=river?4:1;
    const at = (cx: number, cz: number) => data![(cz * width + cx)*stride]! / 255;
    const distance = (at(x0, z0) * (1 - fx) + at(x1, z0) * fx) * (1 - fz) + (at(x0, z1) * (1 - fx) + at(x1, z1) * fx) * fz;
    const levelAt=(cx:number,cz:number)=>{const i=(cz*width+cx)*4;return river!.low+(data![i+1]!*256+data![i+2]!)/65535*river!.range;};
    const localLevel=river ? (levelAt(x0,z0)*(1-fx)+levelAt(x1,z0)*fx)*(1-fz)+(levelAt(x0,z1)*(1-fx)+levelAt(x1,z1)*fx)*fz : 0;
    const above=y-source.level-localLevel;
    if(above<0||above>=.35)continue;
    wet = Math.max(wet, (1 - smooth(0, 1, distance)) * (1 - smooth(0.08, 0.35, above)) * source.strength);
  }
  return wet;
}

export function createTerrainShoreWetnessUniforms() {
  return { uShoreWetMask: { value: null }, uShoreWetCount: { value: 0 },
    uShoreWetRiver:{value:Array.from({length:MAX},()=>new Vector4(-1,0,0,0))},
    uShoreWetBounds: { value: Array.from({ length: MAX }, () => new Vector4()) },
    uShoreWetGrid: { value: Array.from({ length: MAX }, () => new Vector4()) },
    uShoreWetRows: { value: Array.from({ length: MAX }, () => 0) },
    uShoreWetWidths: { value: Array.from({ length: MAX }, () => 1) },
    uShoreWetParams: { value: Array.from({ length: MAX }, () => new Vector4()) } };
}

export function updateTerrainShoreWetness(uniforms: TerrainUniforms, scene: Scene, terrainRef?: string): void {
  const registry = registries.get(scene);
  uniforms.uShoreWetCount!.value = registry?.sources.size ?? 0;
  if (!registry) { uniforms.uShoreWetMask!.value = null; return; }
  // Stable ids keep unchanged bodies in the same GPU layer when a replacement
  // is removed/re-added at the end of the source Set during a rebuild.
  const sources = registry.dirty ? [...registry.sources].sort((a, b) => a.id.localeCompare(b.id)) : registry.layers;
  if (registry.dirty) {
    // R: filtered shore distance; G: exact packed connected-face flags.
    // texelFetch reads flags independently of the distance field resolution.
    const resized = !registry.texture || registry.texture.image.depth !== sources.length;
    if (resized) {
      registry.texture?.dispose();
      registry.texture = new DataArrayTexture(new Uint8Array(SIDE * SIDE * sources.length * 2), SIDE, SIDE, sources.length);
      registry.texture.format = RGFormat; registry.texture.minFilter = registry.texture.magFilter = LinearFilter;
      registry.texture.generateMipmaps = false; registry.texture.unpackAlignment = 1;
      registry.texture.name = "LakeShoreWetness.distanceAndConnectedFaces";
    }
    const texture = registry.texture!, values = texture.image.data as Uint8Array;
    let layer = 0;
    for (const source of sources) {
      const index = layer++;
      if (!resized && registry.layers[index] === source) continue;
      const { mask, coverage } = source;
      const { data, width, height } = mask.image;
      const start = index * SIDE * SIDE * 2, end = start + SIDE * SIDE * 2;
      values.fill(0, start, end);
      for (let i = start; i < end; i += 2) values[i] = 255;
      if(source.river)values.set(data!,start); // RGBA bank data uses two RG texels; no new sampler/storage.
      else for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) values[start + (z * SIDE + x) * 2] = data![z * width + x]!;
      for (let cell = 0; coverage&&cell < coverage.nx * coverage.nz; cell++) {
        values[start + cell * 2 + 1] = coverage.triangles[cell * 2]! | (coverage.triangles[cell * 2 + 1]! << 1);
      }
      texture.addLayerUpdate(index);
    }
    texture.needsUpdate = true; registry.layers = sources; registry.dirty = false;
  }
  uniforms.uShoreWetMask!.value = registry.texture;
  let i = 0;
  for (const source of sources) {
    const {object,mask,coverage,river,width:w}=source;
    let visible = true; for (let p: Object3D | null = object; p; p = p.parent) visible &&= p.visible;
    const sizeX=source.max[0]!-source.min[0]!,sizeZ=source.max[1]!-source.min[1]!;
    if(coverage)(uniforms.uShoreWetGrid!.value as Vector4[])[i]!.set(...coverage.min, 1 / coverage.spacing, coverage.nx);
    (uniforms.uShoreWetRows!.value as number[])[i] = coverage?.nz??0;
    (uniforms.uShoreWetRiver!.value as Vector4[])[i]!.set(river?terrainRiverSurfaceIndex(scene,object):-1,river?.low??0,river?.range??0,river?1:0);
    (uniforms.uShoreWetWidths!.value as number[])[i] = w;
    (uniforms.uShoreWetBounds!.value as Vector4[])[i]!.set(source.min[0]!,source.min[1]!,sizeX,sizeZ);
    (uniforms.uShoreWetParams!.value as Vector4[])[i]!.set(mask.image.width, mask.image.height, source.level,
      visible && (!terrainRef || terrainRef === source.terrainRef) ? source.strength : 0);
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
uniform float uShoreWetWidths[8];
uniform vec4 uShoreWetRiver[8]; // shared surface index, local height min/range, River flag
vec2 forgeRiverShoreTexel(ivec2 cell,vec2 size,int layer) {
  cell=clamp(cell,ivec2(0),ivec2(size)-1);
  int index=(cell.y*int(size.x)+cell.x)*2;
  vec2 a=texelFetch(uShoreWetMask,ivec3(index%1024,index/1024,layer),0).rg;
  index++;
  float low=texelFetch(uShoreWetMask,ivec3(index%1024,index/1024,layer),0).r;
  return vec2(a.r,(a.g*256.+low)/257.);
}
float forgeShoreWet = 0.;
// The pooled film fades before the exact underwater cutoff. The soil and
// deformation remain wet/visible; only puddle shading uses this factor.
float forgeShorePuddleFade = 1.;
// 1 on a connected underwater face (set by forgeShoreWetness).
float forgeShoreSubmerged = 0.;
float forgeShoreWetness() {
  if(uTerrainView>.5) return 0.;
  float wet=0.;
  #if FORGE_TERRAIN_WET_SHORES > 0
  for(int i=0;i<8;i++) {
    if(i>=uShoreWetCount) break;
    vec4 bounds=uShoreWetBounds[i], p=uShoreWetParams[i];
    vec2 uv=(vCausticWorld.xz-bounds.xy)/bounds.zw;
    // The undented ground (vForgeDeformBaseY, terrainDeformation's pars): a
    // rut dipping below the level on a dry face would otherwise read as an
    // unconnected basin and drop to dry along that face's triangle edges.
    float above=vForgeDeformBaseY-p.z;
    if(p.w>0. && all(greaterThanEqual(uv,vec2(0.))) && all(lessThanEqual(uv,vec2(1.)))) {
      vec2 texel=clamp(uv*p.xy,vec2(.5),p.xy-.5)/1024.;
      float distance=texture(uShoreWetMask,vec3(texel,float(i))).r;
      vec4 grid=uShoreWetGrid[i];
      vec2 source=(vCausticWorld.xz-grid.xy)*grid.z;
      ivec2 cell=ivec2(floor(source));
      bool submerged=false;
      vec4 riverInfo=uShoreWetRiver[i];
      if(riverInfo.w>.5) {
        vec2 pixel=uv*p.xy-.5,f=fract(pixel);ivec2 q=ivec2(floor(pixel));
        vec2 bank=mix(mix(forgeRiverShoreTexel(q,p.xy,i),forgeRiverShoreTexel(q+ivec2(1,0),p.xy,i),f.x),
          mix(forgeRiverShoreTexel(q+ivec2(0,1),p.xy,i),forgeRiverShoreTexel(q+ivec2(1,1),p.xy,i),f.x),f.y);
        distance=bank.x;above=vForgeDeformBaseY-p.z-riverInfo.y-bank.y*riverInfo.z;
        #if FORGE_TERRAIN_RIVER_CAUSTICS > 0
        int r=int(riverInfo.x);
        if(r>=0) {
          vec4 riverGrid=uCausticGrid[r];
          float row=floor((vCausticWorld.z-riverGrid.y)*riverGrid.z);
          float level;vec2 flow;
          if(row>=0.&&row<uCausticArea[r].x&&riverCausticSample(vCausticWorld.xz,riverGrid,uCausticRiver[r],level,flow)) {
            above=vForgeDeformBaseY-(level+uCausticArea[r].y);submerged=above<0.;
          }
        }
        #endif
      } else if(above<0. && cell.x>=0 && cell.y>=0 && float(cell.x)<grid.w && float(cell.y)<uShoreWetRows[i]) {
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
      if(submerged && p.w>0.) forgeShoreSubmerged=1.;
      if(submerged) forgeShorePuddleFade=0.;
      else if(above>=0.) {
        // Distance is normalized by the authored wet-shore width. Fade over
        // 50 cm on shallow banks or 8 cm of elevation on steeper banks.
        // The undeformed height keeps the boundary stable as ruts deepen.
        float width=min(.5,uShoreWetWidths[i]);
        float fade=max(smoothstep(0.,width,distance*uShoreWetWidths[i]),smoothstep(0.,.08,above));
        forgeShorePuddleFade=min(forgeShorePuddleFade,fade);
      }
    }
  }
  #endif
  return wet;
}
`;
