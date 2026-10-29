// Offline adaptation of Ultra-Water bakeTextures.js (ce9248fa20afbdf63fd4c11709f68d7368aca0a0).
// Copyright (c) 2026 Humpalumps. MIT; see public/licenses/ultra-water.txt.
// R: erodible lace, G: billow height, BA: signed gradient (0.5 + gradient/64).
// No dependency or runtime generation. Run: node tools/bake-water-foam.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const size = 512, fract = x => x - Math.floor(x), clamp = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp((x-a)/(b-a)); return t*t*(3-2*t); };
const hashes = new Map();
function cells(period) {
  if (hashes.has(period)) return hashes.get(period);
  const data = new Float64Array(period*period*2);
  for(let y=0;y<period;y++) for(let x=0;x<period;x++) {
    let a=fract(x*.1031), b=fract(y*.1030), c=fract(x*.0973);
    const d=a*(b+33.33)+b*(c+33.33)+c*(a+33.33); a+=d;b+=d;c+=d;
    const i=(y*period+x)*2; data[i]=fract((a+b)*c);data[i+1]=fract((a+c)*b);
  }
  hashes.set(period,data); return data;
}
function voronoi(u,v,period,offset=0) {
  const px=u*period+offset,py=v*period+offset,ix=Math.floor(px),iy=Math.floor(py),fx=fract(px),fy=fract(py),h=cells(period);
  let f1=8,f2=8;
  for(let y=-1;y<=1;y++) for(let x=-1;x<=1;x++) {
    const k=((((iy+y)%period+period)%period)*period+((ix+x)%period+period)%period)*2;
    const d=Math.hypot(x+h[k]-fx,y+h[k+1]-fy);
    if(d<f1){f2=f1;f1=d;}else if(d<f2)f2=d;
  }
  return [f1,f2];
}
function billow(u,v) {
  return [[7,.3,.5],[17,.7,.32],[41,.1,.18]].reduce((sum,[period,offset,weight])=>{
    const [a,b]=voronoi(u,v,period,offset);return sum+weight*Math.sqrt(clamp((b-a)*2.2));
  },0);
}
const rgba=Buffer.alloc(size*size*4), e=1/1024;
for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
  const u=(x+.5)/size,v=(y+.5)/size,a=voronoi(u,v,9),b=voronoi(u,v,23,.5),c=voronoi(u,v,61);
  const lace=1-smooth(0,.22,a[1]-a[0]),fine=1-smooth(0,.16,b[1]-b[0]),bubbles=1-smooth(.15,.55,c[0]);
  const values=[clamp((lace*.55+fine*.3+bubbles*.25+(1-a[0])*.25)*.85),billow(u,v),
    clamp(.5+(billow(u+e,v)-billow(u-e,v))/(2*e*64)),clamp(.5+(billow(u,v+e)-billow(u,v-e))/(2*e*64))];
  values.forEach((value,i)=>rgba[(y*size+x)*4+i]=Math.round(value*255));
}
// Minimal PNG encoder; RGBA channels are linear data, including alpha as slope Z.
function crc32(bytes) { let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0; }
function chunk(name,data) {
  const type=Buffer.from(name),header=Buffer.alloc(4),crc=Buffer.alloc(4);header.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));
  return Buffer.concat([header,type,data,crc]);
}
const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
const rows=Buffer.alloc(size*(1+size*4));for(let y=0;y<size;y++)rgba.copy(rows,y*(1+size*4)+1,y*size*4,(y+1)*size*4);
const target=new URL('../engine/render-three/textures/water-foam.png',import.meta.url);
mkdirSync(new URL('.',target),{recursive:true});
writeFileSync(target,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]));
console.log('Baked 512x512 RGBA water foam.');
