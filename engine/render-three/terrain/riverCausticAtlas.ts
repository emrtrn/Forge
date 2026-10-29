import { DataTexture, FloatType, NearestFilter, RGBAFormat } from "three";
import type { RiverSurfaceQuery } from "../../terrain/riverSurface";

/** One bounded float atlas: cell ranges, triangle references, then exact ribbon faces.
 * Positions stay local, preserving precision at large world origins. */
export function riverCausticAtlas(surfaces: readonly RiverSurfaceQuery[]) {
  const sizes=surfaces.map(s=>s.nx*s.nz+s.triangles.length+4*s.data.indices.length/3);
  const texels=sizes.reduce((n,v)=>n+v,0);
  if(texels>1024*1024)throw new Error("over-budget: River caustics atlas exceeds 16 MiB");
  const width=Math.min(1024,Math.max(1,texels)),height=Math.max(1,Math.ceil(texels/width));
  const data=new Float32Array(width*height*4),offsets:number[]=[];
  let start=0;
  for(const s of surfaces) {
    offsets.push(start);const cells=s.nx*s.nz,refs=start+cells,tris=refs+s.triangles.length,d=s.data;
    for(let c=0;c<cells;c++)data.set([refs+s.offsets[c]!,s.offsets[c+1]!-s.offsets[c]!,0,0],(start+c)*4);
    for(let i=0;i<s.triangles.length;i++)data[(refs+i)*4]=tris+s.triangles[i]!*4;
    for(let t=0;t<d.indices.length/3;t++) {
      let fx=0,fz=0,m=0;
      for(let k=0;k<3;k++) {
        const i=d.indices[t*3+k]!;
        data.set([d.positions[i*3]!,d.positions[i*3+2]!,d.positions[i*3+1]!,d.bedDepths[i]!],(tris+t*4+k)*4);
        fx+=d.flowDirections[i*2]!/3;fz+=d.flowDirections[i*2+1]!/3;m+=d.flowSpeedMultipliers[i]!/3;
      }
      data.set([fx,fz,m,0],(tris+t*4+3)*4);
    }
    start+=sizes[offsets.length-1]!;
  }
  const texture=new DataTexture(data,width,height,RGBAFormat,FloatType);
  texture.minFilter=texture.magFilter=NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
  texture.name="RiverCaustics.exactSurface";
  return {texture,offsets,width};
}

export const RIVER_CAUSTIC_GLSL=/* glsl */`
#if FORGE_TERRAIN_RIVER_CAUSTICS > 0
uniform highp sampler2D uRiverCausticData;
uniform int uRiverCausticWidth;
uniform vec4 uCausticRiver[8]; // head base (-1 for Lake), local X/Z origin, flow speed
vec4 riverCausticRead(int index) {
  return texelFetch(uRiverCausticData,ivec2(index%uRiverCausticWidth,index/uRiverCausticWidth),0);
}
bool riverCausticSample(vec2 world,vec4 grid,vec4 info,out float level,out vec2 flow) {
  vec2 p=(world-grid.xy)*grid.z;ivec2 cell=ivec2(floor(p));
  if(any(lessThan(cell,ivec2(0)))||float(cell.x)>=grid.w)return false;
  vec4 range=riverCausticRead(int(info.x)+cell.y*int(grid.w)+cell.x);
  vec2 local=world-info.yz;
  for(int candidate=0;candidate<64;candidate++) {
    if(candidate>=int(range.y))break;
    int t=int(riverCausticRead(int(range.x)+candidate).x);
    vec4 a=riverCausticRead(t),b=riverCausticRead(t+1),c=riverCausticRead(t+2);
    vec2 ab=b.xy-a.xy,ac=c.xy-a.xy,ap=local-a.xy;
    float det=ab.x*ac.y-ab.y*ac.x;if(abs(det)<1e-12)continue;
    float u=(ap.x*ac.y-ap.y*ac.x)/det,v=(ab.x*ap.y-ab.y*ap.x)/det;
    vec3 weights=vec3(1.-u-v,u,v);
    if(any(lessThan(weights,vec3(-.000001)))||dot(weights,vec3(a.w,b.w,c.w))<=.00001)continue;
    level=dot(weights,vec3(a.z,b.z,c.z));
    vec4 motion=riverCausticRead(t+3);flow=motion.xy/max(length(motion.xy),.00001)*motion.z*info.w;
    return true;
  }
  return false;
}
#endif
`;
