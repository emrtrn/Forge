import { DataTexture, NearestFilter, NoColorSpace, RedFormat } from "three";
import type { LakeGeometry } from "../terrain/terrainLakeWater";

/** Borrow immutable connected-face bytes; never rasterise a replacement basin.
 * Two texels per source cell preserve the b-c diagonal. Oversized/absent grids
 * disable refraction rather than reducing mask accuracy or failing the lake. */
export function createLakeRefractionMask(data: LakeGeometry): DataTexture | null {
  const grid = data.coverage;
  if (!grid || data.status !== "ready" || grid.nx < 1 || grid.nz < 1
    || grid.nx * 2 > 2048 || grid.nz > 2048 || grid.triangles.length !== grid.nx * grid.nz * 2) return null;
  const texture = new DataTexture(grid.triangles, grid.nx * 2, grid.nz, RedFormat);
  texture.name = "Lake.refractionConnectedFaces";
  texture.colorSpace = NoColorSpace;
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false; texture.flipY = false; texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** Screen-space offset/depth fallback inspired by Ultra-Water OceanSurface.js,
 * ce9248fa20afbdf63fd4c11709f68d7368aca0a0, MIT, (c) 2026 Humpalumps.
 * Forge adds connected-face, midpoint, local-height and screen-edge checks. */
export const LAKE_REFRACTION_GLSL = /* glsl */ `
uniform sampler2D lakeRefractionMask;
uniform vec2 lakeRefractionMin;
uniform vec2 lakeRefractionGrid;
uniform float lakeRefractionSpacing;
uniform float lakeRefractionStrength;
uniform float lakeRefractionWaveMargin;
float lakeRefractionWaterAt(vec3 world) {
  vec2 grid=(world.xz-lakeRefractionMin)/lakeRefractionSpacing;
  vec2 cell=floor(grid);
  if(any(lessThan(cell,vec2(0.)))||any(greaterThanEqual(cell,lakeRefractionGrid))) return 0.;
  vec2 f=fract(grid);
  float face=step(1.,f.x+f.y);
  vec2 uv=(vec2(cell.x*2.+face,cell.y)+.5)/(lakeRefractionGrid*vec2(2.,1.));
  return step(.5/255.,texture2D(lakeRefractionMask,uv).r);
}
float lakeRefractionCandidate(vec2 uv,float surfaceY,out float path) {
  path=0.;
  vec2 border=min(uv,vec2(1.)-uv)*waterSceneSize;
  if(min(border.x,border.y)<2.) return 0.;
  float depth=texture2D(waterSceneDepth,uv).r;
  if(abs(depth-mix(1.,0.,waterSceneReversed))<.000001) return 0.;
  vec3 bedView=waterScenePosition(uv,depth);
  vec3 bedWorld=(waterSceneCameraWorld*vec4(bedView,1.)).xyz;
  // Opaque land, foreground props and thin contact regions cannot be pulled
  // into the water. Include the geometric-wave range in the safety margin.
  if(bedWorld.y>=surfaceY-lakeRefractionWaveMargin) return 0.;
  vec3 origin=cameraPosition;
  vec3 ray=bedWorld-cameraPosition;
  if(isOrthographic){origin=bedWorld;ray=-waterSceneCameraWorld[2].xyz;}
  if(abs(ray.y)<.00001) return 0.;
  float t=(surfaceY-origin.y)/ray.y;
  if(!isOrthographic && t<=0.) return 0.;
  vec3 surfaceWorld=origin+ray*t;
  if(lakeRefractionWaterAt(surfaceWorld)<.5) return 0.;
  vec3 surfaceView=(viewMatrix*vec4(surfaceWorld,1.)).xyz;
  float gap=surfaceView.z-bedView.z;
  path=min(length(surfaceView-bedView),100.);
  return smoothstep(.02,.15,gap)*smoothstep(2.,10.,min(border.x,border.y));
}
void lakeRefract(vec2 uv,vec3 normal,vec3 surfaceView,float surfaceY,float edgeDepth,
  inout vec3 bedColor,inout float path) {
  if(lakeRefractionStrength<=0. || surfaceY>=cameraPosition.y || edgeDepth<=.02) return;
  vec3 tilt=mat3(viewMatrix)*vec3(normal.x,0.,normal.z);
  vec2 projected=tilt.xy;
  if(!isOrthographic) projected-=surfaceView.xy/min(surfaceView.z,-.001)*tilt.z;
  vec2 offset=projected*.06*lakeRefractionStrength*vec2(waterSceneSize.y/waterSceneSize.x,1.)
    *smoothstep(.02,.35,edgeDepth)*clamp(path*.5,0.,1.);
  // Bounded pixel displacement and a grazing fade avoid long silhouette pulls.
  offset*=smoothstep(.03,.2,abs(normalize(cameraPosition-vWorldPosition).y));
  float pixels=length(offset*waterSceneSize);
  offset*=min(1.,10./max(pixels,.00001));
  float candidatePath=path,midPath=path;
  float keep=lakeRefractionCandidate(uv+offset*.5,surfaceY,midPath);
  keep*=lakeRefractionCandidate(uv+offset,surfaceY,candidatePath);
  if(keep<=0.) return;
  // Mix validated endpoint colours, not a new unvalidated intermediate UV.
  bedColor=mix(bedColor,texture2D(waterSceneColor,uv+offset).rgb,keep);
  path=mix(path,candidatePath,keep);
}
`;
