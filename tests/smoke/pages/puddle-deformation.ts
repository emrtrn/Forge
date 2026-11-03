import { Color, OrthographicCamera, Scene, WebGLRenderTarget, type PerspectiveCamera, type WebGLRenderer, type Group } from "three";
import { buildTerrainPuddle } from "@engine/terrain/terrainPuddle";
import { puddleRippleStops } from "@engine/terrain/puddleInteraction";
import { TerrainPuddleSurface } from "@engine/render-three/terrain/terrainPuddleSurface";
import { PUDDLE_WHEEL_RIPPLE_DEFAULTS } from "@engine/scene/puddleWater";
import { createForgeRuntime } from "@/scene/ForgeRuntime";
import { createDefaultRuntimeModules } from "@/scene/capabilities/defaultRuntimeModules";
import { terrainDeformationService } from "@/scene/capabilities/runtimeServiceKeys";
import type { RuntimeServices } from "@/scene/capabilities/RuntimeServices";
import { createGameModule } from "@/game/gameModule";
import type { PhysicsSubsystem } from "@engine/physics/physicsSubsystem";
import type { EngineApp } from "@engine/core/EngineApp";
import type { PuddleWaterController } from "@/scene/puddleWaterController";
import { sharedTerrainDeformation } from "@engine/render-three/terrain/terrainDeformation";
import { updateLandscapeLod } from "@engine/render-three/landscape";
import { terrainRendererOf } from "@engine/render-three/terrain/terrainRenderer";

let services: RuntimeServices | null = null;
const forge = await createForgeRuntime({ canvas: document.querySelector("canvas")!, modules: [...createDefaultRuntimeModules(),
  { id: "puddle-bed-qa", onRuntimeStart(value) { services = value; } }], gameModules: [createGameModule()] });
await forge.loadLevel("layouts/__playwright-puddle-bed.level.json");
const a = forge.app as unknown as { physicsSubsystem: PhysicsSubsystem; engineApp: EngineApp; puddles: PuddleWaterController;
  frameHandle: number; scene: Scene; camera: PerspectiveCamera; renderer: WebGLRenderer; landscapeObjects: Group[] };
forge.start(); cancelAnimationFrame(a.frameHandle);
const physics = a.physicsSubsystem, id = physics.vehicleEntityIds()[0]!;
const debug = { value: 0 };
const rippleDebug = { value: 0 };
const waterMaterial = a.puddles.objects.get("puddle-1")!.material, compileWater = waterMaterial.onBeforeCompile;
waterMaterial.onBeforeCompile = (shader, renderer) => {
  compileWater(shader, renderer); shader.uniforms.uRippleDebug = rippleDebug;
  shader.fragmentShader = `uniform float uRippleDebug;\n${shader.fragmentShader}`.replace("#include <opaque_fragment>", "if(uRippleDebug>.5){gl_FragColor=vec4(vec2(.5)+gradient*3.,.5,1.);return;}\n#include <opaque_fragment>");
};
waterMaterial.customProgramCacheKey = () => "puddle-vehicle-ripple-debug";
waterMaterial.needsUpdate = true;
for (const root of a.landscapeObjects) root.traverse(object => {
  const terrain = terrainRendererOf(object); if (!terrain) return;
  const material = terrain.mesh.material, before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer); shader.uniforms.uPuddleBedDebug = debug;
    shader.fragmentShader = `uniform float uPuddleBedDebug;\n${shader.fragmentShader}`.replace("#include <opaque_fragment>", `if(uPuddleBedDebug>.5){gl_FragColor=vec4(forgePuddle,0.,0.,1.);return;}\n#include <opaque_fragment>`);
  };
  const cache = material.customProgramCacheKey.bind(material); material.customProgramCacheKey = () => `${cache()}:puddle-bed-qa`;
  material.needsUpdate = true;
});
const read = () => {
  const state = physics.vehicleState(id), texture = sharedTerrainDeformation(), water = a.puddles.objects.get("puddle-1");
  let maxDepth = 0, wet = 0, dry = 0;
  for (let z = -5; z <= 5; z += .25) for (let x = -3; x <= 3; x += .25) {
    const sample = a.puddles.sample("terrain", x, z);
    if (sample) { wet++; maxDepth = Math.max(maxDepth, sample.depth); } else dry++;
  }
  const positions = water?.geometry.getAttribute("position"); let maxLevelError = 0;
  for (let i = 0; positions && i < positions.count; i++) maxLevelError = Math.max(maxLevelError, Math.abs(positions.getY(i) - .2));
  const stats = (services as RuntimeServices | null)?.resolve(terrainDeformationService)?.snapshot();
  return { vehicles: physics.vehicleEntityIds().length, contacts: state?.wheels.filter(w => w.inContact).length ?? 0,
    tracks: stats?.activeCells ?? 0, rutDepth: stats?.maxDepth ?? 0, wet, dry, maxDepth, maxLevelError, ripples: water?.wheelRippleCount ?? 0,
    revision: texture.bedRevision, waterRevision: a.puddles.results.get("puddle-1")?.bedRevision, result: a.puddles.results.get("puddle-1"),
    glError: a.renderer.getContext().getError() };
};
async function advance(steps: number, push = false) {
  for (let i = 0; i < steps; i++) {
    if (push && i % 15 === 0) {
      const motion = physics.vehicleMotion(id)!, mass = physics.vehicleDefinition(id)!.massKg;
      physics.applyImpulse(id, [-motion.linearVelocity[0] * mass, 0, (2 - motion.linearVelocity[2]) * mass]);
    }
    // Actual capability tick slots, Rapier wheel contacts and field uploads.
    a.engineApp.update(1 / 60);
    if (i % 30 === 29) { await new Promise(resolve => setTimeout(resolve, 110)); a.puddles.update(); await a.puddles.whenIdle(); }
  }
  await new Promise(resolve => setTimeout(resolve, 110)); a.puddles.update(); await a.puddles.whenIdle();
  return read();
}
function render(water = true) {
  rippleDebug.value = 0;
  const surface = a.puddles.objects.get("puddle-1")!; surface.material.visible = water;
  a.camera.position.set(6, 5, 8); a.camera.lookAt(0, .1, 0); a.camera.updateMatrixWorld(true);
  for (const root of a.landscapeObjects) updateLandscapeLod(root, a.camera);
  a.renderer.render(a.scene, a.camera); return read();
}
function filmProbe() {
  const surface = a.puddles.objects.get("puddle-1")!; surface.material.visible = false; debug.value = 1;
  const target = new WebGLRenderTarget(256, 256), samples: number[] = [];
  try {
    for (const enabled of [true, false]) {
      surface.visible = enabled; a.renderer.setRenderTarget(target); a.renderer.render(a.scene, a.camera);
      const pixels = new Uint8Array(256 * 256 * 4); a.renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
      let total = 0; for (let i = 0; i < pixels.length; i += 4) total += pixels[i]!; samples.push(total);
    }
  } finally { target.dispose(); a.renderer.setRenderTarget(null); surface.visible = true; surface.material.visible = true; debug.value = 0; }
  return { masked: samples[0], unmasked: samples[1], glError: a.renderer.getContext().getError() };
}
function rippleProbe() {
  const surface = a.puddles.objects.get("puddle-1")!, target = new WebGLRenderTarget(256,256), frames: Uint8Array[] = [];
  const count = surface.wheelRippleCount;
  try {
    surface.material.visible = true; rippleDebug.value = 1;
    for (const enabled of [true,false]) {
      if (!enabled) surface.clearRipples();
      a.renderer.setRenderTarget(target); a.renderer.render(a.scene,a.camera);
      const pixels = new Uint8Array(256*256*4); a.renderer.readRenderTargetPixels(target,0,0,256,256,pixels); frames.push(pixels);
    }
  } finally { rippleDebug.value = 0; target.dispose(); a.renderer.setRenderTarget(null); a.puddles.advanceWheelInteractions(1/60); }
  let changed = 0, delta = 0;
  for(let i=0;i<frames[0]!.length;i+=4) {
    const d = Math.abs(frames[0]![i]!-frames[1]![i]!) + Math.abs(frames[0]![i+1]!-frames[1]![i+1]!);
    if(d>2) changed++; delta+=d;
  }
  return { count,changed,delta,glError:a.renderer.getContext().getError() };
}
function barrierProbe() {
  const scene = new Scene(); scene.background = new Color("black");
  const camera = new OrthographicCamera(-4,4,4,-4,.1,20); camera.position.set(0,10,0); camera.up.set(0,0,-1); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
  const surface = new TerrainPuddleSurface(), target = new WebGLRenderTarget(128,128);
  const data = buildTerrainPuddle({minX:-4,minZ:-4,size:8,cellSize:.125,level:0,seed:[-2,0]},(x,z)=>Math.max(Math.abs(x),Math.abs(z))>3.5 || Math.abs(x)<.3 && Math.abs(z)<.8 ? .2 : -.2);
  surface.rebuild(data); scene.add(surface);
  const compile = surface.material.onBeforeCompile;
  surface.material.onBeforeCompile = (shader,renderer) => {
    compile(shader,renderer); shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>","gl_FragColor=vec4(vec3(clamp(length(gradient)*20.,0.,1.)),1.);return;\n#include <opaque_fragment>");
  };
  surface.material.customProgramCacheKey = () => "puddle-island-ripple-debug";
  const settings = {...PUDDLE_WHEEL_RIPPLE_DEFAULTS,wheelRippleSpeed:1,wheelRippleLifetime:4,wheelRippleStrength:3,wheelRippleWidth:.18};
  const frames: { shadow:number; free:number }[] = [];
  try {
    for(const blocked of [false,true]) {
      surface.setWheelRipples([{x:-2,z:0,age:2.6,strength:1}],settings,[blocked ? puddleRippleStops(-2,0,data.shore!,5) : new Float32Array(32).fill(5)]);
      a.renderer.setRenderTarget(target); a.renderer.render(scene,camera);
      const pixels = new Uint8Array(128*128*4); a.renderer.readRenderTargetPixels(target,0,0,128,128,pixels);
      let shadow=0,free=0;
      for(let j=0;j<128;j++) for(let i=0;i<128;i++) {
        const x=-4+(i+.5)/16,z=-4+(j+.5)/16,red=pixels[(j*128+i)*4]!;
        if(x>.35 && x<.95 && Math.abs(z)<.25) shadow+=red;
        if(Math.abs(x+2)<.25 && Math.abs(Math.abs(z)-2.6)<.25) free+=red;
      }
      frames.push({shadow,free});
    }
  } finally { a.renderer.setRenderTarget(null); target.dispose(); surface.dispose(); }
  return {open:frames[0],blocked:frames[1],status:data.status,glError:a.renderer.getContext().getError()};
}
Object.assign(window, { puddleBedQA: { read, advance, render, filmProbe, rippleProbe, barrierProbe,
  renderRippleDebug: () => { rippleDebug.value=1; a.renderer.render(a.scene,a.camera); },
  remove: async () => { await a.puddles.rebuild([]); return a.scene.getObjectsByProperty("name", "puddle:puddle-1").length; } } });
