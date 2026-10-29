import { ClampToEdgeWrapping, DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector4 } from "three";
import { WATER_CONTACT_FOAM_LIMIT, type WaterContactFoam } from "../scene/waterContactFoam";
import type { LayoutLakeWaterBody } from "../scene/layout";
import type { LakeGeometry } from "../terrain/terrainLakeWater";
import { CooperativeWork, finishWork } from "../core/cooperativeWork";

/** Bounded distance-to-real-shore field, including islands. Local coordinates
 * keep large origins out of the distance calculation. No per-frame generation. */
export function createLakeFoamMask(lake: LayoutLakeWaterBody, data: LakeGeometry, width: number) {
  return createWaterShoreMask([lake.bounds.min[0] - data.position[0], lake.bounds.min[1] - data.position[2]],
    [lake.bounds.max[0] - data.position[0], lake.bounds.max[1] - data.position[2]], data.shore, width);
}

export function createLakeFoamMaskAsync(lake: LayoutLakeWaterBody, data: LakeGeometry, width: number, work: CooperativeWork, phase = "shore-foam") {
  return work.run(phase, waterShoreMaskSteps([lake.bounds.min[0] - data.position[0], lake.bounds.min[1] - data.position[2]],
    [lake.bounds.max[0] - data.position[0], lake.bounds.max[1] - data.position[2]], data.shore, width));
}

/** Same metre-scale distance field for Lake contours and River wet/dry contours.
 * Ribbon edges and terrain holes are deliberately not contact segments. */
export function createWaterShoreMask(min: readonly number[], max: readonly number[], shore: ArrayLike<number>, width: number) {
  return finishWork(waterShoreMaskSteps(min, max, shore, width));
}

function* waterShoreMaskSteps(min: readonly number[], max: readonly number[], shore: ArrayLike<number>, width: number): Generator<void, DataTexture> {
  const extent = [max[0]! - min[0]!, max[1]! - min[1]!];
  if (!Number.isFinite(width) || width <= 0 || extent.some(v => !Number.isFinite(v) || v <= 0)) throw new Error("Invalid Lake foam dimensions");
  const nx = Math.ceil(extent[0]! / (width / 4)), nz = Math.ceil(extent[1]! / (width / 4));
  // Four texels across the authored band, at most 1 MiB per enabled Lake.
  // Refuse an undersampled band rather than silently widening the foam.
  if (nx < 1 || nz < 1 || nx > 1024 || nz > 1024) throw new Error("over-budget: Lake foam needs a wider band or smaller calculation bounds (1024 texels per axis)");
  const values = new Uint8Array(nx * nz); values.fill(255);
  const ox = min[0]!, oz = min[1]!;
  const sx = extent[0]! / nx, sz = extent[1]! / nz;
  let work = 0, samples = 0;
  for (let i = 0; i < shore.length; i += 4) {
    const ax = shore[i]!, az = shore[i + 1]!, bx = shore[i + 2]!, bz = shore[i + 3]!;
    const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - width - ox) / sx));
    const x1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + width - ox) / sx));
    const z0 = Math.max(0, Math.floor((Math.min(az, bz) - width - oz) / sz));
    const z1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz) + width - oz) / sz));
    work += Math.max(0, x1 - x0 + 1) * Math.max(0, z1 - z0 + 1);
    if (work > 16_777_216) throw new Error("over-budget: water contact mask work exceeds 16M samples");
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const px = ox + (x + 0.5) * sx - ax, pz = oz + (z + 0.5) * sz - az;
      const t = length2 > 0 ? Math.max(0, Math.min(1, (px * dx + pz * dz) / length2)) : 0;
      const value = Math.min(255, Math.round(Math.hypot(px - t * dx, pz - t * dz) / width * 255));
      const index = z * nx + x; values[index] = Math.min(values[index]!, value);
      if ((++samples & 255) === 0) yield;
    }
    if ((i & 255) === 0) yield;
  }
  const texture = new DataTexture(values, nx, nz, RedFormat, UnsignedByteType);
  texture.name = "LakeFoam.shoreDistance"; texture.minFilter = texture.magFilter = LinearFilter;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping; texture.generateMipmaps = false;
  texture.unpackAlignment = 1; texture.needsUpdate = true;
  return texture;
}

/** Bake zero-depth segments from actual bed samples, retaining negative depths.
 * Only wet/dry crossings count: a wholly submerged ribbon has no shore foam. */
export function riverContactSegments(positions: readonly number[], depths: readonly number[], indices: readonly number[]): number[] {
  const shore: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const ids = indices.slice(i, i + 3);
    if (!ids.some(id => depths[id]! > 0) || !ids.some(id => depths[id]! <= 0)) continue;
    const points: number[][] = [];
    for (let edge = 0; edge < 3; edge++) {
      const a = ids[edge]!, b = ids[(edge + 1) % 3]!, da = depths[a]!, db = depths[b]!;
      if ((da > 0) === (db > 0)) continue;
      const t = da / (da - db);
      points.push([positions[a * 3]! + (positions[b * 3]! - positions[a * 3]!) * t,
        positions[a * 3 + 2]! + (positions[b * 3 + 2]! - positions[a * 3 + 2]!) * t]);
    }
    if (points.length === 2) shore.push(...points[0]!, ...points[1]!);
  }
  return shore;
}

/** Bounded build-time gate: dry/outside/hole sources cannot cast wakes into water. */
export function riverContactSettings(settings: WaterContactFoam | undefined, positions: readonly number[], depths: readonly number[], indices: readonly number[]): WaterContactFoam | undefined {
  if (!settings?.enabled) return settings;
  return { ...settings, obstacles: settings.obstacles.filter(o => {
    for (let i=0; i<indices.length; i+=3) {
      const a=indices[i]!*3, b=indices[i+1]!*3, c=indices[i+2]!*3;
      const bx=positions[b]!-positions[a]!, bz=positions[b+2]!-positions[a+2]!;
      const cx=positions[c]!-positions[a]!, cz=positions[c+2]!-positions[a+2]!;
      const dx=o.position[0]-positions[a]!, dz=o.position[2]-positions[a+2]!, det=bx*cz-bz*cx;
      if (Math.abs(det)<1e-12) continue;
      const u=(dx*cz-dz*cx)/det, v=(bx*dz-bz*dx)/det;
      if (u<0 || v<0 || u+v>1) continue;
      const depth=depths[a/3]!*(1-u-v)+depths[b/3]!*u+depths[c/3]!*v;
      const level=positions[a+1]!*(1-u-v)+positions[b+1]!*u+positions[c+1]!*v;
      if(depth>1e-5 && Math.abs(level-o.position[1])<o.halfHeight) return true;
    }
    return false;
  }) };
}

export function createWaterContactUniforms(settings?: WaterContactFoam, origin: readonly number[] = [0, 0, 0]) {
  const obstacles = settings?.enabled ? settings.obstacles.filter(o => !o.hidden) : [];
  if (obstacles.length > WATER_CONTACT_FOAM_LIMIT) throw new Error("over-budget: water foam obstacles");
  return {
    contactCount: { value: obstacles.length },
    contactCentre: { value: Array.from({ length: WATER_CONTACT_FOAM_LIMIT }, (_, i) => {
      const o = obstacles[i]; return o ? new Vector4(o.position[0] - origin[0]!, o.position[1] - origin[1]!, o.position[2] - origin[2]!, o.halfHeight) : new Vector4();
    }) },
    contactShape: { value: Array.from({ length: WATER_CONTACT_FOAM_LIMIT }, (_, i) => {
      const o = obstacles[i]; return o ? new Vector4(o.radii[0], o.radii[1], o.rotation * Math.PI / 180, o.kind === "capsule" ? 1 : 0) : new Vector4();
    }) },
    contactParams: { value: Array.from({ length: WATER_CONTACT_FOAM_LIMIT }, (_, i) => {
      const o = obstacles[i]; return o ? new Vector4(o.width, o.strength, o.wakeLength, 0) : new Vector4();
    }) },
    contactScale: { value: settings?.scale ?? 0.8 }, contactSpeed: { value: settings?.speed ?? 0.3 },
  };
}

/** Analytic, body-local contacts: no extra draws, captures or obstacle textures.
 * Called only on the owning body's wet geometry. Mean waterline, not wave Y. */
export const WATER_CONTACT_GLSL = /* glsl */ `
uniform int contactCount;
uniform vec4 contactCentre[16];
uniform vec4 contactShape[16];
uniform vec4 contactParams[16];
uniform float contactScale;
uniform float contactSpeed;
float waterObstacleFoam(vec3 p, vec2 flow, float velocity, float time) {
  float coverage = 0.0;
  float flowLength = length(flow);
  vec2 direction = flowLength > .0001 ? flow / flowLength : vec2(1.,0.);
  vec2 contactUv=p.xz/contactScale;
  float footprint=max(length(dFdx(contactUv)),length(dFdy(contactUv)));
  for (int i=0; i<16; i++) {
    if (i >= contactCount) break;
    vec4 centre=contactCentre[i], shape=contactShape[i], params=contactParams[i];
    if (abs(p.y-centre.y) >= centre.w) continue;
    // Ellipsoid/capsule waterline narrows as the surface approaches its top/bottom.
    float section=sqrt(max(0.,1.-pow((p.y-centre.y)/centre.w,2.)));
    vec2 radii=max(shape.xy*section,vec2(.001));
    vec2 delta=p.xz-centre.xz;
    float c=cos(shape.z), s=sin(shape.z);
    vec2 q=vec2(c*delta.x+s*delta.y,-s*delta.x+c*delta.y);
    float distance;
    if(shape.w>.5) {
      q.x-=clamp(q.x,-max(0.,radii.x-radii.y),max(0.,radii.x-radii.y));
      distance=length(q)-radii.y;
    } else {
      float k0=length(q/radii), k1=length(q/(radii*radii));
      distance=k0<1.?-min(radii.x,radii.y):k0*(k0-1.)/max(k1,.000001);
    }
    if(distance<0.) continue;
    float band=1.-smoothstep(0.,params.x,distance);
    float downstream=dot(delta,direction);
    float across=abs(dot(delta,vec2(-direction.y,direction.x)));
    vec2 localFlow=vec2(c*direction.x+s*direction.y,-s*direction.x+c*direction.y);
    float radius=shape.w>.5 ? abs(localFlow.x)*max(0.,radii.x-radii.y)+radii.y : length(radii*localFlow);
    float acrossRadius=shape.w>.5 ? abs(localFlow.y)*max(0.,radii.x-radii.y)+radii.y : length(radii*localFlow.yx);
    band*=mix(.7,1.,clamp(-downstream/max(radius,.001),0.,1.));
    float wake=0.;
    if(velocity>.0001 && params.z>0.) {
      float along=max(0.,downstream-radius);
      wake=step(radius,downstream)*(1.-smoothstep(0.,params.z,along))
        *(1.-smoothstep(acrossRadius*.35,acrossRadius+params.x+along*.12,across));
    }
    vec2 advected=p.xz-direction*time*velocity;
    float contactPatch=waterFoamPatchesFiltered(advected,0.,time,contactScale,contactSpeed,footprint);
    coverage=max(coverage,clamp(band+wake*.65,0.,1.)*contactPatch*params.y);
  }
  return coverage;
}
`;

/** Shared presentation kernel; callers provide valid contact coverage and light.
 * World-anchored, two-scale patches rather than complete white contour rings. */
export const WATER_FOAM_GLSL = /* glsl */ `
float waterFoamPatchesFiltered(vec2 world, float distanceToShore, float time, float scale, float speed, float footprint) {
  vec2 p = world / scale;
  vec2 drift = time * speed * vec2(0.11, -0.07);
  float broad = waterNoise(p + drift);
  float detail = waterNoise(p * 3.1 - drift * 1.7 + vec2(17.3, 9.2));
  float patches = smoothstep(0.43, 0.62, broad * 0.7 + detail * 0.3);
  // Small broken pores keep close views from reading as smooth white fog.
  float poreNoise = waterNoise(p * 11.0 + drift * 2.3);
  float pores = mix(smoothstep(0.38, 0.65, poreNoise), 0.5, smoothstep(0.025, 0.12, footprint));
  float band = 1.0 - smoothstep(0.45, 1.0, distanceToShore);
  return patches * pores * band;
}
float waterFoamPatches(vec2 world, float distanceToShore, float time, float scale, float speed) {
  vec2 p=world/scale;
  return waterFoamPatchesFiltered(world,distanceToShore,time,scale,speed,max(length(dFdx(p)),length(dFdy(p))));
}
`;
