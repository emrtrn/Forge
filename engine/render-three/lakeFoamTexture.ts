import { DataArrayTexture, NearestFilter, RedFormat, UnsignedByteType, Vector2 } from "three";
import type { LakeFoamData } from "../scene/lakeFoamBake";

/** Packed array layers; manual bilinear lookup crosses tile boundaries without seams/halos. */
export function lakeFoamTexture(data: LakeFoamData) {
  const {nx,nz}=data.metadata,tw=Math.min(1024,nx),th=Math.min(1024,nz),cols=Math.ceil(nx/tw),rows=Math.ceil(nz/th);
  const bytes=new Uint8Array(tw*th*cols*rows);bytes.fill(255);
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)bytes[(Math.floor(z/th)*cols+Math.floor(x/tw))*tw*th+(z%th)*tw+x%tw]=data.pixels[z*nx+x]!;
  const texture=new DataArrayTexture(bytes,tw,th,cols*rows);texture.format=RedFormat;texture.type=UnsignedByteType;
  texture.minFilter=texture.magFilter=NearestFilter;texture.generateMipmaps=false;texture.unpackAlignment=1;texture.needsUpdate=true;texture.name="Lake.geometryFoam";
  return {texture,tile:new Vector2(tw,th),grid:new Vector2(nx,nz)};
}
export const LAKE_GEOMETRY_FOAM_GLSL=/* glsl */`
#ifdef FORGE_LAKE_GEOMETRY_FOAM
uniform highp sampler2DArray geometryFoamMask;
uniform vec2 geometryFoamMin; uniform vec2 geometryFoamSize;
uniform vec2 geometryFoamGrid; uniform vec2 geometryFoamTile;
uniform float geometryFoamStrength; uniform float geometryFoamScale; uniform float geometryFoamSpeed;
float geometryFoamTexel(ivec2 p) {
  if(any(lessThan(p,ivec2(0)))||any(greaterThanEqual(p,ivec2(geometryFoamGrid))))return 1.;
  ivec2 tile=ivec2(geometryFoamTile),cell=p/tile;
  int cols=int(ceil(geometryFoamGrid.x/geometryFoamTile.x));
  return texelFetch(geometryFoamMask,ivec3(p%tile,cell.y*cols+cell.x),0).r;
}
float lakeGeometryFoam(vec2 world,float time) {
  vec2 uv=(world-geometryFoamMin)/geometryFoamSize;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return 0.;
  vec2 p=uv*geometryFoamGrid-.5,f=fract(p);ivec2 q=ivec2(floor(p));
  float distance=mix(mix(geometryFoamTexel(q),geometryFoamTexel(q+ivec2(1,0)),f.x),
    mix(geometryFoamTexel(q+ivec2(0,1)),geometryFoamTexel(q+ivec2(1,1)),f.x),f.y);
  return waterFoamPatches(world,distance,time,geometryFoamScale,geometryFoamSpeed)*geometryFoamStrength;
}
#endif
`;
