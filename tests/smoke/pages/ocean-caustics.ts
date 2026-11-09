import { BoxGeometry, DirectionalLight, FloatType, Mesh, MeshBasicMaterial, NearestFilter, NoToneMapping, OrthographicCamera, Scene, Vector3, WebGLRenderer, WebGLRenderTarget } from "three";
import { buildOceanCoverage } from "../../../engine/terrain/oceanCoverage";
import { defaultWaterCaustics } from "../../../engine/scene/waterCaustics";
import type { OceanWaterBody } from "../../../engine/scene/oceanWater";
import { OceanSurface } from "../../../engine/render-three/ocean/oceanSurface";
import { OceanFft } from "../../../engine/render-three/ocean/oceanFft";
import { OceanCausticsBinding } from "../../../engine/render-three/ocean/oceanCaustics";
import { TerrainRenderer } from "../../../engine/render-three/terrain/terrainRenderer";
import { worldTerrainRenderSource } from "../../../engine/terrain/terrainRenderSource";
import { createFlatTerrainTile, type WorldTerrainDef } from "../../../engine/terrain/terrainTypes";
import { terrainCausticsResources } from "../../../engine/render-three/terrain/terrainCaustics";

const size=256, renderer=new WebGLRenderer({canvas:document.querySelector("canvas")!,preserveDrawingBuffer:true});
renderer.setSize(640,640);renderer.toneMapping=NoToneMapping;renderer.shadowMap.enabled=true;
const scene=new Scene(),camera=new OrthographicCamera(-128,128,128,-128,.1,500);
camera.position.set(128,200,128);camera.up.set(0,0,-1);camera.lookAt(128,0,128);camera.updateMatrixWorld();
const sun=new DirectionalLight("white",2);sun.position.set(128,200,128);sun.target.position.set(128,0,128);scene.add(sun,sun.target);
sun.castShadow=true;sun.shadow.mapSize.set(512,512);sun.shadow.camera.left=sun.shadow.camera.bottom=-140;
sun.shadow.camera.right=sun.shadow.camera.top=140;sun.shadow.camera.far=400;
const height=(x:number,z:number)=>{const r=Math.hypot(x-128,z-128);return r>18&&r<30?4:-2;};
const def:WorldTerrainDef={schema:1,type:"worldTerrain",name:"Ocean seabed",tileQuads:512,spacing:.5,tilesX:1,tilesZ:1,origin:[0,0,0],heightMin:-10,heightMax:10,collision:false,
  layers:[{id:"sand",name:"Sand",color:"#9e9475"}],tiles:[{key:"0_0",minHeight:-2,maxHeight:4}]};
const tile=createFlatTerrainTile(def,0,0);
for(let z=0;z<tile.size;z++)for(let x=0;x<tile.size;x++)tile.heights[z*tile.size+x]=height(x*.5,z*.5);
const terrain=new TerrainRenderer(worldTerrainRenderSource(def,new Map([["0_0",tile]])),{terrainRef:"seabed",origin:new Vector3(),viewMode:"lit",activeLayer:0,layers:[{texture:null,color:"#9e9475",scale:1}]});
scene.add(terrain.mesh);terrain.updateLod(camera);
// A shadow caster whose colour/depth writes are disabled leaves the seabed
// visible to the camera, so paired pixels isolate the shadowed irradiance.
const box=new Mesh(new BoxGeometry(24,8,24),new MeshBasicMaterial({colorWrite:false,depthWrite:false}));
box.position.set(64,8,64);box.castShadow=true;scene.add(box);
const body:OceanWaterBody={schema:1,kind:"ocean",coordinateSpace:"world",id:"ocean",terrainRef:"seabed",bounds:{min:[0,0],max:[256,256]},
  openEdges:["west","east","north","south"],surfaceLevel:0,offshoreDepth:40,caustics:{...defaultWaterCaustics(),enabled:true,strength:2,scale:3,depthFade:30},
  appearance:{absorptionDistance:9}};
const coverage=buildOceanCoverage(body,.5,height),simulation=new OceanFft(renderer,body);simulation.update(0);
const surface=new OceanSurface(coverage,simulation);
let testClock: number | undefined;
const binding=new OceanCausticsBinding(scene,coverage,surface.coverageTexture,surface,()=>testClock??simulation.stats.time);
// The water interface is deliberately absent from the measurement scene: the
// native terrain shader is measured before its separate camera-to-surface path.
const target=new WebGLRenderTarget(size,size,{type:FloatType,minFilter:NearestFilter,magFilter:NearestFilter});
let allowed=true;
function frame(patch:{enabled?:boolean;allowed?:boolean;timeStep?:number;night?:boolean;depth?:number;absorption?:number;terrainRef?:string;clock?:number}={}) {
  testClock=patch.clock;
  if(patch.enabled!==undefined)body.caustics!.enabled=patch.enabled;
  if(patch.allowed!==undefined)allowed=patch.allowed;
  if(patch.timeStep!==undefined)simulation.update(patch.timeStep);
  if(patch.depth!==undefined)body.surfaceLevel=patch.depth-2;
  if(patch.absorption!==undefined)body.appearance!.absorptionDistance=patch.absorption;
  sun.intensity=patch.night?0:2;
  binding.update({...body,terrainRef:patch.terrainRef??"seabed"},allowed);
  renderer.setRenderTarget(target);renderer.render(scene,camera);
  const pixels=new Float32Array(size*size*4);renderer.readRenderTargetPixels(target,0,0,size,size,pixels);
  renderer.setRenderTarget(null);renderer.render(scene,camera);
  return {pixels:Array.from(pixels),time:simulation.stats.time,updates:simulation.stats.updates,draws:renderer.info.render.calls,
    textures:renderer.info.memory.textures,resources:terrainCausticsResources(scene),samplers:terrain.litFragmentSamplers,
    cells:coverage.nx*coverage.nz,glError:renderer.getContext().getError()};
}
function dispose(){binding.dispose();surface.dispose();simulation.dispose();terrain.dispose();target.dispose();box.geometry.dispose();box.material.dispose();sun.shadow.dispose();renderer.dispose();}
const lab={frame,dispose};declare global{interface Window{__oceanCaustics:typeof lab}}
window.__oceanCaustics=lab;frame();
