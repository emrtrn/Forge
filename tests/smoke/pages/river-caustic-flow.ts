import { Group, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector3, WebGLRenderer } from "three";
import { buildRiverWaterRibbon } from "../../../engine/render-three/riverWater";
import { resolveRiverWater } from "../../../engine/scene/riverWater";
import { RiverSurfaceQuery } from "../../../engine/terrain/riverSurface";
import { createTerrainCausticsUniforms, registerRiverCaustics, TERRAIN_CAUSTICS_PARS, updateTerrainCaustics } from "../../../engine/render-three/terrain/terrainCaustics";
import type { TerrainUniforms } from "../../../engine/render-three/terrain/terrainMaterial";

const renderer=new WebGLRenderer({canvas:document.querySelector("canvas")!,preserveDrawingBuffer:true,antialias:false});
renderer.setSize(800,480);
const scene=new Scene(),camera=new OrthographicCamera(-10,10,6,-6,.1,100);
camera.position.set(6,20,0);camera.up.set(0,0,-1);camera.lookAt(6,0,0);camera.updateMatrixWorld();
const water=resolveRiverWater({id:"flow",landscapeRef:"terrain",splineRef:"s",flowSpeed:5,surfaceLevel:0,
  caustics:{enabled:true,strength:1,scale:1,speed:.25,depthFade:4}});
const data=buildRiverWaterRibbon({id:"s",points:[{id:"a",position:[0,0,0],width:3,falloff:1},
  {id:"b",position:[6,0,2],width:3,falloff:1},{id:"c",position:[12,0,0],width:3,falloff:1}],
  segments:[{id:"ab",startPointId:"a",endPointId:"b"},{id:"bc",startPointId:"b",endPointId:"c"}]},
  {...water,sampleSpacing:.5,heightAt:()=>-1});
const surface=new RiverSurfaceQuery(data),owner=new Group();scene.add(owner);
registerRiverCaustics(scene,water,surface,owner);
const uniforms={...createTerrainCausticsUniforms(),uTerrainView:{value:0}};
updateTerrainCaustics(uniforms as TerrainUniforms,scene,"terrain");
const mesh=new Mesh(new PlaneGeometry(30,20),new ShaderMaterial());mesh.rotation.x=-Math.PI/2;mesh.position.set(6,-1,0);scene.add(mesh);
const edges=new Map<string,number[]>();
for(let t=0;t<data.indices.length;t+=3)for(let k=0;k<3;k++){
  const a=data.indices[t+k]!,b=data.indices[t+(k+1)%3]!,key=[Math.min(a,b),Math.max(a,b)].join(":");edges.set(key,[...(edges.get(key)??[]),t]);
}
const project=(x:number,z:number)=>new Vector3(x,-1,z).project(camera).multiply(new Vector3(400,240,1)).add(new Vector3(400,240,0));
function frame(options:{time:number;faceFlow:boolean;unbounded:boolean;pattern?:boolean}) {
  uniforms.uCausticTime.value=options.time;
  // Counterfactual shaders exist only in this fixture, reproducing the reported
  // per-face velocity and time-growing displacement against the current atlas.
  let pars=TERRAIN_CAUSTICS_PARS;
  if(options.faceFlow)pars=pars.replace("riverCausticRead(t+3)*weights.x+riverCausticRead(t+4)*weights.y+riverCausticRead(t+5)*weights.z",
    "(riverCausticRead(t+3)+riverCausticRead(t+4)+riverCausticRead(t+5))/3.0");
  mesh.material.dispose();mesh.material=new ShaderMaterial({uniforms,defines:{FORGE_TERRAIN_CAUSTIC_BODIES:1,FORGE_TERRAIN_RIVER_CAUSTICS:1,NUM_DIR_LIGHTS:0},
    vertexShader:"varying vec3 vCausticWorld;void main(){vCausticWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vCausticWorld,1.);}",
    fragmentShader:`uniform float uTerrainView;${pars}
    void main(){
      forgeCausticFootprint=max(length(dFdx(vCausticWorld)),length(dFdy(vCausticWorld)));
      ${options.pattern?"gl_FragColor=vec4(vec3(forgeCausticLight(normalize(vec3(.1,.95,.3)))*.5),1.);":`
      float level;vec2 flow;vec4 grid=uCausticGrid[0],info=uCausticRiver[0];
      if((vCausticWorld.z-grid.y)*grid.z>=uCausticArea[0].x||!riverCausticSample(vCausticWorld.xz,grid,info,level,flow)){gl_FragColor=vec4(0.,0.,0.,1.);return;}
      vec3 phase=riverFlowPhases(uCausticTime,info.w,2.);
      vec2 p=vCausticWorld.xz;
      vec2 signal=${options.unbounded?"sin((p-flow*uCausticTime)*6.2831853)":"mix(sin((p-flow/abs(info.w)*phase.y)*6.2831853),sin((p-flow/abs(info.w)*phase.x)*6.2831853),phase.z)"};
      gl_FragColor=vec4(signal*.5+.5,.5,1.);`}
    }`});
  renderer.render(scene,camera);
  const gl=renderer.getContext(),pixels=new Uint8Array(800*480*4);gl.readPixels(0,0,800,480,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const jumps:number[]=[];
  for(const [key,triangles] of edges){
    if(triangles.length!==2)continue;
    // Probe edges where the old per-face averaging actually changed velocity;
    // straight strips have identical old/new motion and cannot expose a seam.
    const average=triangles.map(t=>[0,1].map(c=>[0,1,2].reduce((sum,k)=>sum+data.flowDirections[data.indices[t+k]!*2+c]!/3,0)));
    if(Math.hypot(average[0]![0]!-average[1]![0]!,average[0]![1]!-average[1]![1]!)<.001)continue;
    const [a,b]=key.split(":").map(Number);
    const p=project(data.positions[a!*3]!,data.positions[a!*3+2]!),q=project(data.positions[b!*3]!,data.positions[b!*3+2]!);
    const dx=q.x-p.x,dy=q.y-p.y,length=Math.hypot(dx,dy);if(length<4)continue;
    const x=(p.x+q.x)*.5,y=(p.y+q.y)*.5;
    const sample=(sign:number)=>{const px=Math.round(x-sign*dy/length*.5),py=Math.round(y+sign*dx/length*.5);return (py*800+px)*4;};
    const i=sample(1),j=sample(-1);if(pixels[i+2]!==128||pixels[j+2]!==128)continue;
    jumps.push(Math.hypot(pixels[i]!-pixels[j]!,pixels[i+1]!-pixels[j+1]!));
  }
  jumps.sort((a,b)=>a-b);
  return {p95:jumps[Math.floor(jumps.length*.95)]??0,edges:jumps.length,glError:gl.getError(),draws:renderer.info.render.calls};
}
declare global {interface Window {__riverCausticFlow:{frame:typeof frame}}}
window.__riverCausticFlow={frame};frame({time:60.37,faceFlow:false,unbounded:false});
