// Reproducible CPU/buffer pilot; GPU acceptance is a separate browser measurement.
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
await mkdir(".dev-server", { recursive: true });
const outfile = resolve(".dev-server/lake-w1-benchmark.mjs");
await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
import { cpus, platform } from "node:os";
import { createLakeFixture } from "./tests/engine/fixtures/lakeFixture";
import { createFlatTerrainTile, tileKey } from "./engine/terrain/terrainTypes";
import { prepareLakeSnapshot, buildLakeGeometry } from "./engine/terrain/terrainLakeWater";
import { encodeTerrainTile, decodeTerrainTile } from "./engine/terrain/terrainTileCodec";
const base = createLakeFixture();
const max = createLakeFixture(); max.def.tileQuads = 128; max.def.origin = [-128,10,-128]; max.tiles.clear();
for(let tz=0;tz<2;tz++) for(let tx=0;tx<2;tx++) {
 const tile=createFlatTerrainTile(max.def,tx,tz);
 for(let z=0;z<=128;z++)for(let x=0;x<=128;x++)tile.heights[z*129+x]=Math.min(6,Math.max(0,Math.max(Math.abs(tx*128+x-128),Math.abs(tz*128+z-128))-80)/8);
 max.tiles.set(tileKey(tx,tz),tile);
}
max.lake.bounds={min:[-128,-128],max:[128,128]};
const percentile=(v:number[],p:number)=>v.sort((a,b)=>a-b)[Math.ceil(v.length*p)-1];
const report:any={cpu:cpus()[0]?.model,platform:platform(),cases:[]};
for(const [name,doc] of [["fixture-96m",base],["maximum-65536-cells",max]] as const) {
 const snapshot=await prepareLakeSnapshot(doc,doc.lake),times:number[]=[];let result:any;
 for(let i=0;i<35;i++){const start=performance.now();result=await buildLakeGeometry(snapshot);if(i>=5)times.push(performance.now()-start);}
 const disk=new Map([...doc.tiles].map(([key,tile])=>[key,encodeTerrainTile(tile,{heightMin:-64,heightMax:64,heightFormat:"f32"})]));
 const cold:number[]=[];
 for(let i=0;i<10;i++){const start=performance.now();await buildLakeGeometry(await prepareLakeSnapshot({...doc,tiles:new Map()},doc.lake,async key=>decodeTerrainTile(disk.get(key)!)));cold.push(performance.now()-start);}
 report.cases.push({name,cells:result.cells,triangles:result.indices.length/3,bufferBytes:result.bytes,status:result.status,warmP95Ms:percentile(times,.95),coldDecodeP95Ms:percentile(cold,.95)});
}
console.log(JSON.stringify(report,null,2));
` }, bundle: true, platform: "node", format: "esm", outfile, logLevel: "warning" });
await import(pathToFileURL(outfile).href);
