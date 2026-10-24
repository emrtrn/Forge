import {build} from 'esbuild';
import {readFile,writeFile,mkdir,rename,access,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// LandscapeTest content only: stage, review in an isolated project, then --apply.
// Preserves the sculpted macro forms except for bounded road beds/shoulders.
const work=resolve('.dev-server/landscape-test-world'),staged=join(work,'staged/public');
const levelPath='assets/starter-content/Levels/LandscapeTest.level.json';
const terrainPath='assets/starter-content/Levels/LandscapeTest.landscapes/landscape-1.terrain.json';
const sourceRoot='C:/Users/emret/Desktop/Games/ThreeAges/public';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const exists=path=>access(path).then(()=>true,()=>false);
const put=async(base,path,bytes)=>{await mkdir(dirname(join(base,path)),{recursive:true});await writeFile(join(base,path),bytes);};
const publish=async(path,bytes)=>{
 const target=resolve('public',path);assert(target.startsWith(resolve('public')+'/')||target.startsWith(resolve('public')+'\\'));
 await mkdir(dirname(target),{recursive:true});const temporary=target+`.authoring-${process.pid}.tmp`;
 await writeFile(temporary,bytes);await rename(temporary,target);
};
if(process.argv.includes('--apply')){
 const state=await json(join(work,'authoring-state.json'));assert(!state.appliedAt,'This stage was already applied');
 for(const[path,expected]of Object.entries(state.before))assert.equal(hash(await readFile(join('public',path))),expected,`Concurrent content edit: ${path}`);
 for(const path of state.outputs)if(!state.before[path])assert(!await exists(join('public',path)),`New file already exists: ${path}`);
 // All conflict checks run before any mutation; commit references last.
 for(const path of state.outputs.filter(p=>![terrainPath,'assets/manifest.json',levelPath].includes(p)))await publish(path,await readFile(join(staged,path)));
 for(const path of[terrainPath,'assets/manifest.json',levelPath])await publish(path,await readFile(join(staged,path)));
 state.appliedAt=new Date().toISOString();await writeFile(join(work,'authoring-state.json'),JSON.stringify(state,null,2));
 console.log(`Applied ${state.outputs.length} content files. Backup: ${state.backup}`);process.exit(0);
}
await mkdir(work,{recursive:true});
const bundle=await build({bundle:true,format:'esm',platform:'node',write:false,tsconfig:'tsconfig.json',stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
 export * from './engine/terrain/terrainTileCodec'; export * from './engine/terrain/terrainTypes';
 export * from './engine/terrain/terrainGlobalMapFile'; export * from './engine/terrain/terrainRenderSource';
 export * from './engine/scene/splineCurve'; export * from './engine/scene/splineFrame';
 export * from './tools/terrainSaveValidator'; export {validateLayout,validateAssetCollisionDef,validateAssetUvwDef,validateAssetMaterialSlotsDef} from './tools/saveValidator';
 export {validateAssetManifest} from './engine/assets/manifest';
`}});
const api=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const original=await json(join('public',terrainPath)),level=await json(join('public',levelPath)),manifest=await json('public/assets/manifest.json');
assert.equal(original.tilesX,4);assert.equal(original.tilesZ,4);assert.equal(original.tileQuads,256);assert.equal(original.spacing,1);
assert.deepEqual(original.origin,[-512,0,-512]);assert.equal(level.landscapes[0].dataRef,terrainPath);
assert(!level.splines?.some(s=>s.id.startsWith('lt-')),'Authored roads already exist; review manually before regenerating');
const before={},outputs=[],backup=join(work,'backups',new Date().toISOString().replaceAll(':','-').replaceAll('.','-'));
const snapshot=async path=>{if(!before[path]&&await exists(join('public',path))){const bytes=await readFile(join('public',path));before[path]=hash(bytes);await put(backup,path,bytes);}};
for(const path of[levelPath,'assets/manifest.json',terrainPath,api.terrainGlobalMapPath(terrainPath),...original.tiles.map(t=>api.terrainTilePath(terrainPath,t.key))])await snapshot(path);
const stage=async(path,bytes)=>{await snapshot(path);await put(staged,path,bytes);if(!outputs.includes(path))outputs.push(path);};
const stageJson=(path,value)=>stage(path,Buffer.from(JSON.stringify(value,null,2)+'\n'));
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
const width=1025,count=width*width,heights=new Float32Array(count),paint=new Uint8Array(count*4);
for(const meta of original.tiles){const tile=api.decodeTerrainTile(await readFile(join('public',api.terrainTilePath(terrainPath,meta.key))));
 for(let z=0;z<257;z++)for(let x=0;x<257;x++){const dst=(tile.z*256+z)*width+tile.x*256+x,src=z*257+x;heights[dst]=tile.heights[src];paint.set(tile.weights.subarray(src*4,src*4+4),dst*4);}}
const natural=heights.slice();
function heightAt(data,x,z){const u=clamp(x+512,0,1024),v=clamp(z+512,0,1024),ix=Math.min(1023,Math.floor(u)),iz=Math.min(1023,Math.floor(v));return mix(mix(data[iz*width+ix],data[iz*width+ix+1],u-ix),mix(data[(iz+1)*width+ix],data[(iz+1)*width+ix+1],u-ix),v-iz);}
const mainKeys=[
 [0,0,0],[0,-1,50],[0,-3,95],[-25,-6,125],[-85,-15,140],[-145,-23.5,135],[-175,-23.5,125],[-205,-23.5,110],
 [-230,-23.5,90],[-255,-24,65],[-285,-20,0],[-300,-16,-65],[-285,-18,-125],[-245,-20,-155],[-190,-22,-160],
 [-140,-18,-165],[-90,-14,-160],[-40,-12,-150],[0,-8,-125],[0,-2,-70],[0,0,-25],
];
const dirtKeys=[
 [-205,-23.5,110],[-230,-23.5,140],[-250,-30,165],[-325,-34,205],[-370,-32,250],[-365,-28,305],[-315,-27,345],
 [-250,-30,375],[-190,-38,390],[-140,-48,395],[-90,-60,400],[-45,-70,380],[10,-76,350],
 [70,-70,330],[120,-64,295],[140,-57,245],[120,-50,210],[80,-42,195],[35,-34,180],
 [-15,-29,170],[-70,-27,190],[-130,-25,195],[-175,-23.5,160],[-175,-23.5,125],
];
function makeRoad(id,name,asset,widthMeters,keys,closed){
 const spline={schema:1,closed,defaultUp:[0,1,0],reparamStepsPerSegment:32,points:keys.map((position,i)=>({id:`${id}-guide-${i}`,position,pointType:'curveAuto'}))};
 // Each mesh chunk remains short enough to retain the source road's subdivision.
 const cache=api.buildSplineCurveCache(spline),points=[],steps=Math.ceil(cache.totalLength/13);
 for(let i=0;i<steps+(closed?0:1);i++){const sample=api.sampleSplineAtDistance(cache,cache.totalLength*i/steps);points.push({id:`${id}-p${i}`,position:sample.position.map(v=>+v.toFixed(3)),pointType:'curveAuto'});}
 const sourceWidth=asset==='sm-road-asphalt'?7.000000476837158:3.681493043899536;
 return{id,name,position:[0,0,0],spline:{...spline,points},generators:[{id:`${id}-surface`,type:'deformMesh',meshAsset:asset,forwardAxis:'z',upAxis:'y',sampleSteps:24,geometryMode:'segments',collisionEnabled:true,uvMode:'stretch',crossSectionScale:[widthMeters/sourceWidth,1],verticalOffset:0.025}],runtime:{tags:['landscape-test-road']},debug:{resolution:24}};
}
const roads=[{actor:makeRoad('lt-mesa-loop','01 Mesa Loop - Asphalt','sm-road-asphalt',7.5,mainKeys,true),halfWidth:3.75},
 {actor:makeRoad('lt-valley-trail','02 Valley Trail - Dirt','sm-road-dirty',6.5,dirtKeys,false),halfWidth:3.25}];
// Index dense curve segments so authoring and clearance checks remain bounded.
const cells=new Map(),cellSize=24;
const cellKey=(x,z)=>`${Math.floor(x/cellSize)}_${Math.floor(z/cellSize)}`;
for(const road of roads){const cache=api.buildSplineCurveCache(road.actor.spline);road.cache=cache;road.samples=[];road.maxGrade=0;road.minimumRadius=Infinity;
 const samples=Math.ceil(cache.totalLength/0.75);
 for(let i=0;i<=samples;i++){const frame=api.getSplineFrameAtDistance(cache,cache.totalLength*i/samples);road.samples.push(frame);road.maxGrade=Math.max(road.maxGrade,Math.abs(frame.tangent[1])/Math.hypot(frame.tangent[0],frame.tangent[2]));}
 for(let i=0;i<road.samples.length-1;i++){
  const a=road.samples[i].position,b=road.samples[i+1].position,segment={a,b,road};
  const margin=road.halfWidth+15;
  for(let cz=Math.floor((Math.min(a[2],b[2])-margin)/cellSize);cz<=Math.floor((Math.max(a[2],b[2])+margin)/cellSize);cz++)for(let cx=Math.floor((Math.min(a[0],b[0])-margin)/cellSize);cx<=Math.floor((Math.max(a[0],b[0])+margin)/cellSize);cx++){
   const key=`${cx}_${cz}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(segment);
  }
  if(i>0){const t=road.samples[i-1].tangent,u=road.samples[i+1].tangent,angle=Math.acos(clamp((t[0]*u[0]+t[2]*u[2])/Math.hypot(t[0],t[2])/Math.hypot(u[0],u[2]),-1,1));if(angle>1e-6)road.minimumRadius=Math.min(road.minimumRadius,1.5/angle);}
 }
 assert(road.maxGrade<0.27,`Road grade exceeds limit: ${road.actor.id}: ${road.maxGrade}`);
 assert(road.minimumRadius>14,`Truck turning radius too tight: ${road.minimumRadius}`);
}
function nearest(x,z){let best=null;
 for(const segment of cells.get(cellKey(x,z))??[]){const{a,b,road}=segment,dx=b[0]-a[0],dz=b[2]-a[2],t=clamp(((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz));const distance=Math.hypot(x-mix(a[0],b[0],t),z-mix(a[2],b[2],t));
  if(!best||distance<best.distance)best={distance,height:mix(a[1],b[1],t),road};
 }return best;
}
let modified=0,maxCut=0,maxFill=0;
for(let z=0;z<width;z++)for(let x=0;x<width;x++){
 const i=z*width+x,near=nearest(x-512,z-512);if(!near)continue;
 const flat=near.road.halfWidth+1.2,outer=flat+12,influence=1-smooth(flat,outer,near.distance);if(!influence)continue;
 const target=near.height-0.035-0.07*smooth(near.road.halfWidth,flat,near.distance),newHeight=mix(natural[i],target,influence);
 heights[i]=newHeight;if(Math.abs(newHeight-natural[i])>0.01){modified++;maxCut=Math.max(maxCut,natural[i]-newHeight);maxFill=Math.max(maxFill,newHeight-natural[i]);}
 const bare=0.94*(1-smooth(near.road.halfWidth+1.2,near.road.halfWidth+6,near.distance));
 if(bare>0){const w=[paint[i*4],paint[i*4+1],paint[i*4+2],paint[i*4+3]].map((v,k)=>mix(v,k===1?255:0,bare));const b=w.map(Math.floor);let left=255-b.reduce((a,v)=>a+v,0);for(const k of[0,1,2,3].sort((a,b)=>(w[b]-Math.floor(w[b]))-(w[a]-Math.floor(w[a]))))if(left-->0)b[k]++;paint.set(b,i*4);}
}
// Actual full-width road-bed samples, including both shoulders and tile seams.
let bedSamples=0,maxBedError=0,maxRoadBedMismatch=0,worstBed=null;
for(const road of roads)for(let i=0;i<road.samples.length;i+=4){const f=road.samples[i];for(const lateral of[-road.halfWidth,0,road.halfWidth]){
 const x=f.position[0]+f.binormal[0]*lateral,z=f.position[2]+f.binormal[2]*lateral;const near=nearest(x,z),actual=heightAt(heights,x,z);
 const error=Math.abs(actual-(near.height-0.035));if(error>maxBedError){maxBedError=error;worstBed={road:road.actor.id,x,z,actual,expected:near.height-0.035,index:i};}maxRoadBedMismatch=Math.max(maxRoadBedMismatch,Math.abs(actual-(f.position[1]-0.035)));bedSamples++;
}}
assert(maxBedError<0.4,`Road bed discontinuity ${maxBedError}: ${JSON.stringify(worstBed)}`);
assert(maxRoadBedMismatch<0.25,`Road/terrain mismatch at a junction: ${maxRoadBedMismatch}`);

const sourceManifest=await json(join(sourceRoot,'assets/manifest.json'));
const imports=[['resource-pinetree','lt-alpine-pine','LT Alpine Pine','LT_Alpine_Pine.glb'],['resource-tree1','lt-valley-tree','LT Valley Tree','LT_Valley_Tree.glb'],['naturemega-grass-common-tall','lt-meadow-tuft','LT Meadow Tuft','LT_Meadow_Tuft.glb'],['naturemega-rock-medium-1','lt-boulder-a','LT Boulder A','LT_Boulder_A.glb'],['naturemega-rock-medium-2','lt-boulder-b','LT Boulder B','LT_Boulder_B.glb']];
const metadata=new Map();
for(const[sourceId,id,name,file]of imports){
 const source=sourceManifest.assets.find(a=>a.id===sourceId);assert(source);assert(!manifest.assets.some(a=>a.id===id));
 const bytes=await readFile(join(sourceRoot,source.path)),path=`assets/LandscapeTest/Models/${file}`;
 // All selected models are self-contained GLBs; do not inherit foreign sidecars.
 const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'));
 assert(!(gltf.buffers??[]).some(b=>b.uri));assert(!(gltf.images??[]).some(i=>i.uri));
 const record={...structuredClone(source),id,name,path,category:'LandscapeTest/Environment',tags:['landscape-test','environment'],source:{origin:'ThreeAges',path:source.path},runtime:{...source.runtime,loadGroup:'LandscapeTest',bytes:bytes.length}};
 delete record.thumbnail;manifest.assets.push(record);metadata.set(id,{source:source.path,path,bytes:bytes.length});await stage(path,bytes);
 const stem=path.replace(/\.glb$/,'');
 const collision=id==='lt-alpine-pine'?{primitives:[{shape:'box',center:[0,0.2,0],size:[0.025,0.4,0.025]}],complexity:'simpleAndComplex',preset:'blockAll'}:id==='lt-valley-tree'?{primitives:[{shape:'box',center:[0,0.3,0],size:[0.035,0.6,0.035]}],complexity:'simpleAndComplex',preset:'blockAll'}:{primitives:[],complexity:'complexAsSimple',preset:'blockAll'};
 api.validateAssetCollisionDef(collision);await stageJson(stem+'.collision.json',collision);
 const uvw={schema:1,mapType:null,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};api.validateAssetUvwDef(uvw);await stageJson(stem+'.uvw.json',uvw);
 const materials={schema:1,slots:[]};api.validateAssetMaterialSlotsDef(materials);await stageJson(stem+'.materials.json',materials);
}
// Explicit identity sidecars avoid HTML fallback warnings for these selected roads.
for(const road of roads){const record=manifest.assets.find(a=>a.id===road.actor.generators[0].meshAsset);assert(record);await snapshot(record.path);
 const stem=record.path.replace(/\.glb$/,'');for(const[suffix,value]of[
  ['.uvw.json',{schema:1,mapType:null,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}],
  ['.materials.json',{schema:1,slots:[]}],['.collision.json',{primitives:[],complexity:'complexAsSimple',preset:'blockAll'}],
 ])if(!await exists(join('public',stem+suffix)))await stageJson(stem+suffix,value);
}
let seed=42107;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const groups=new Map(),placed=[],spacingIndex=new Map();
function plant(assetId,x,z,scale,radius,collision,rotation){
 if(x<-485||x>485||z<-485||z>485)return false;
 const near=nearest(x,z);if(near&&near.distance<near.road.halfWidth+radius+3.5)return false;
 if(Math.hypot(x,z)<26+radius)return false;
 const y=heightAt(heights,x,z),slope=Math.hypot(heightAt(heights,x+1,z)-heightAt(heights,x-1,z),heightAt(heights,x,z+1)-heightAt(heights,x,z-1))/2;
 const tree=assetId==='lt-alpine-pine'||assetId==='lt-valley-tree';
 if(tree&&(y>105||slope>0.7)||!tree&&slope>0.65)return false;
 const key=cellKey(x,z),cx=Math.floor(x/cellSize),cz=Math.floor(z/cellSize);
 for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)for(const p of spacingIndex.get(`${cx+dx}_${cz+dz}`)??[])if(Math.hypot(p.x-x,p.z-z)<p.radius+radius+0.7)return false;
 const p={x,z,radius};if(!spacingIndex.has(key))spacingIndex.set(key,[]);spacingIndex.get(key).push(p);placed.push({...p,assetId});
 if(!groups.has(assetId))groups.set(assetId,[]);
 const placement={name:`LT ${assetId==='lt-alpine-pine'?'Pine':assetId==='lt-valley-tree'?'Tree':assetId==='lt-meadow-tuft'?'Grass':'Rock'} ${groups.get(assetId).length+1}`,position:[+x.toFixed(3),+(y-(tree?0.22:assetId==='lt-meadow-tuft'?0.025:scale*0.35)).toFixed(3),+z.toFixed(3)],scale:+scale.toFixed(4),rotation:rotation??[0,+((rand()*360).toFixed(2)),0]};
 if(!collision)placement.collision=false;
 groups.get(assetId).push(placement);return true;
}
const forestGroves=[[-370,-100,85,100],[-350,15,85,100],[-175,-200,75,55],[95,-215,90,60],[-110,35,70,60],[110,-50,60,90],[-390,285,55,80],[-280,355,100,55],[240,-260,60,90],[315,-160,45,100]];
for(let i=0;i<2500;i++){const g=forestGroves[Math.floor(rand()*forestGroves.length)],r=Math.sqrt(rand()),a=rand()*Math.PI*2,x=g[0]+Math.cos(a)*g[2]*r,z=g[1]+Math.sin(a)*g[3]*r;
 const pine=rand()>0.18,h=pine?10+rand()*8:6+rand()*4,scale=pine?h/0.64:h/0.93;
 plant(pine?'lt-alpine-pine':'lt-valley-tree',x,z,scale,pine?h*0.277:h*0.39,true);
}
// Sparse scrub and boulders frame the route without intruding into its clearance.
for(let i=0;i<1800;i++){
 const road=roads[Math.floor(rand()*roads.length)],f=road.samples[Math.floor(rand()*road.samples.length)],side=rand()<0.5?-1:1,offset=side*(road.halfWidth+7+rand()*27),x=f.position[0]+f.binormal[0]*offset,z=f.position[2]+f.binormal[2]*offset;
 if(rand()<0.62){const scale=0.3+rand()*0.35;plant('lt-meadow-tuft',x,z,scale,scale*0.6,false);}
 else{const scale=0.6+rand()*1.3,asset=rand()<0.5?'lt-boulder-a':'lt-boulder-b';plant(asset,x,z,scale,scale*1.7,true,[+(rand()*14-7).toFixed(2),+(rand()*360).toFixed(2),+(rand()*14-7).toFixed(2)]);}
}
// A few larger rock groups at mountain feet, away from the road and truck.
for(let i=0;i<220;i++){const x=-460+rand()*920,z=rand()<0.65?-450+rand()*260:200+rand()*240,y=heightAt(heights,x,z);if(y<5)continue;const scale=1.2+rand()*2.6;plant(rand()<0.5?'lt-boulder-a':'lt-boulder-b',x,z,scale,scale*1.7,true);}
level.splines=[...(level.splines??[]),...roads.map(r=>r.actor)];
for(const[assetId,placements]of groups){const existing=level.instances.find(g=>g.assetId===assetId);if(existing)existing.placements.push(...placements);else level.instances.push({assetId,placements});}
level.targetPoints=[...(level.targetPoints??[]),{id:'lt-start',name:'LT Start / Mesa Loop',position:[0,0,0]},
 {id:'lt-trail-fork',name:'LT Valley Trail Fork',position:[-205,-23.5,110]},{id:'lt-valley-bottom',name:'LT Valley Overlook',position:[10,-76,350]}];
// The sculpted valley lies below the engine's default character kill plane.
level.worldSettings={...level.worldSettings,killZ:-160};
const clean=api.validateLayout(level);assert.deepEqual(clean.splines,level.splines,'Roads must survive editor save');
assert.equal(clean.instances.reduce((n,g)=>n+g.placements.length,0),level.instances.reduce((n,g)=>n+g.placements.length,0));
// Use validated new fields while retaining unrelated authored settings verbatim.
level.instances=clean.instances;level.splines=clean.splines;level.targetPoints=clean.targetPoints;
assert.equal(clean.worldSettings.killZ,-160);
const baselineLevel=await json(join(backup,levelPath));
for(const key of['actors','landscapes','skyAtmosphere','cloudLayer','postProcess','lights'])assert.deepEqual(level[key],baselineLevel[key],`Unrelated authored field changed: ${key}`);
await stageJson(levelPath,level);await stageJson('assets/manifest.json',manifest);
const def={...original,tiles:[]},tiles=new Map();
for(let tz=0;tz<4;tz++)for(let tx=0;tx<4;tx++){
 const h=new Float32Array(257*257),w=new Uint8Array(h.length*4);
 for(let z=0;z<257;z++)for(let x=0;x<257;x++){const src=(tz*256+z)*width+tx*256+x,dst=z*257+x;h[dst]=heights[src];w.set(paint.subarray(src*4,src*4+4),dst*4);}
 const key=api.tileKey(tx,tz),bytes=api.encodeTerrainTile({x:tx,z:tz,size:257,heights:h,weights:w,layerCount:4},{heightMin:def.heightMin,heightMax:def.heightMax,heightFormat:'f32'});
 api.validateSaveTerrainTile(terrainPath,key,bytes);const tile=api.decodeTerrainTile(bytes),range=api.terrainTileHeightRange(tile);tiles.set(key,tile);def.tiles.push({key,minHeight:range.min,maxHeight:range.max});await stage(api.terrainTilePath(terrainPath,key),bytes);
}
let seamSamples=0;
for(let tz=0;tz<4;tz++)for(let tx=0;tx<4;tx++)for(let v=0;v<257;v++)for(const[other,a,b]of[[tiles.get(`${tx+1}_${tz}`),v*257+256,v*257],[tiles.get(`${tx}_${tz+1}`),256*257+v,v]]){
 if(!other)continue;const tile=tiles.get(`${tx}_${tz}`);assert.equal(tile.heights[a],other.heights[b]);for(let k=0;k<4;k++)assert.equal(tile.weights[a*4+k],other.weights[b*4+k]);seamSamples++;
}
api.validateSaveTerrainPayload({path:terrainPath,terrain:def});const global=api.encodeTerrainGlobalMap(def,api.buildTerrainGlobalAttributes(api.worldTerrainRenderSource(def,tiles)));api.validateSaveTerrainGlobal(terrainPath,global);
await stage(api.terrainGlobalMapPath(terrainPath),global);await stageJson(terrainPath,def);
async function filesUnder(path,prefix='assets'){const files=[];for(const e of await readdir(path,{withFileTypes:true}))if(e.isDirectory())files.push(...await filesUnder(join(path,e.name),prefix+'/'+e.name));else files.push(prefix+'/'+e.name);return files;}
const publicFiles=await filesUnder('public/assets'),baseline=api.validateAssetManifest(await json(join(backup,'assets/manifest.json')),{publicFiles}),after=api.validateAssetManifest(manifest,{publicFiles:[...new Set([...publicFiles,...outputs])]});
const issueKeys=report=>report.issues.filter(i=>i.level==='error'||i.level==='warning').map(i=>`${i.level}:${i.code}:${i.assetId??i.path}`).sort();assert.deepEqual(issueKeys(after),issueKeys(baseline),'New content must not introduce asset errors/warnings');
const summary={roads:roads.map(r=>({id:r.actor.id,name:r.actor.name,lengthMeters:+r.cache.totalLength.toFixed(1),widthMeters:r.halfWidth*2,maxGradePercent:+(r.maxGrade*100).toFixed(2),minimumTurnRadiusMeters:+r.minimumRadius.toFixed(2),controlPoints:r.actor.spline.points.length,closed:r.actor.spline.closed,collision:true})),terrain:{modifiedSamples:modified,modifiedPercent:+(modified/count*100).toFixed(2),maxCut:+maxCut.toFixed(2),maxFill:+maxFill.toFixed(2),bedSamples,maxBedError,maxRoadBedMismatch,seamSamples},environment:[...groups].map(([assetId,placements])=>({assetId,count:placements.length})),importedModels:[...metadata].map(([id,data])=>({id,...data})),assetValidation:{before:{errors:baseline.errorCount,warnings:baseline.warningCount},after:{errors:after.errorCount,warnings:after.warningCount}},actorsUnchanged:true,lightingUnchanged:true,backup};
await writeFile(join(work,'summary.json'),JSON.stringify(summary,null,2));
await writeFile(join(work,'authoring-state.json'),JSON.stringify({before,outputs,backup,staged,createdAt:new Date().toISOString()},null,2));
console.log(JSON.stringify(summary,null,2));
