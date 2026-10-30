import {
  ACESFilmicToneMapping, BoxGeometry, DirectionalLight, DoubleSide, Color, DataTexture, Group, Matrix4, Mesh, MeshBasicMaterial, PMREMGenerator,
  NearestFilter, OrthographicCamera, PerspectiveCamera, PlaneGeometry, RepeatWrapping, RGBAFormat,
  Scene, SRGBColorSpace, TextureLoader, Vector2, Vector3, WebGLRenderer,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { createRiverWaterObject, type RiverWaterObject } from "@engine/render-three/riverWater";
import { resolveRiverWater } from "@engine/scene/riverWater";
import type { ForgeLandscapeSpline } from "@engine/scene/landscape";
import type { SphereReflectionCaptureBake } from "@engine/render-three/reflectionCapture";
import { LakeWaterObject } from "@engine/render-three/lakeWater";
import { SunCascadeShadow } from "@engine/render-three/sunCascadeShadow";
import { PostProcessPipeline } from "@engine/render-three/postProcess";

export interface OpticsOptions {
  reflectionQuality: "low" | "medium" | "high";
  lakePlanar: boolean;
  surfaceStrength: number;
  surfaceRoughness: number;
  flowSpeed: number;
  sampleSpacing: number;
  realNormalMap: boolean;
  hdrSun: boolean;
  bloom: boolean;
  faceShading: boolean;
  unboundedFlow: boolean;
  normalDiagnostic: "beauty" | "optical" | "geometric" | "smooth";
  refractionStrength: number;
  refractionQA: boolean;
  refractionAllowed: boolean;
  waveAmplitude: number;
  foreground: boolean;
  hole: boolean;
  dryBank: boolean;
  sunTest: boolean;
  shadowCaster: boolean;
  shadowSystem: "single" | "cascade" | "disabled";
  sunTerm: "all" | "body" | "glint" | "ibl";
  sceneTransmission: boolean;
  sceneBedDepth: number | null;
  kind: "river" | "lake";
  isolateReflection: boolean;
  angle: "top" | "grazing" | "below";
  pipeline: "direct" | "composer";
  depth: number;
  reflection: "off" | "red" | "blue";
  visible: boolean;
  bedVisibility: number;
  absorptionDistance: number;
  opacity: number;
  foamOpacity: number;
  time: number;
  normalMap: boolean;
  calibration: boolean;
  exposure: number;
  transformed: boolean;
  slope: number;
  orthographic: boolean;
  localProbe: boolean;
  companion: boolean;
  companionKind: "river" | "lake";
  companionHeight: number;
  reverseOrder: boolean;
  earlyGlass: boolean;
}

const canvas = document.querySelector("canvas")!;
const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.info.autoReset = false;
renderer.setPixelRatio(1);
renderer.setSize(800, 480, false);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
const scene = new Scene();
scene.background = new Color("#485360");
const perspectiveCamera = new PerspectiveCamera(48, 800 / 480, 0.01, 100);
const orthographicCamera = new OrthographicCamera(-9, 9, 5.4, -5.4, 0.01, 100);
let camera: PerspectiveCamera | OrthographicCamera = perspectiveCamera;
const composer = new EffectComposer(renderer);
const scenePipeline = new PostProcessPipeline({ renderer, scene, camera, width: 800, height: 480 });
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new Vector2(800,480), .8, .3, 1);
bloom.enabled=false;composer.addPass(bloom);
composer.addPass(new OutputPass());
const pipelineBloom = new UnrealBloomPass(new Vector2(800,480), .8, .3, 1);
pipelineBloom.enabled=false;scenePipeline.setEffectPasses([pipelineBloom]);
const sun = new DirectionalLight(0xffffff, 5);
sun.position.set(0, 4, -24);
sun.castShadow = true;
sun.shadow.mapSize.set(1024,1024);
Object.assign(sun.shadow.camera, {left:-20,right:20,top:20,bottom:-20,near:0.1,far:100});
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun, sun.target);
const sunDisc = new Group();
sunDisc.userData.waterSunDiscRadiance = new Vector3(1500,1400,1200);
sunDisc.userData.waterSunDiscDirection = sun.position.clone().normalize();
sunDisc.visible=false;scene.add(sunDisc);
const cascades = new SunCascadeShadow(scene);
const occluder = new Mesh(new PlaneGeometry(8, 10), new MeshBasicMaterial({side:DoubleSide}));
occluder.rotation.x = -Math.PI/2;
occluder.position.set(-4,2,-12);
occluder.castShadow = true;
scene.add(occluder);
const fixtureGroup = new Group();
scene.add(fixtureGroup);

// A one-metre checkerboard makes transmission observable through contrast,
// independently of the tint. Textures are generated here, with no asset IO.
const checker = new DataTexture(new Uint8Array([
  12, 12, 12, 255, 240, 240, 240, 255,
  240, 240, 240, 255, 12, 12, 12, 255,
]), 2, 2, RGBAFormat);
checker.colorSpace = SRGBColorSpace;
checker.wrapS = checker.wrapT = RepeatWrapping;
checker.repeat.set(8, 4);
checker.magFilter = checker.minFilter = NearestFilter;
checker.needsUpdate = true;
const bedMaterial = new MeshBasicMaterial({ map: checker });
const bed = new Mesh(new PlaneGeometry(16, 8), bedMaterial);
bed.rotation.x = -Math.PI / 2;
fixtureGroup.add(bed);
const foreground = new Mesh(new BoxGeometry(2, 1, 2), new MeshBasicMaterial({color: "#ff0000"}));
foreground.position.y = 0.25;
foreground.visible = false;
fixtureGroup.add(foreground);
const earlyGlass = new Mesh(new PlaneGeometry(16, 8), new MeshBasicMaterial({
  color: "#ff0000", transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide,
}));
earlyGlass.rotation.x = -Math.PI / 2;
earlyGlass.position.y = -0.05;
earlyGlass.renderOrder = -100;
earlyGlass.visible = false;
fixtureGroup.add(earlyGlass);
const generator = new PMREMGenerator(renderer);
const captureScene = new Scene();
captureScene.background = new Color(1, 0, 0);
const redEnvironment = generator.fromScene(captureScene, 0, 0.1, 100, { size: 256 });
captureScene.background.setRGB(0, 0, 1);
const blueEnvironment = generator.fromScene(captureScene, 0, 0.1, 100, { size: 64 });
generator.dispose();
const reflectionTextures = { red: redEnvironment.texture, blue: blueEnvironment.texture };
const planarTextures = {
  red: new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, RGBAFormat),
  blue: new DataTexture(new Uint8Array([0, 0, 255, 255]), 1, 1, RGBAFormat),
};
for (const texture of Object.values(planarTextures)) texture.needsUpdate = true;
const localBake: SphereReflectionCaptureBake = { target: blueEnvironment, position: [0, 0, 0], radius: 30,
  intensity: 1, priority: 1, resolution: 64, parallax: false, near: 0.1, far: 100 };
const normals = new DataTexture(new Uint8Array([
  180, 128, 240, 255, 76, 150, 240, 255,
  128, 180, 240, 255, 150, 76, 240, 255,
]), 2, 2, RGBAFormat);
normals.wrapS = normals.wrapT = RepeatWrapping;
normals.needsUpdate = true;
const realNormals = await new TextureLoader().loadAsync("/assets/starter-content/Textures/T_Water_N.png");
realNormals.wrapS=realNormals.wrapT=RepeatWrapping;realNormals.needsUpdate=true;
const spline: ForgeLandscapeSpline = {
  id: "optics", points: [
    { id: "a", position: [-8, 0, 0], width: 4, falloff: 0 },
    { id: "b", position: [8, 0, 0], width: 4, falloff: 0 },
  ], segments: [{ id: "ab", startPointId: "a", endPointId: "b" }],
};
let options: OpticsOptions = {
  reflectionQuality: "medium", lakePlanar: true, surfaceStrength: 1, surfaceRoughness: 0.22,
  flowSpeed:.35,sampleSpacing:.5,realNormalMap:false,hdrSun:false,bloom:false,faceShading:false,unboundedFlow:false,normalDiagnostic:"beauty",
  refractionStrength: 0, refractionQA: false, refractionAllowed: true, waveAmplitude: 0, foreground: false, hole: false, dryBank: false,
  sunTest: false, shadowCaster: false, shadowSystem: "single", sunTerm: "all",
  sceneTransmission: false,
  sceneBedDepth: null,
  kind: "river",
  isolateReflection: false,
  angle: "top", pipeline: "direct", depth: 1, reflection: "off", visible: true,
  bedVisibility: 1, absorptionDistance: 2, opacity: 0, foamOpacity: 0,
  time: 0, normalMap: false, calibration: false, exposure: 0.2,
  transformed: false, slope: 0, orthographic: false, localProbe: false, companion: false, companionKind:"river", companionHeight:0, reverseOrder: false, earlyGlass: false,
};
let river: RiverWaterObject | LakeWaterObject;
let companion: RiverWaterObject | LakeWaterObject | null = null;

function lakeData(source: RiverWaterObject) {
  const geometry=source.geometry;
  return { status:"ready" as const,message:"fixture",position:[0,0,0] as [number,number,number],escapeLevel:null,
    positions:new Float32Array(geometry.getAttribute("position").array),depths:new Float32Array(geometry.getAttribute("waterDepth").array),
    uvs:new Float32Array(geometry.getAttribute("uv").array),indices:new Uint32Array(geometry.index!.array),
    shore:new Float32Array(),cuts:new Float32Array(),cells:1,bytes:0,buildMs:0 };
}

function frame(patch: Partial<OpticsOptions> = {}) {
  options = { ...options, ...patch };
  if (river) { fixtureGroup.remove(river); river.dispose(); }
  if (companion) { fixtureGroup.remove(companion); companion.dispose(); companion = null; }
  const slopedSpline = { ...spline, points: spline.points.map((point) => ({ ...point,
    position: [point.position[0], point.position[0] * options.slope, point.position[2]] as [number, number, number],
  })) };
  river = createRiverWaterObject({
    ...resolveRiverWater({ id: "optics", landscapeRef: "fixture", splineRef: "optics",
      surfaceLevel: -8 * options.slope, bedVisibility: options.calibration ? 0 : options.bedVisibility, absorptionDistance: options.absorptionDistance,
      opacity: options.opacity, foamOpacity: options.foamOpacity, waveAmplitude: options.waveAmplitude,
      flowSpeed: options.flowSpeed,
      refractionStrength: options.refractionStrength,
      reflectionQuality: options.reflectionQuality,
      surfaceStrength: options.surfaceStrength, surfaceRoughness: options.surfaceRoughness,
      reflectionStrength: 1,
      reflectionMode: options.reflection === "off" ? "off" : "environment",
      ...(options.calibration ? { deepColor: "#808080", shallowColor: "#808080" } : {}),
      ...(options.isolateReflection ? { deepColor: "#000000", shallowColor: "#000000" } : {}),
    }),
    spline: slopedSpline, heightAt: (x,z) => options.hole && Math.abs(x)<0.6 ? null
      : options.dryBank && z>0 ? 5 : x * options.slope - options.depth, sampleSpacing: options.sampleSpacing,
    position: [0, 0, 0], rotation: [0, 0, 0], foamNoiseMap: null,
    refractionAllowed: options.refractionAllowed,
    environmentProbes: () => options.localProbe ? [localBake] : [],
  }, options.normalMap ? options.realNormalMap ? realNormals : normals : null);
  if (options.kind === "lake") {
    const lake = new LakeWaterObject({ schema: 1, id: "optics", kind: "lake", mode: "fillExisting", coordinateSpace: "world",
      terrainRef: "fixture", bounds: { min: [-8, -4], max: [8, 4] }, seed: [0, 0], surfaceLevel: 0,
      appearance: { opacity: options.opacity, bedVisibility: options.bedVisibility, absorptionDistance: options.absorptionDistance,
        reflectionStrength: 1, rippleSpeed: 0.15,
        reflectionMode: options.reflection === "off" ? "off" : "sharedPlanar",
        surfaceStrength: options.surfaceStrength, surfaceRoughness: options.surfaceRoughness, surfaceWavesEnabled:false,
        refractionStrength: 0,
        ...(options.isolateReflection ? { deepColor: "#000000", shallowColor: "#000000" } : {}) } }, lakeData(river), options.normalMap ? normals : null);
    if (options.reflection !== "off" && options.lakePlanar) lake.setPlanarReflectionBinding({
      texture: planarTextures[options.reflection],
      textureMatrix: new Matrix4().set(.03, 0, 0, .5, 0, 0, .03, .5, 0, 0, 0, 0, 0, 0, 0, 1),
    });
    river.dispose(); river = lake;
  }
  // Test-only deterministic clock; production's onBeforeRender uses wall time.
  const beforeRender = river.onBeforeRender;
  river.onBeforeRender = function (...args) {
    beforeRender.apply(this, args);
    river.material.uniforms.time!.value = options.time;
    // Freeze geometric Lake waves too: screenshots/rebuild duration must not
    // change the fixture while comparisons hold the optical clock constant.
    if (river.material.uniforms.surfaceWaveTime) river.material.uniforms.surfaceWaveTime.value = options.time;
  };
  // Hold illumination neutral while reflection input changes red <-> blue.
  river.material.uniforms.waterLightingEnabled!.value = options.sunTest || options.hdrSun ? 1 : 0;
  if(options.faceShading) river.material.fragmentShader=river.material.fragmentShader.replace("vec3 shadingNormal = normalize(vShadingNormal);","vec3 shadingNormal = surfaceNormal;");
  if(options.unboundedFlow) river.material.fragmentShader=river.material.fragmentShader.replace(
    /  vec3 flowPhases = riverFlowPhases[\s\S]*?  vec2 slope = mix\(slopeB, slopeA, flowPhases.z\)[^;]*;/,
    "  vec2 slope = lakeSurfaceSlopes(advected * normalScale * 0.12, time * flowSpeed) * 0.10 * (1.0 + vRapidness * 0.5);");
  if(options.normalDiagnostic!=="beauty") {
    const normal=options.normalDiagnostic==="optical"?"opticalNormal":options.normalDiagnostic==="smooth"?"shadingNormal":"surfaceNormal";
    river.material.fragmentShader=river.material.fragmentShader.replace("#include <fog_fragment>",`#include <fog_fragment>\ngl_FragColor=vec4(${normal}*.5+.5,1.);`);
  }
  if (options.sunTest) {
    if (options.sunTerm === "body" || options.sunTerm === "ibl") river.material.fragmentShader = river.material.fragmentShader.replace(
      "waterSunGlint(opticalNormal, viewDirection, sunRoughness, sunVisibility)", "vec3(0.0)");
    if (options.sunTerm === "glint" || options.sunTerm === "ibl") river.material.fragmentShader = river.material.fragmentShader.replace(
      "waterSurfaceLight(opticalNormal, viewDirection, 0.38, sunVisibility)", "waterSurfaceLight(opticalNormal, viewDirection, 0.38, 0.0)");
  }
  sun.visible = options.sunTest || options.hdrSun;
  sunDisc.visible=options.hdrSun;
  bloom.enabled=pipelineBloom.enabled=options.bloom;
  occluder.visible = options.sunTest && options.shadowCaster;
  renderer.shadowMap.enabled = options.sunTest && options.shadowSystem !== "disabled";
  cascades.deactivate();
  river.visible = options.visible;
  scene.environment = options.reflection === "off" ? null : reflectionTextures[options.reflection];
  fixtureGroup.add(river);
  if (options.companion) {
    companion = createRiverWaterObject({
      ...resolveRiverWater({ id: "companion", landscapeRef: "fixture", splineRef: "optics",
        surfaceLevel: -8 * options.slope, opacity: 1, refractionStrength: 0,
        deepColor: "#ff0000", shallowColor: "#ff0000", reflectionMode: "off", waveAmplitude: 0, foamOpacity: 0 }),
      spline: slopedSpline, heightAt: (x) => x * options.slope - 2, sampleSpacing: 0.5,
      position: [0, 0, 0], rotation: [0, 0, 0], foamNoiseMap: null,
    }, null);
    if(options.companionKind==="lake") {
      const lake=new LakeWaterObject({schema:1,id:"companion-lake",kind:"lake",mode:"fillExisting",coordinateSpace:"world",terrainRef:"fixture",
        bounds:{min:[-8,-4],max:[8,4]},seed:[0,0],surfaceLevel:0,
        appearance:{deepColor:"#ff0000",shallowColor:"#ff0000",opacity:1,bedVisibility:0,reflectionMode:"off",refractionStrength:0,surfaceWavesEnabled:false,foamEnabled:false}},
        lakeData(companion),null);
      companion.dispose();companion=lake;
    }
    companion.position.y=options.companionHeight;
    // Coincident water is deliberately last-draw-wins. The earlier surface
    // must never be present in the shared bed image, regardless of its draw order.
    companion.renderOrder = options.reverseOrder ? -2 : 2;
    river.renderOrder = options.reverseOrder ? 2 : -2;
    fixtureGroup.add(companion);
  }
  const positions = bed.geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) positions.setZ(i, positions.getX(i) * options.slope);
  positions.needsUpdate = true;
  bed.geometry.computeBoundingSphere();
  bed.position.y = -(options.sceneBedDepth ?? options.depth);
  const bedMap = options.isolateReflection ? null : checker;
  if (bedMaterial.map !== bedMap) { bedMaterial.map = bedMap; bedMaterial.needsUpdate = true; }
  bedMaterial.color.set(options.isolateReflection ? "#000000" : "#ffffff");
  bed.visible = options.angle !== "below";
  earlyGlass.visible = options.earlyGlass;
  foreground.visible = options.foreground;
  if (options.transformed) fixtureGroup.position.set(100, 17, -80);
  else fixtureGroup.position.set(0, 0, 0);
  fixtureGroup.rotation.y = options.transformed ? 1.1 : 0;
  fixtureGroup.updateMatrixWorld(true);
  camera = options.orthographic ? orthographicCamera : perspectiveCamera;
  renderPass.camera = camera;
  camera.position.set(0, options.angle === "top" ? 12 : options.angle === "below" ? -1.2 : 1.2,
    options.angle === "top" ? 0.001 : 12);
  camera.position.applyMatrix4(fixtureGroup.matrixWorld);
  camera.up.set(0, 1, 0).transformDirection(fixtureGroup.matrixWorld);
  camera.lookAt(fixtureGroup.position);
  camera.updateMatrixWorld(true);
  if (options.sunTest && options.shadowSystem === "cascade") cascades.update({sun, camera: perspectiveCamera,
    count: 3, mapSize: 1024, distance: 60, stagger: false});
  renderer.toneMappingExposure = options.exposure;
  const copiesBefore = (scenePipeline as unknown as {waterScene: {copies: number}}).waterScene.copies;
  renderer.info.reset();
  if (options.pipeline === "composer" && options.sceneTransmission) {
    scenePipeline.setCamera(camera); scenePipeline.render(0);
  } else if (options.pipeline === "composer") composer.render(0);
  else renderer.render(scene, camera);
  document.querySelector("output")!.textContent =
    `${options.angle} · ${options.pipeline} · depth ${options.depth} m · exposure ${options.exposure}`;
  for (const key of ["angle", "pipeline", "depth", "reflection"] as const) {
    document.querySelector<HTMLSelectElement>(`#${key}`)!.value = String(options[key]);
  }
  document.querySelector<HTMLInputElement>("#visible")!.checked = options.visible;
  return { ...snapshot(), frameCopies: (scenePipeline as unknown as {waterScene: {copies: number}}).waterScene.copies - copiesBefore };
}

function snapshot() {
  const gl = renderer.getContext();
  const pixels = new Uint8Array(800 * 480 * 4);
  gl.readPixels(0, 0, 800, 480, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  function probe(x: number, z: number, surfaceOffset = 0) {
    const screen = new Vector3(x, x * options.slope + surfaceOffset, z).applyMatrix4(fixtureGroup.matrixWorld).project(camera);
    const px = Math.round((screen.x * 0.5 + 0.5) * 800);
    const py = Math.round((screen.y * 0.5 + 0.5) * 480);
    if (px < 2 || py < 2 || px > 797 || py > 477) throw new Error("Probe outside viewport");
    return [0, 1, 2].map((channel) => {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        sum += pixels[((py + dy) * 800 + px + dx) * 4 + channel]!;
      }
      return sum / 9;
    });
  }
  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  let normalStats: {along:number;across:number;anisotropy:number;edgeP95:number;edgeCount:number} | null = null;
  if(options.normalDiagnostic!=="beauty" && options.kind==="river") {
    let along=0,across=0;
    const distance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]!));
    for(let z=-2;z<2;z+=.15)for(let x=-5;x<5;x+=.15) {
      const a=probe(x,z);along+=distance(a,probe(x+.15,z));across+=distance(a,probe(x,z+.15));
    }
    const geometry=river.geometry,positions=geometry.getAttribute("position"),uv=geometry.getAttribute("uv");
    const shore=geometry.getAttribute("shoreDistance"),rapid=geometry.getAttribute("rapidness"),mult=geometry.getAttribute("flowSpeedMultiplier");
    const projected=Array.from({length:positions.count},(_,i)=>{
      const p=new Vector3().fromBufferAttribute(positions,i),u=uv.getX(i),v=uv.getY(i);
      const phase=u*6.283185/3.5-options.time*options.flowSpeed*mult.getX(i)*2;
      p.y+=(Math.sin(phase)+Math.sin(phase*1.73+v*5)*.35)*options.waveAmplitude*Math.pow(Math.max(0,1-shore.getX(i)),1.6)*(.65+rapid.getX(i)*.35);
      p.applyMatrix4(river.matrixWorld).project(camera);
      return [(p.x*.5+.5)*800,(p.y*.5+.5)*480] as const;
    });
    const edges=new Map<string,{a:number;b:number;count:number}>();
    const index=geometry.index!;
    for(let t=0;t<index.count;t+=3)for(let k=0;k<3;k++) {
      const a=index.getX(t+k),b=index.getX(t+(k+1)%3),key=[Math.min(a,b),Math.max(a,b)].join(":");
      const edge=edges.get(key);if(edge)edge.count++;else edges.set(key,{a,b,count:1});
    }
    const raw=(x:number,y:number)=>[0,1,2].map(c=>pixels[(Math.round(y)*800+Math.round(x))*4+c]!);
    const jumps=[];
    for(const edge of edges.values()) {
      if(edge.count!==2||Math.abs(positions.getX(edge.a))>6||Math.abs(positions.getX(edge.b))>6||shore.getX(edge.a)>.7||shore.getX(edge.b)>.7)continue;
      const a=projected[edge.a]!,b=projected[edge.b]!,x=(a[0]+b[0])*.5,y=(a[1]+b[1])*.5;
      const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<8||x<4||x>795||y<4||y>475)continue;
      const ox=-dy/len*1.5,oy=dx/len*1.5;jumps.push(distance(raw(x+ox,y+oy),raw(x-ox,y-oy)));
    }
    jumps.sort((a,b)=>a-b);
    normalStats={along,across,anisotropy:across/Math.max(along,.0001),edgeP95:jumps[Math.floor(jumps.length*.95)]??0,edgeCount:jumps.length};
  }
  let redPixels = 0;
  if (options.refractionQA) for(let i=0;i<pixels.length;i+=4) {
    if(pixels[i]!>40&&pixels[i]!>pixels[i+1]!*1.5+8&&pixels[i]!>pixels[i+2]!*1.5+8) redPixels++;
  }
  return {
    options: { ...options },
    centre: [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((x) => probe(x, 0.25)),
    stamp: [-0.8,-0.6,-0.4,-0.2,0,0.2,0.4,0.6,0.8].flatMap(x => [-0.4,0,0.4].map(z=>probe(x,z,0.025))),
    edge: [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((x) => probe(x, 3.65)),
    refractionSamples: options.refractionQA ? Array.from({length:41},(_,i)=>probe(-3+i*.15,.25)) : [],
    protectedSamples: options.refractionQA ? [-.3,0,.3].flatMap(x=>[0,2.5].map(z=>probe(x,z))) : [],
    redPixels,
    normalStats,
    sunDiscRadiance: river.material.uniforms.waterSunDiscRadiance?.value?.toArray() ?? [],
    camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
      kind: options.orthographic ? "orthographic" : "perspective",
      fov: camera instanceof PerspectiveCamera ? camera.fov : null, near: camera.near, far: camera.far },
    viewport: { width: 800, height: 480, dpr: renderer.getPixelRatio() },
    renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) as string : gl.getParameter(gl.RENDERER) as string,
    gpuTimerAvailable: !!gl.getExtension("EXT_disjoint_timer_query_webgl2"),
    // Composer owns two fixed targets even in Direct mode. Off/Low must not
    // allocate any additional reflection target; this is not a VRAM estimate.
    textures: renderer.info.memory.textures,
    drawCalls: renderer.info.render.calls,
    sceneTransmission: river.material.uniforms.waterSceneEnabled?.value ?? 0,
    refraction: river.material.uniforms.riverRefractionStrength?.value ?? 0,
    refractionBytes: river.userData.riverRefractionBytes ?? 0,
    refractionFallback: river.userData.riverRefractionFallback ?? null,
    glError: gl.getError(),
  };
}

function updateFromControls() {
  frame({
    angle: (document.querySelector<HTMLSelectElement>("#angle")!).value as OpticsOptions["angle"],
    pipeline: (document.querySelector<HTMLSelectElement>("#pipeline")!).value as OpticsOptions["pipeline"],
    depth: Number(document.querySelector<HTMLSelectElement>("#depth")!.value),
    reflection: document.querySelector<HTMLSelectElement>("#reflection")!.value as OpticsOptions["reflection"],
    visible: document.querySelector<HTMLInputElement>("#visible")!.checked,
  });
}
document.querySelector("form")!.addEventListener("change", updateFromControls);
declare global {
  interface Window { __riverOptics: { frame: typeof frame; snapshot: typeof snapshot }; }
}
window.__riverOptics = { frame, snapshot };
frame();
