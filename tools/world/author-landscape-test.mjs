import { build } from "esbuild";
import { readFile, writeFile, mkdir, access, rename } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { CatmullRomCurve3, Vector3 } from "three";

// Explicit, staged content authoring. Never edits the level, actors or engine.
// Stage: node tools/world/author-landscape-test.mjs --snow <generated PNG>
// Review the staged public/ in a disposable preview before --apply.
const root = resolve(".dev-server/landscape-test-sculpt");
const staged = join(root, "staged/public");
const levelPath = "assets/starter-content/Levels/LandscapeTest.level.json";
const terrainPath = "assets/starter-content/Levels/LandscapeTest.landscapes/landscape-1.terrain.json";
const assetRoot = "assets/LandscapeTest";
const sourceRoot = "C:/Users/emret/Desktop/Games/ThreeAges/public";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const put = async (base, path, bytes) => { await mkdir(dirname(join(base, path)), { recursive: true }); await writeFile(join(base, path), bytes); };
const publish = async (path, bytes) => {
  const target=resolve("public",path),publicRoot=resolve("public");
  assert(target.startsWith(publicRoot+"/")||target.startsWith(publicRoot+"\\"),"Content path escapes public/");
  await mkdir(dirname(target),{recursive:true});
  const temporary=target+`.authoring-${process.pid}.tmp`;
  await writeFile(temporary,bytes);await rename(temporary,target);
};
const exists = (path) => access(path).then(() => true, () => false);

if (process.argv.includes("--apply")) {
  const state = await json(join(root, "authoring-state.json"));
  for (const [path, expected] of Object.entries(state.before)) {
    assert.equal(hash(await readFile(join("public", path))), expected, `Concurrent change in ${path}; staged content was not applied`);
  }
  for (const path of state.outputs) {
    if (!state.before[path]) assert.equal(await exists(join("public", path)), false, `New asset already exists: ${path}`);
  }
  // All checks precede the first write. The timestamped backup includes the
  // original definition, every tile, global map, level and asset manifest.
  for (const path of state.outputs.filter((path) => path !== terrainPath && path !== "assets/manifest.json")) {
    await publish(path, await readFile(join(staged, path)));
  }
  await publish(terrainPath, await readFile(join(staged, terrainPath)));
  await publish("assets/manifest.json", await readFile(join(staged, "assets/manifest.json")));
  assert.equal(hash(await readFile(join("public", levelPath))), state.before[levelPath], "Level content must remain untouched");
  state.appliedAt = new Date().toISOString();
  await writeFile(join(root, "authoring-state.json"), JSON.stringify(state, null, 2));
  console.log(`Applied ${state.outputs.length} content files; level and actors unchanged. Backup: ${state.backup}`);
  process.exit(0);
}

const snowIndex = process.argv.indexOf("--snow");
assert(snowIndex >= 0 && process.argv[snowIndex + 1], "Pass --snow <generated PNG path>");
const snowPath = resolve(process.argv[snowIndex + 1]);
await access(snowPath);
const bundle = await build({ bundle: true, format: "esm", platform: "node", write: false, tsconfig: "tsconfig.json",
  stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
    export * from './engine/terrain/terrainTileCodec';
    export * from './engine/terrain/terrainTypes';
    export * from './engine/terrain/terrainGlobalMapFile';
    export * from './engine/terrain/terrainRenderSource';
    export * from './engine/terrain/terrainSculpt';
    export * from './engine/terrain/terrainErosion';
    export * from './tools/terrainSaveValidator';
    export { validateForgeMaterialDef } from './tools/saveValidator';
  ` },
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const original = await json(join("public", terrainPath));
assert.equal(original.tilesX, 4); assert.equal(original.tilesZ, 4);
assert.equal(original.tileQuads, 256); assert.equal(original.spacing, 1);
assert.deepEqual(original.origin, [-512, 0, -512]);
const level = await json(join("public", levelPath));
assert.equal(level.landscapes[0].dataRef, terrainPath);
const originals = [levelPath, "assets/manifest.json", terrainPath, api.terrainGlobalMapPath(terrainPath), ...original.tiles.map(({ key }) => api.terrainTilePath(terrainPath, key))];
const before = {};
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const backup = join(root, "backups", stamp);
for (const path of originals) {
  const bytes = await readFile(join("public", path));
  before[path] = hash(bytes);
  await put(backup, path, bytes);
}
const outputs = [];
const stage = async (path, bytes) => { await put(staged, path, bytes); if (!outputs.includes(path)) outputs.push(path); };
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const gauss = (x, z, cx, cz, sx, sz) => Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));
const n = (x, z, scale, seed = 19) => api.terrainSculptNoise(x / scale, z / scale, seed);
const fbm = (x, z, scale, seed = 19) => n(x, z, scale, seed) * 0.58 + n(x, z, scale / 2.1, seed + 7) * 0.28 + n(x, z, scale / 4.3, seed + 31) * 0.14;
const ridgeChains = [
  { width: 110, points: [[-470,-380,70],[-410,-425,122],[-330,-365,112],[-265,-285,75],[-190,-245,38]] },
  { width: 125, points: [[140,-470,68],[245,-415,130],[310,-340,157],[400,-390,170],[468,-455,115]] },
  { width: 74, points: [[310,-340,115],[380,-265,89],[415,-145,64],[430,-15,71],[385,100,47]] },
  { width: 80, points: [[300,180,23],[365,250,64],[285,330,48],[390,415,35],[475,455,10]] },
  { width: 92, points: [[-485,-135,8],[-395,-65,31],[-350,40,12],[-445,115,-3]] },
];
const curved = (points) => new CatmullRomCurve3(points.map(([x,z,h])=>new Vector3(x,h,z)),false,"centripetal")
  .getPoints(80).map(p=>[p.x,p.z,p.y]);
const river = curved([[350,-230,5],[320,-130,-8],[305,-30,-20],[280,45,-30],[235,130,-42],[165,245,-57],[25,335,-65],[-55,490,-72]]);
const westernRiver = curved([[-445,70,-25],[-355,125,-35],[-305,180,-42],[-275,225,-47],[-135,295,-59],[25,335,-65]]);
function nearest(x, z, points, reach = Infinity) {
  let best = Infinity, height = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i-1], b = points[i], dx = b[0]-a[0], dz = b[1]-a[1];
    if(x<Math.min(a[0],b[0])-reach||x>Math.max(a[0],b[0])+reach||z<Math.min(a[1],b[1])-reach||z>Math.max(a[1],b[1])+reach)continue;
    const t = clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz));
    const d = Math.hypot(x-mix(a[0],b[0],t),z-mix(a[1],b[1],t));
    if (d < best) { best = d; height = mix(a[2],b[2],t); }
  }
  return { distance: best, height };
}
function landform(x, z) {
  const warpX = 35 * fbm(x,z,110,39), warpZ = 38 * fbm(x,z,95,52);
  const wx = x+warpX, wz = z+warpZ;
  let h = -25 - 16 * smooth(100,420,z) + 7 * fbm(x,z,140,3);
  const angle=Math.atan2(wz+20,wx+18);
  const r = Math.hypot((wx+18)/205,(wz+20)/175)*(1+0.12*Math.sin(angle*3+0.6)+0.07*Math.sin(angle*7-0.8))
    +0.09*fbm(x,z,45,115);
  const ledges=0.45+0.55*smooth(-0.3,0.35,n(x,z,100,47));
  h = mix(h,-7+5*fbm(x,z,82,12),(1-smooth(1.02,1.25,r))*ledges);
  h = mix(h,13+9*fbm(x,z,90,8),1-smooth(0.76,1.02,r));
  const northR = Math.hypot((wx+10)/180,(wz+340)/140)+0.12*fbm(x,z,60,21)+0.07*Math.sin(Math.atan2(wz+340,wx+10)*5);
  h = mix(h,43+8*fbm(x,z,140,84),1-smooth(0.65,1.05,northR));
  h = Math.max(h, -22 + 31*gauss(wx,wz,-370,-60,155,190)+6*fbm(x,z,83,43));
  h = Math.max(h, -27 + 17*gauss(wx,wz,-320,340,190,140)+4*fbm(x,z,99,67));
  for (let i=0;i<ridgeChains.length;i++) {
    const chain = ridgeChains[i], near = nearest(wx,wz,chain.points);
    const envelope = clamp(1-near.distance/chain.width);
    const crags = 0.68 + 0.32*(1-Math.abs(fbm(wx*0.8+wz*0.3,wz*0.9-wx*0.2,33,22+i)));
    const ridge = -20 + (near.height+20) * envelope ** 1.18 * crags;
    h = Math.max(h, ridge + 5 * fbm(x,z,25,99+i) * envelope);
  }
  h += (1.1*n(x,z,19,22)+0.45*n(x,z,7,67)) * (0.35+smooth(15,90,h));
  // Keep natural, imperfect terrace faces around the central mesa and western hills.
  const terraceMask = Math.max((1-smooth(1.18,1.40,r))*smooth(0.65,0.9,r),gauss(x,z,-370,-80,110,160)*0.4);
  h = api.nextTerrainSculptHeight("terrace",h,terraceMask*0.32,x,z,
    {...api.DEFAULT_TERRAIN_SCULPT_SETTINGS,terraceStep:10,terraceSmoothing:0.22});
  for (const channel of [river,westernRiver]) {
    const near = nearest(wx,wz,channel,90);
    const lower = near.height + 0.014*near.distance*near.distance;
    const valley = 1-smooth(18,82,near.distance);
    h = mix(h,Math.min(h,lower),valley);
  }
  // Floodplain and lake depressions: geometry and paint only, no water actors.
  h = mix(h,Math.min(h,-60+3*fbm(x,z,65,17)),gauss(wx,wz,-45,330,105,65)*0.8);
  return h;
}

const width = 1025, count = width*width;
const heights = new Float32Array(count);
console.log("Authoring nine large sculpt regions (1025 x 1025 global vertices)…");
for (let z=0;z<width;z++) for(let x=0;x<width;x++) heights[z*width+x]=landform(x-512,z-512);
// Place the centre plateau's natural surface at the existing truck's datum.
// This avoids excavating a deep starting-pad pit into an otherwise raised mesa.
const datumShift = heights[512*width+512];
for (let i=0;i<count;i++) heights[i]-=datumShift;
const erosionPasses = [];
function erode(x,z,radius,hydraulic,seed) {
  const x0=clamp(Math.floor(x+512-radius-1),0,1024),x1=clamp(Math.ceil(x+512+radius+1),0,1024);
  const z0=clamp(Math.floor(z+512-radius-1),0,1024),z1=clamp(Math.ceil(z+512+radius+1),0,1024);
  const settings = {...api.DEFAULT_TERRAIN_EROSION_SETTINGS,erosionHydraulic:hydraulic,
    erosionIterations:18,erosionTalus:29,erosionRainAmount:0.35,
    erosionSedimentCapacity:3,erosionSeed:seed};
  const result=api.erodeTerrainRegion({x0,x1,z0,z1,originX:-512,originZ:-512,spacing:1,x,z,radius,
    strength:hydraulic?0.4:0.6,falloff:1.3,settings,sample:(gx,gz)=>heights[gz*width+gx]});
  let maxChange=0;
  for(let gz=z0;gz<=z1;gz++) for(let gx=x0;gx<=x1;gx++) {
    const i=gz*width+gx,h=result[(gz-z0)*(x1-x0+1)+gx-x0];
    maxChange=Math.max(maxChange,Math.abs(h-heights[i])); heights[i]=h;
  }
  erosionPasses.push({mode:hydraulic?"Hydraulic":"Thermal",x,z,radius,maxChange:+maxChange.toFixed(3)});
}
const mountainDabs = [[-420,-385],[-360,-350],[-305,-290],[-440,-300],[-345,-435],
  [225,-395],[290,-355],[355,-375],[415,-400],[370,-290],[425,-215],[420,-90],[415,15],
  [345,245],[310,310],[390,365],[-405,-75],[-360,10]];
for (const [i,[x,z]] of mountainDabs.entries()) { erode(x,z,50,false,170+i); }
console.log("Thermal settling complete; carving hydraulic drainage channels…");
for (const [i,[x,z]] of mountainDabs.entries()) { erode(x+9,z+22,50,true,733+i); }
for (const [i,[x,z]] of [[245,55],[220,165],[115,265],[-265,190],[-165,280]].entries()) erode(x,z,48,true,973+i);
// Final finishing: the existing truck stays exactly where the level placed it.
// Preserve a 36x44 m starting pad and a broad, gently blended apron.
for (let z=455;z<=569;z++) for(let x=453;x<=571;x++) {
  const dx=Math.max(0,Math.abs(x-512)-18),dz=Math.max(0,Math.abs(z-512)-22);
  const blend=1-smooth(0,34,Math.hypot(dx,dz));
  heights[z*width+x]=mix(heights[z*width+x],0,blend);
}
assert.equal(heights[512*width+512],0);
const at=(x,z)=>heights[clamp(z,0,1024)*width+clamp(x,0,1024)];
const paint = new Uint8Array(count*4), coverage=[0,0,0,0];
let minHeight=Infinity,maxHeight=-Infinity;
console.log("Painting meadow, soil/gravel, exposed rock and broken alpine snow…");
for(let z=0;z<width;z++) for(let x=0;x<width;x++) {
  const i=z*width+x,wx=x-512,wz=z-512,h=heights[i];
  minHeight=Math.min(minHeight,h); maxHeight=Math.max(maxHeight,h);
  const dx=(at(x+1,z)-at(x-1,z))/2,dz=(at(x,z+1)-at(x,z-1))/2,slope=Math.hypot(dx,dz);
  const macro=fbm(wx,wz,70,97),small=n(wx,wz,13,54);
  const northFace=clamp(dz/Math.max(0.1,slope),-1,1);
  let snow=smooth(82,124,h+datumShift+macro*19+northFace*13)*(1-smooth(0.9,2.1,slope));
  let rock=Math.max(smooth(0.37,1.05,slope),smooth(45,110,h)*0.30+Math.max(0,small)*0.10)*(1-snow);
  const a=nearest(wx,wz,river,80),b=nearest(wx,wz,westernRiver,80),bed=Math.min(a.distance,b.distance);
  const dry=gauss(wx,wz,355,305,185,195);
  const bare=Math.max(0.07+0.19*smooth(-0.35,0.5,macro),dry*0.72,(1-smooth(10,48,bed))*0.83);
  let dirt=(1-snow-rock)*clamp(bare+0.18*smooth(0.18,0.55,slope));
  // A restrained earth apron around the truck, without painting a future road.
  const pad=1-smooth(20,39,Math.hypot(wx,wz));
  dirt=Math.max(dirt,(1-snow-rock)*pad*0.88);
  let grass=Math.max(0,1-snow-rock-dirt);
  const values=[grass,dirt,rock,snow],sum=values.reduce((a,b)=>a+b,0);
  const scaled=values.map(v=>v/sum*255),bytes=scaled.map(Math.floor);
  let remaining=255-bytes.reduce((a,b)=>a+b,0);
  const order=[0,1,2,3].sort((a,b)=>(scaled[b]-bytes[b])-(scaled[a]-bytes[a]));
  for(const k of order)if(remaining-->0)bytes[k]++;
  for(let k=0;k<4;k++){paint[i*4+k]=bytes[k];coverage[k]+=bytes[k]/255;}
}

const manifest=await json("public/assets/manifest.json");
const sourceManifest=await json(join(sourceRoot,"assets/manifest.json"));
const records=[];
const textureImports=[
  ["lt-meadow-bc","LT Meadow Base Color","ThreeAges/Textures/T_TA_Grass_Meadow_BC.webp","threeages-tex-grass-meadow-bc","LT_Meadow_BC.webp"],
  ["lt-earth-bc","LT Earth and Gravel Base Color","ThreeAges/Textures/T_TA_Road_Gravel_BC.webp","threeages-tex-road-gravel-bc","LT_Earth_BC.webp"],
];
for(const [id,name,source,idSource,file] of textureImports){
  const path=`${assetRoot}/Textures/${file}`,bytes=await readFile(join(sourceRoot,"assets",source));
  const sourceRecord=sourceManifest.assets.find(a=>a.id===idSource);assert(sourceRecord);
  await stage(path,bytes);
  records.push({...structuredClone(sourceRecord),id,name,path,thumbnail:path,category:"LandscapeTest/Textures",tags:["landscape-test","terrain","texture"],
    source:{origin:"ThreeAges",path:`assets/${source}`},runtime:{...sourceRecord.runtime,loadGroup:"LandscapeTest",bytes:bytes.length}});
}
const snowBytes=await readFile(snowPath),snowDestination=`${assetRoot}/Textures/LT_Snow_BC.png`;
await stage(snowDestination,snowBytes);
const textureTemplate=records[0];
records.push({...structuredClone(textureTemplate),id:"lt-snow-bc",name:"LT Alpine Snow Base Color",path:snowDestination,thumbnail:snowDestination,
  source:{origin:"OpenAI imagegen",pack:"LandscapeTest alpine terrain",packVersion:"2026-10-24"},license:"Project-local generated texture, 2026-10-24",
  runtime:{...textureTemplate.runtime,bytes:snowBytes.length}});
const materialTemplate=manifest.assets.find(a=>a.id==="starter-mat-grass");assert(materialTemplate);
const baseMaterial=await json("public/assets/starter-content/Materials/M_Grass.material.json");
const palette=[
  ["lt-meadow","LT Alpine Meadow","lt-meadow-bc","#c8c2a7",0.8],
  ["lt-earth","LT Earth and Scree","lt-earth-bc","#b7a48c",1.15],
  ["lt-rock","LT Weathered Mountain Rock","t-rock-basalt-d","#b8b3a5",0.60],
  ["lt-snow","LT Alpine Snow","lt-snow-bc","#f1f3f0",1.4],
];
for(const [id,name,texture,tint,tiling] of palette){
  const path=`${assetRoot}/Materials/${id}.material.json`;
  const material={...baseMaterial,name,baseColor:tint,baseColorTexture:texture,normalTexture:null,roughness:0.95,uvTiling:{x:tiling,y:tiling}};
  api.validateForgeMaterialDef(material);
  const bytes=Buffer.from(JSON.stringify(material,null,2)+"\n");await stage(path,bytes);
  records.push({...structuredClone(materialTemplate),id,name,path,category:"LandscapeTest/Materials",tags:["landscape-test","terrain","material"],
    source:{origin:"forge",pack:"LandscapeTest authored terrain"},license:"Project-local material; texture source metadata retained",
    runtime:{...materialTemplate.runtime,loadGroup:"LandscapeTest",bytes:bytes.length}});
}
for(const record of records)assert(!manifest.assets.some(a=>a.id===record.id),`Asset id already registered: ${record.id}`);
manifest.assets.push(...records);
await stage("assets/manifest.json",Buffer.from(JSON.stringify(manifest,null,2)+"\n"));
const def={...original,name:"Landscape",layers:[
  {id:"grass",name:"Alpine Meadow",color:"#7d8953",material:"lt-meadow"},
  {id:"dirt",name:"Earth and Scree",color:"#9b825d",material:"lt-earth"},
  {id:"rock",name:"Layered Rock",color:"#827b70",material:"lt-rock"},
  {id:"snow",name:"Alpine Snow",color:"#e5e7e2",material:"lt-snow"},
],tiles:[]};
const tiles=new Map();
for(let tz=0;tz<4;tz++)for(let tx=0;tx<4;tx++){
  const h=new Float32Array(257*257),w=new Uint8Array(h.length*4);
  for(let z=0;z<257;z++)for(let x=0;x<257;x++){
    const src=(tz*256+z)*width+tx*256+x,dst=z*257+x;
    h[dst]=heights[src];w.set(paint.subarray(src*4,src*4+4),dst*4);
  }
  const key=api.tileKey(tx,tz),bytes=api.encodeTerrainTile({x:tx,z:tz,size:257,heights:h,weights:w,layerCount:4},
    {heightMin:def.heightMin,heightMax:def.heightMax,heightFormat:"f32"});
  api.validateSaveTerrainTile(terrainPath,key,bytes);
  const tile=api.decodeTerrainTile(bytes),range=api.terrainTileHeightRange(tile);
  tiles.set(key,tile);def.tiles.push({key,minHeight:range.min,maxHeight:range.max});
  await stage(api.terrainTilePath(terrainPath,key),bytes);
}
let seamSamples=0;
for(let tz=0;tz<4;tz++)for(let tx=0;tx<4;tx++)for(let v=0;v<257;v++){
  for(const [other,a,b] of [[tiles.get(`${tx+1}_${tz}`),v*257+256,v*257],[tiles.get(`${tx}_${tz+1}`),256*257+v,v]]){
    if(!other)continue;const tile=tiles.get(`${tx}_${tz}`);assert.equal(tile.heights[a],other.heights[b]);
    for(let k=0;k<4;k++)assert.equal(tile.weights[a*4+k],other.weights[b*4+k]);seamSamples++;
  }
}
api.validateSaveTerrainPayload({path:terrainPath,terrain:def});
const global=api.encodeTerrainGlobalMap(def,api.buildTerrainGlobalAttributes(api.worldTerrainRenderSource(def,tiles)));
api.validateSaveTerrainGlobal(terrainPath,global);
await stage(api.terrainGlobalMapPath(terrainPath),global);
await stage(terrainPath,Buffer.from(JSON.stringify(def,null,2)+"\n"));
const summary={extent:[1024,1024],tiles:16,uniqueVertices:count,heightRange:[minHeight,maxHeight],
  datumShift,
  coverage:coverage.map((v,i)=>({layer:def.layers[i].name,percent:+(v/count*100).toFixed(2)})),
  erosionPasses,seamSamples,truckPad:{centre:[0,0,0],flatSize:[36,44]},
  sceneObjectsAdded:0,roadsPlaced:0,materialsAdded:4,texturesAdded:3,
  reference:"docs/reference/Forge Offroad_ Büyük Sculpt Formları_1.png",terrainPath,backup};
await mkdir(root,{recursive:true});
await writeFile(join(root,"summary.json"),JSON.stringify(summary,null,2));
await writeFile(join(root,"authoring-state.json"),JSON.stringify({before,outputs,backup,staged,createdAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({...summary,erosionPasses:erosionPasses.length},null,2));
