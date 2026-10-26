import {
  ACESFilmicToneMapping, Color, DataTexture, Group, Matrix4, Mesh, MeshBasicMaterial,
  NearestFilter, OrthographicCamera, PerspectiveCamera, PlaneGeometry, RepeatWrapping, RGBAFormat,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createRiverWaterObject, type RiverWaterObject } from "@engine/render-three/riverWater";
import { resolveRiverWater } from "@engine/scene/riverWater";
import type { ForgeLandscapeSpline } from "@engine/scene/landscape";

export interface OpticsOptions {
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
}

const canvas = document.querySelector("canvas")!;
const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
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
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
composer.addPass(new OutputPass());
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
const reflectionTextures = {
  red: new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, RGBAFormat),
  blue: new DataTexture(new Uint8Array([0, 0, 255, 255]), 1, 1, RGBAFormat),
};
Object.values(reflectionTextures).forEach((texture) => { texture.needsUpdate = true; });
const normals = new DataTexture(new Uint8Array([
  180, 128, 240, 255, 76, 150, 240, 255,
  128, 180, 240, 255, 150, 76, 240, 255,
]), 2, 2, RGBAFormat);
normals.wrapS = normals.wrapT = RepeatWrapping;
normals.needsUpdate = true;
const spline: ForgeLandscapeSpline = {
  id: "optics", points: [
    { id: "a", position: [-8, 0, 0], width: 4, falloff: 0 },
    { id: "b", position: [8, 0, 0], width: 4, falloff: 0 },
  ], segments: [{ id: "ab", startPointId: "a", endPointId: "b" }],
};
let options: OpticsOptions = {
  angle: "top", pipeline: "direct", depth: 1, reflection: "off", visible: true,
  bedVisibility: 1, absorptionDistance: 2, opacity: 0, foamOpacity: 0,
  time: 0, normalMap: false, calibration: false, exposure: 0.2,
  transformed: false, slope: 0, orthographic: false,
};
let river: RiverWaterObject;

function frame(patch: Partial<OpticsOptions> = {}) {
  options = { ...options, ...patch };
  if (river) { fixtureGroup.remove(river); river.dispose(); }
  const slopedSpline = { ...spline, points: spline.points.map((point) => ({ ...point,
    position: [point.position[0], point.position[0] * options.slope, point.position[2]] as [number, number, number],
  })) };
  river = createRiverWaterObject({
    ...resolveRiverWater({ id: "optics", landscapeRef: "fixture", splineRef: "optics",
      surfaceLevel: -8 * options.slope, bedVisibility: options.bedVisibility, absorptionDistance: options.absorptionDistance,
      opacity: options.opacity, foamOpacity: options.foamOpacity, waveAmplitude: 0,
      reflectionStrength: 1,
      ...(options.calibration ? { deepColor: "#808080", shallowColor: "#808080" } : {}),
    }),
    spline: slopedSpline, heightAt: (x) => x * options.slope - options.depth, sampleSpacing: 0.5,
    position: [0, 0, 0], rotation: [0, 0, 0], foamNoiseMap: null,
  }, options.normalMap ? normals : null);
  // Test-only deterministic clock; production's onBeforeRender uses wall time.
  river.onBeforeRender = () => { river.material.uniforms.time!.value = options.time; };
  river.visible = options.visible;
  if (options.reflection !== "off") river.setPlanarReflectionBinding({
    texture: reflectionTextures[options.reflection], textureMatrix: new Matrix4(),
  });
  fixtureGroup.add(river);
  const positions = bed.geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) positions.setZ(i, positions.getX(i) * options.slope);
  positions.needsUpdate = true;
  bed.geometry.computeBoundingSphere();
  bed.position.y = -options.depth;
  bed.visible = options.angle !== "below";
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
  renderer.toneMappingExposure = options.exposure;
  if (options.pipeline === "composer") composer.render(0);
  else renderer.render(scene, camera);
  document.querySelector("output")!.textContent =
    `${options.angle} · ${options.pipeline} · depth ${options.depth} m · exposure ${options.exposure}`;
  for (const key of ["angle", "pipeline", "depth", "reflection"] as const) {
    document.querySelector<HTMLSelectElement>(`#${key}`)!.value = String(options[key]);
  }
  document.querySelector<HTMLInputElement>("#visible")!.checked = options.visible;
  return snapshot();
}

function snapshot() {
  const gl = renderer.getContext();
  const pixels = new Uint8Array(800 * 480 * 4);
  gl.readPixels(0, 0, 800, 480, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  function probe(x: number, z: number) {
    const screen = new Vector3(x, x * options.slope, z).applyMatrix4(fixtureGroup.matrixWorld).project(camera);
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
  return {
    options: { ...options },
    centre: [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((x) => probe(x, 0.25)),
    edge: [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((x) => probe(x, 3.65)),
    camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
      kind: options.orthographic ? "orthographic" : "perspective",
      fov: camera instanceof PerspectiveCamera ? camera.fov : null, near: camera.near, far: camera.far },
    viewport: { width: 800, height: 480, dpr: renderer.getPixelRatio() },
    renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) as string : gl.getParameter(gl.RENDERER) as string,
    gpuTimerAvailable: !!gl.getExtension("EXT_disjoint_timer_query_webgl2"),
    // Composer owns two fixed targets even in Direct mode. Off/Low must not
    // allocate any additional reflection target; this is not a VRAM estimate.
    textures: renderer.info.memory.textures,
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
