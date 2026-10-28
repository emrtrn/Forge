import { Box3, Matrix4, Mesh, Vector3, type BufferGeometry, type Object3D } from "three";
import type { LayoutLakeWaterBody } from "../scene/layout";
import { LAKE_FOAM_MAX_BYTES, type LakeFoamData } from "../scene/lakeFoamBake";
import { LakeSurfaceQuery } from "../terrain/lakeInteraction";
import type { LakeGeometry } from "../terrain/terrainLakeWater";

export interface FoamSource { id: string; parts: { geometry: BufferGeometry; matrix: Matrix4 }[] }
/** Capture immutable transforms. Geometry buffers are borrowed only until their revision changes. */
export function foamSource(id: string, root: Object3D, placement: Matrix4): FoamSource {
  root.updateMatrixWorld(true);
  const parts: FoamSource["parts"]=[];
  root.traverseVisible(o=>{if(o instanceof Mesh && !((o as Mesh & {isSkinnedMesh?:boolean}).isSkinnedMesh)) {
    const materials=Array.isArray(o.material)?o.material:[o.material];
    if(materials.every(m=>!m.visible || m.transparent))return;
    parts.push({geometry:o.geometry,matrix:placement.clone().multiply(o.matrixWorld)});
  }});
  return {id,parts};
}
export function foamFingerprint(text: string): string {
  // Source-change detector, not an authorization/content-integrity hash.
  return Array.from({length:8},(_,seed)=>{let h=(2166136261+seed*374761393)>>>0;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619)>>>0;return h.toString(16).padStart(8,"0");}).join("");
}
const wetFingerprints=new WeakMap<LakeGeometry,string>();
export function wetFoamFingerprint(wet:LakeGeometry):string {
  let result=wetFingerprints.get(wet);if(result)return result;
  let hash=2166136261;
  for(const array of [wet.positions,wet.depths,wet.indices])for(const value of new Uint32Array(array.buffer,array.byteOffset,array.byteLength/4))hash=Math.imul(hash^value,16777619)>>>0;
  result=foamFingerprint(hash.toString(16));wetFingerprints.set(wet,result);return result;
}
const EPS=1e-6;
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,0));

/** User-triggered, bounded mesh/plane section and union mask. Never called by rendering. */
export async function bakeLakeGeometryFoam(lake: LayoutLakeWaterBody, wet: LakeGeometry, sources: readonly FoamSource[], width: number,
  fingerprint: string, signal: AbortSignal, progress: (text: string)=>void=()=>{}): Promise<LakeFoamData> {
  if(signal.aborted)throw new DOMException("Cancelled","AbortError");
  const started=performance.now(), min=[...lake.bounds.min] as [number,number], max=[...lake.bounds.max] as [number,number];
  const nx=Math.ceil((max[0]-min[0])/(width/4)),nz=Math.ceil((max[1]-min[1])/(width/4));
  if(!Number.isFinite(width)||width<.1||width>4||nx<1||nz<1||nx>4096||nz>4096||nx*nz>LAKE_FOAM_MAX_BYTES)throw new Error("over-budget: smaller Lake bounds or wider contact band required");
  const sx=(max[0]-min[0])/nx,sz=(max[1]-min[1])/nz;
  const area=new Box3(new Vector3(min[0]-width,lake.surfaceLevel-EPS,min[1]-width),new Vector3(max[0]+width,lake.surfaceLevel+EPS,max[1]+width));
  const candidates=sources.map(source=>({...source,parts:source.parts.filter(part=>{
    part.geometry.computeBoundingBox();return part.geometry.boundingBox?.clone().applyMatrix4(part.matrix).intersectsBox(area);
  })})).filter(s=>s.parts.length);
  const triangles=candidates.reduce((n,s)=>n+s.parts.reduce((n,p)=>n+Math.floor((p.geometry.index?.count??p.geometry.getAttribute("position")?.count??0)/3),0),0);
  if(candidates.length>4096||triangles>2_000_000)throw new Error("over-budget: Lake foam source/triangle budget exceeded");
  const occupied=new Uint8Array(nx*nz), pixels=new Uint8Array(nx*nz);pixels.fill(255);
  const segments:number[]=[];
  let tick=performance.now(),processed=0,fillWork=0;
  const checkpoint=async()=>{if(signal.aborted)throw new DOMException("Cancelled","AbortError");if(performance.now()-tick>3){await pause();tick=performance.now();if(signal.aborted)throw new DOMException("Cancelled","AbortError");}};
  const vertices=[new Vector3(),new Vector3(),new Vector3()];
  for(const [sourceIndex,source] of candidates.entries()) {
    progress(`${sourceIndex+1}/${candidates.length} objects`);
    const local:number[]=[];
    for(const part of source.parts) {
      const partStart=local.length;
      const position=part.geometry.getAttribute("position"),index=part.geometry.index;
      if(!position)continue;
      const count=index?.count??position.count;
      for(let i=0;i+2<count;i+=3) {
        processed++;
        for(let k=0;k<3;k++)vertices[k]!.fromBufferAttribute(position,index?index.getX(i+k):i+k).applyMatrix4(part.matrix);
        if(vertices.some(v=>!Number.isFinite(v.x+v.y+v.z)))throw new Error("Invalid non-finite rock geometry");
        const heights=vertices.map(v=>v.y-lake.surfaceLevel);
        if((heights.some(h=>h>EPS)&&heights.some(h=>h< -EPS)) || heights.filter(h=>Math.abs(h)<=EPS).length===2) {
          const points:number[][]=[];
          for(let k=0;k<3;k++) {
            const a=vertices[k]!,b=vertices[(k+1)%3]!,da=heights[k]!,db=heights[(k+1)%3]!;
            if(Math.abs(da)<=EPS)points.push([a.x-min[0],a.z-min[1]]);
            else if(da*db<0){const t=da/(da-db);points.push([a.x+(b.x-a.x)*t-min[0],a.z+(b.z-a.z)*t-min[1]]);}
          }
          const unique=points.filter((p,i)=>!points.slice(0,i).some(q=>Math.hypot(p[0]!-q[0]!,p[1]!-q[1]!)<EPS));
          if(unique.length===2 && Math.hypot(unique[0]![0]!-unique[1]![0]!,unique[0]![1]!-unique[1]![1]!)>EPS) {
            const a=vertices[0]!,b=vertices[1]!,c=vertices[2]!;
            const normalX=(b.y-a.y)*(c.z-a.z)-(b.z-a.z)*(c.y-a.y);
            const normalZ=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
            const direction=(unique[1]![0]!-unique[0]![0]!)*-normalZ+(unique[1]![1]!-unique[0]![1]!)*normalX;
            if(direction<0)unique.reverse();local.push(...unique[0]!,...unique[1]!);
          }
          if((segments.length+local.length)/4>131072)throw new Error("over-budget: Lake foam section segment budget exceeded");
        }
        if(processed%256===0)await checkpoint();
      }
      // Normalize mirrored submeshes, retaining opposite winding for real holes.
      let signedArea=0;for(let i=partStart;i<local.length;i+=4)signedArea+=local[i]!*local[i+3]!-local[i+2]!*local[i+1]!;
      if(signedArea<0)for(let i=partStart;i<local.length;i+=4){const x=local[i]!,z=local[i+1]!;local[i]=local[i+2]!;local[i+1]=local[i+3]!;local[i+2]=x;local[i+3]=z;}
    }
    // Scanline fill each object's section, then union all objects. Internal
    // overlaps never create white seams between touching/overlapping rocks.
    if(local.length) {
      let lo=Infinity,hi=-Infinity;for(let i=1;i<local.length;i+=2){lo=Math.min(lo,local[i]!);hi=Math.max(hi,local[i]!);}
      fillWork+=Math.max(0,Math.min(nz-1,Math.ceil(hi/sz))-Math.max(0,Math.floor(lo/sz))+1)*(local.length/4);
      if(fillWork>32_000_000)throw new Error("over-budget: Lake foam section fill exceeds 32M samples");
      for(let z=Math.max(0,Math.floor(lo/sz));z<=Math.min(nz-1,Math.ceil(hi/sz));z++) {
        const y=(z+.5)*sz,xs:{x:number;winding:number}[]=[];
        for(let i=0;i<local.length;i+=4){if(i%4096===0)await checkpoint();const ax=local[i]!,az=local[i+1]!,bx=local[i+2]!,bz=local[i+3]!;
          if((az<=y&&y<bz)||(bz<=y&&y<az))xs.push({x:ax+(bx-ax)*(y-az)/(bz-az),winding:bz>az?1:-1});}
        xs.sort((a,b)=>a.x-b.x);
        let winding=0;
        for(let i=0;i<xs.length;) {
          const x=xs[i]!.x;while(i<xs.length&&Math.abs(xs[i]!.x-x)<EPS)winding+=xs[i++]!.winding;
          if(winding!==0&&i<xs.length){const from=Math.max(0,Math.ceil(x/sx-.5)),to=Math.min(nx-1,Math.floor(xs[i]!.x/sx-.5));if(to>=from)occupied.fill(1,z*nx+from,z*nx+to+1);}
        }
        await checkpoint();
      }
      for(const value of local)segments.push(value);
    }
    await checkpoint();
  }
  const query=new LakeSurfaceQuery(wet);
  // Rasterize only real section segments near wet water. Occupancy gates remove
  // internal overlap boundaries. Open section geometry still supplies contact lines.
  let work=0;
  const inside=(x:number,z:number)=>{const ix=Math.floor(x/sx),iz=Math.floor(z/sz);return ix>=0&&iz>=0&&ix<nx&&iz<nz&&occupied[iz*nx+ix]===1;};
  progress("Contact distance mask");
  for(let i=0;i<segments.length;i+=4) {
    const ax=segments[i]!,az=segments[i+1]!,bx=segments[i+2]!,bz=segments[i+3]!,dx=bx-ax,dz=bz-az,len=dx*dx+dz*dz;
    const x0=Math.max(0,Math.floor((Math.min(ax,bx)-width)/sx)),x1=Math.min(nx-1,Math.ceil((Math.max(ax,bx)+width)/sx));
    const z0=Math.max(0,Math.floor((Math.min(az,bz)-width)/sz)),z1=Math.min(nz-1,Math.ceil((Math.max(az,bz)+width)/sz));
    work+=Math.max(0,x1-x0+1)*Math.max(0,z1-z0+1);
    if(work>32_000_000)throw new Error("over-budget: Lake foam distance work exceeded 32M samples");
    for(let z=z0;z<=z1;z++) {
      for(let x=x0;x<=x1;x++) {
        if((x-x0)%256===0)await checkpoint();
        const px=(x+.5)*sx,pz=(z+.5)*sz,index=z*nx+x;
        if(occupied[index])continue;
        const t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/len)),qx=ax+dx*t,qz=az+dz*t;
        const distance=Math.hypot(px-qx,pz-qz);if(distance>=width)continue;
        const outsideX=qx+(px-qx)*.001,outsideZ=qz+(pz-qz)*.001;
        if(inside(outsideX,outsideZ)||query.depthAt(px+min[0],pz+min[1])===null||query.depthAt(outsideX+min[0],outsideZ+min[1])===null)continue;
        pixels[index]=Math.min(pixels[index]!,Math.round(distance/width*255));
      }
      await checkpoint();
    }
  }
  return {metadata:{schema:1,min,max,level:lake.surfaceLevel,width,nx,nz,sources:candidates.length,triangles,segments:segments.length/4,milliseconds:performance.now()-started,fingerprint},pixels};
}
