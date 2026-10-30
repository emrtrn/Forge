import { AmbientLight, Color, DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer } from "three";
import { LakeWaterObject } from "@engine/render-three/lakeWater";
import { RiverWaterObject } from "@engine/render-three/riverWater";
import { resolveRiverWater } from "@engine/scene/riverWater";
import { FULL_LAKE_QUALITY } from "@engine/perf/lakeQuality";
import { createLakeFixture } from "../../engine/fixtures/lakeFixture";
import { buildLakeGeometry, prepareLakeSnapshot } from "@engine/terrain/terrainLakeWater";

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1000, 700); document.body.append(renderer.domElement);
const scene = new Scene(); scene.background = new Color("#287b89");
const sun = new DirectionalLight(0xffffff, 2.2); sun.position.set(8, 20, 8);
const ambient = new AmbientLight(0xffffff, .7); scene.add(sun, ambient);
const bed = new Mesh(new PlaneGeometry(150, 150), new MeshStandardMaterial({ color: "#b7aa7a", roughness: 1 }));
bed.rotation.x = -Math.PI / 2; scene.add(bed);
const camera = new PerspectiveCamera(45, 1000 / 700, .1, 250);
const doc = createLakeFixture(), data = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
let water: LakeWaterObject | RiverWaterObject, clock = 3;
function rebuild() {
  water?.removeFromParent(); water?.dispose();
  const kind = input("kind").value, waves = input("waves").checked;
  const settings = { crestFoamEnabled: input("enabled").checked, crestFoamStrength: +input("strength").value, crestFoamThreshold: +input("threshold").value };
  const quality = { ...FULL_LAKE_QUALITY, foamAllowed: input("quality").value !== "low" };
  if (kind === "lake") {
    water = new LakeWaterObject({ ...doc.lake, appearance: { ...settings, surfaceWavesEnabled: waves,
      surfaceWaveHeight: .09, surfaceWaveLength: 6, surfaceWavePeriod: 3, foamEnabled: false,
      deepColor: "#16636b", shallowColor: "#69c7b6", surfaceStrength: 1.5, opacity: .85 } }, data, null, null, undefined, quality);
    camera.position.set(-12, 22, 9); camera.lookAt(-18, 12, -12); bed.position.y = 10;
  } else {
    water = new RiverWaterObject({ ...resolveRiverWater({ id: "r", landscapeRef: "t", splineRef: "s", ...settings,
      waveAmplitude: waves ? .09 : 0, waveLength: 1.5, foamOpacity: 1,
      contactFoam: { enabled: false, shoreWidth: .5, scale: .8, speed: .3, obstacles: [] },
      deepColor: "#16636b", shallowColor: "#69c7b6", opacity: .85 }),
      quality, foamNoiseMap: null, position: [0, 0, 0], rotation: [0, 0, 0], sampleSpacing: .25, heightAt: () => -3,
      spline: { id: "s", points: [{ id: "a", position: [0, 0, 0], width: 14, falloff: 1 }, { id: "b", position: [0, -1, 30], width: 14, falloff: 1 }],
        segments: [{ id: "ab", startPointId: "a", endPointId: "b" }] } }, null);
    camera.position.set(12, 12, 30); camera.lookAt(0, -.3, 12); bed.position.y = -3;
  }
  camera.updateMatrixWorld(true); scene.add(water);
  const before = water.onBeforeRender;
  water.onBeforeRender = (...args) => { before.apply(water, args); water.material.uniforms.time!.value = clock; };
  frame();
}
function frame(t = clock, debug = false, far = false) {
  clock = t;
  const light = input("light").value;
  sun.intensity = light === "day" ? 2.2 : 0; ambient.intensity = light === "night" ? 0 : .7;
  if (water instanceof LakeWaterObject) water.setSurfaceWaveTime(t);
  const saved = water.material.fragmentShader;
  if (debug) {
    const crest = water instanceof LakeWaterObject ? "waterCrestFoam(vContactPosition.xz,surfaceWaveClock,foamScale,edgeDepth)" : "crestFoam";
    water.material.fragmentShader = saved.replace("#include <tonemapping_fragment>", `gl_FragColor=vec4(vCrestWave.x>0.?1.:0.,${crest},0.,1.);`)
      .replace("#include <colorspace_fragment>", "").replace("#include <fog_fragment>", "");
    water.material.needsUpdate = true;
  }
  const position = camera.position.clone();
  if (far) {
    const focus = water instanceof LakeWaterObject ? new Vector3(-18, 12, -12) : new Vector3(0, -.3, 12);
    camera.position.sub(focus).multiplyScalar(1.8).add(focus); camera.updateMatrixWorld(true);
  }
  renderer.render(scene, camera);
  camera.position.copy(position); camera.updateMatrixWorld(true);
  const gl = renderer.getContext(), pixels = new Uint8Array(1000 * 700 * 4);
  gl.readPixels(0, 0, 1000, 700, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let crests = 0, valleys = 0, foam = 0, valleyFoam = 0;
  const samples: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (i % 64 === 0) samples.push(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
    // Debug water is red/green; background and bed have a blue component.
    if (pixels[i + 2]! > 0) continue;
    if (pixels[i]! > 80) crests++;
    if (pixels[i]! < 5) { valleys++; if (pixels[i + 1]! > 2) valleyFoam++; }
    if (pixels[i + 1]! > 8) foam++;
  }
  if (debug) { water.material.fragmentShader = saved; water.material.needsUpdate = true; }
  return { samples, crests, valleys, foam, valleyFoam, calls: renderer.info.render.calls, error: gl.getError(),
    ambient: water.material.uniforms.waterFoamAmbient!.value.toArray(), sun: water.material.uniforms.waterSunColor!.value.toArray(),
    lighting: water.material.uniforms.waterLightingEnabled!.value,
    textures: renderer.info.memory.textures, strength: water.material.uniforms.crestFoamStrength!.value,
    ready: water.material.uniforms.waterFoamReady!.value };
}
for (const id of ["kind", "waves"]) input(id).addEventListener("change", rebuild);
for (const id of ["enabled", "strength", "threshold", "light"]) input(id).addEventListener("change", () => {
  water.material.uniforms.crestFoamStrength!.value = input("enabled").checked && input("quality").value !== "low" ? +input("strength").value : 0;
  water.material.uniforms.crestFoamThreshold!.value = +input("threshold").value;
  frame();
});
input("quality").addEventListener("change", () => {
  const quality = { ...FULL_LAKE_QUALITY, foamAllowed: input("quality").value !== "low" };
  if (water instanceof LakeWaterObject) water.applyQuality(quality, null);
  else void water.applyQuality(quality);
  frame();
});
rebuild();
(window as any).__crestQA = { frame, rebuild };
