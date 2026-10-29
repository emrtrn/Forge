import { DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from "three";
import type { RiverSurfaceQuery } from "../../terrain/riverSurface";

/** Distance to actual wet/dry crossings, plus their interpolated local height.
 * Ribbon ends, submerged edges and missing terrain never become wet banks. */
export function riverShoreMask(surface: RiverSurfaceQuery, width: number) {
  const {data:d,origin:o}=surface;
  const min:[number,number]=[surface.min[0]+o[0]-width,surface.min[1]+o[2]-width];
  const max:[number,number]=[surface.max[0]+o[0]+width,surface.max[1]+o[2]+width];
  const nx=Math.ceil((max[0]-min[0])/(width/4)),nz=Math.ceil((max[1]-min[1])/(width/4));
  if(!Number.isFinite(width)||width<.2||width>4||nx<1||nz<1||nx>1024||nz>1024||nx*nz>524288)
    throw new Error("over-budget: River wet shore needs a wider band or smaller surface (524288 texels)");
  const bytes=new Uint8Array(nx*nz*4);for(let i=0;i<bytes.length;i+=4)bytes[i]=255;
  const sx=(max[0]-min[0])/nx,sz=(max[1]-min[1])/nz;
  const low=surface.levels[0],range=Math.max(.0001,surface.levels[1]-low);
  let work=0;
  for(let t=0;t<d.indices.length;t+=3) {
    const ids=[d.indices[t]!,d.indices[t+1]!,d.indices[t+2]!];
    if(!ids.some(i=>d.bedDepths[i]!>0)||!ids.some(i=>d.bedDepths[i]!<=0))continue;
    const points:number[][]=[];
    for(let edge=0;edge<3;edge++) {
      const a=ids[edge]!,b=ids[(edge+1)%3]!,da=d.bedDepths[a]!,db=d.bedDepths[b]!;
      if((da>0)===(db>0))continue;
      const f=da/(da-db);
      points.push([d.positions[a*3]!+(d.positions[b*3]!-d.positions[a*3]!)*f+o[0],
        d.positions[a*3+1]!+(d.positions[b*3+1]!-d.positions[a*3+1]!)*f,
        d.positions[a*3+2]!+(d.positions[b*3+2]!-d.positions[a*3+2]!)*f+o[2]]);
    }
    if(points.length!==2)continue;
    const [a,b]=points as [number[],number[]],dx=b[0]!-a[0]!,dz=b[2]!-a[2]!,length2=dx*dx+dz*dz;
    const x0=Math.max(0,Math.floor((Math.min(a[0]!,b[0]!)-width-min[0])/sx)),x1=Math.min(nx-1,Math.ceil((Math.max(a[0]!,b[0]!)+width-min[0])/sx));
    const z0=Math.max(0,Math.floor((Math.min(a[2]!,b[2]!)-width-min[1])/sz)),z1=Math.min(nz-1,Math.ceil((Math.max(a[2]!,b[2]!)+width-min[1])/sz));
    work+=(x1-x0+1)*(z1-z0+1);if(work>16777216)throw new Error("over-budget: River wet shore exceeds 16M samples");
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++) {
      const px=min[0]+(x+.5)*sx-a[0]!,pz=min[1]+(z+.5)*sz-a[2]!;
      const f=length2>0?Math.max(0,Math.min(1,(px*dx+pz*dz)/length2)):0;
      const distance=Math.min(255,Math.round(Math.hypot(px-f*dx,pz-f*dz)/width*255)),i=(z*nx+x)*4;
      if(distance>=bytes[i]!)continue;
      const height=Math.round(Math.max(0,Math.min(1,(a[1]!+(b[1]!-a[1]!)*f-low)/range))*65535);
      bytes[i]=distance;bytes[i+1]=height>>8;bytes[i+2]=height&255;
    }
  }
  const texture=new DataTexture(bytes,nx,nz,RGBAFormat,UnsignedByteType);
  texture.name="RiverShoreWetness.distanceAndHeight";texture.minFilter=texture.magFilter=NearestFilter;
  texture.generateMipmaps=false;texture.needsUpdate=true;
  return {texture,min,max,low,range};
}
