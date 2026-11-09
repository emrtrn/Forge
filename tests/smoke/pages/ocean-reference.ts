import { ACESFilmicToneMapping, AmbientLight, BoxGeometry, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute,
  FloatType, FogExp2, Mesh, MeshDepthMaterial, MeshNormalMaterial, MeshStandardMaterial, PerspectiveCamera, RGBADepthPacking,
  MeshBasicMaterial, Scene, Vector3, WebGLRenderer, WebGLRenderTarget } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { OceanFft } from "../../../engine/render-three/ocean/oceanFft";
import { OceanSurface } from "../../../engine/render-three/ocean/oceanSurface";
import { prepareOceanCoverage, sampleOceanCoverage } from "../../../engine/terrain/oceanCoverage";
import { CooperativeWork } from "../../../engine/core/cooperativeWork";
import type { OceanReflectionCeiling, OceanWaterBody } from "../../../engine/scene/oceanWater";
import { OceanReflectionLease } from "../../../engine/render-three/ocean/oceanReflection";
import { WaterReflectionRegistry } from "../../../engine/render-three/waterReflectionRegistry";
import { isPlanarReflectionCamera } from "../../../engine/render-three/planarReflectionSource";
import { WaterSceneSnapshot } from "../../../engine/render-three/waterSceneSnapshot";
import { renderSceneWithLakeOverride } from "../../../engine/render-three/lakeWater";
import { captureSkyEnvironment } from "../../../engine/render-three/reflection";
import { resolveSkyAtmosphere } from "../../../engine/scene/skyAtmosphere";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { postProcessToneMappingExposure } from "../../../engine/render-three/postProcess";

const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = postProcessToneMappingExposure(.85);
const scene = new Scene(), camera = new PerspectiveCamera(55, innerWidth / innerHeight, .15, 6000);
const reflections = new WaterReflectionRegistry();
let reflectionLease: OceanReflectionLease | undefined, reflectionCeiling: OceanReflectionCeiling = "high", planarCaptures = 0;
const render = renderer.render.bind(renderer);
renderer.render = (scene, camera) => { if (isPlanarReflectionCamera(camera)) planarCaptures++; render(scene, camera); };
const skyColor = new Color("#aec2cf"); scene.background = skyColor; scene.fog = new FogExp2(skyColor, .001);
const controls = new OrbitControls(camera, canvas); controls.maxPolarAngle = Math.PI * .495;
controls.minDistance = 3; controls.maxDistance = 1000; controls.enableDamping = true;
const sky = new Sky(); sky.scale.setScalar(5000); scene.add(sky);
sky.userData.waterReflectionBackground = true;
sky.material.uniforms.turbidity!.value = 5; sky.material.uniforms.rayleigh!.value = 1.7;
const sun = new Vector3(-.4, .7, -.6).normalize(); sky.material.uniforms.sunPosition!.value.copy(sun);
const light = new DirectionalLight("#fff3da", 2.5); light.position.copy(sun).multiplyScalar(100); scene.add(light);
const ambient = new AmbientLight("#c9e1ef", 1.2); scene.add(ambient);
const environment = captureSkyEnvironment(renderer, resolveSkyAtmosphere({ turbidity: 5, rayleigh: 1.7 }), sun, 64);
scene.environment = environment.texture;
renderer.shadowMap.enabled = true; light.castShadow = true; light.shadow.mapSize.set(128, 128);
light.shadow.camera.left = light.shadow.camera.bottom = -100; light.shadow.camera.right = light.shadow.camera.top = 100;
const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera)); composer.addPass(new OutputPass());
const snapshots = new WaterSceneSnapshot(scene);
let transmission = true;
const body: OceanWaterBody = { schema: 1, kind: "ocean", coordinateSpace: "world", id: "reference-ocean",
  terrainRef: "reference-terrain", name: "Ocean study", bounds: { min: [-128, -128], max: [128, 128] },
  openEdges: ["west", "east", "north", "south"], surfaceLevel: 0, offshoreDepth: 40 };
function height(x: number, z: number): number {
  const r2 = (x / 1.15) ** 2 + z * z;
  return -12 + 24 * Math.exp(-r2 / 900) - 20 * Math.exp(-r2 / 45)
    + 16 * Math.exp(-((x + 43) ** 2 + (z - 16) ** 2) / 80);
}
const geometry = new BufferGeometry(), positions: number[] = [], colors: number[] = [], indices: number[] = [];
const color = new Color();
for (let z = 0; z <= 256; z++) for (let x = 0; x <= 256; x++) {
  const wx = x - 128, wz = z - 128, h = height(wx, wz); positions.push(wx, h, wz);
  color.set(h > 5 ? "#79866a" : h > -.1 ? "#b5a58a" : "#7b978b");
  color.multiplyScalar(.95 + .05 * Math.sin(wx * .8) * Math.cos(wz * .6)); colors.push(color.r, color.g, color.b);
}
for (let z = 0; z < 256; z++) for (let x = 0; x < 256; x++) {
  const a = z * 257 + x; indices.push(a, a + 257, a + 1, a + 1, a + 257, a + 258);
}
geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
geometry.setAttribute("color", new Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
const terrain = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: .85 })); scene.add(terrain);
terrain.castShadow = terrain.receiveShadow = true;
const marker = new Mesh(new BoxGeometry(16, 12, 12), new MeshBasicMaterial({ color: "#ff0000" }));
marker.position.set(10000, 10, -30); marker.visible = false; scene.add(marker);
let simulation: OceanFft | undefined, surface: OceanSurface | undefined, paused = false, last = 0, frame = 0;
let backend = "fft", generation = 0, aborter = new AbortController(), rebuilding = false, disposed = false;
let needsRender = true;
controls.addEventListener("change", () => { needsRender = true; });
let maxSliceMs = 0;
const errors: string[] = [];
function view(name: string): void {
  marker.visible = name === "reflection";
  if (name === "reflection") { camera.position.set(10000, 6, 90); controls.target.set(10000, 0, -30); }
  else if (name === "sea") { camera.position.set(120, 4, 150); controls.target.set(30, 1, -150); }
  else if (name === "aerial") { camera.position.set(100, 140, 130); controls.target.set(0, 0, 0); }
  else { camera.position.set(58, 12, 68); controls.target.set(-8, 0, -10); }
  controls.update(); sky.position.copy(camera.position); surface?.updateView(camera); needsRender = true;
}
function appearance(patch: NonNullable<OceanWaterBody["appearance"]>): void {
  body.appearance = { ...body.appearance, ...patch };
  surface?.applyAppearance(body); reflectionLease?.update(body, reflectionCeiling); needsRender = true;
}
async function rebuild(missing = false): Promise<boolean> {
  const ticket = ++generation; aborter.abort(); aborter = new AbortController(); rebuilding = true;
  try {
    const coverage = await prepareOceanCoverage(body, 1, (x, z) => missing && x > 50 ? null : height(x, z),
      new CooperativeWork({ signal: aborter.signal, onSlice: slice => { maxSliceMs = Math.max(maxSliceMs, slice.milliseconds); } }));
    if (ticket !== generation || disposed) return false;
    if (coverage.status !== "ready") { status.textContent = "Terrain eksik; önceki Ocean korunuyor."; return false; }
    const nextSim = new OceanFft(renderer, body);
    let nextSurface: OceanSurface;
    try { nextSim.update(0); nextSurface = new OceanSurface(coverage, nextSim); }
    catch (error) { nextSim.dispose(); throw error; }
    const nextLease = new OceanReflectionLease(nextSurface, reflections);
    nextLease.update(body, reflectionCeiling);
    reflectionLease?.dispose(); surface?.dispose(); simulation?.dispose();
    reflectionLease = nextLease; simulation = nextSim; surface = nextSurface;
    surface.material.uniforms.analyticMode!.value = backend === "analytic" ? 1 : 0;
    scene.add(surface); surface.updateView(camera); needsRender = true; return true;
  } catch (error) {
    if (ticket !== generation || disposed) return false;
    errors.push(String(error)); status.textContent = String(error); return false;
  } finally { if (ticket === generation) rebuilding = false; }
}
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(button => button.onclick = () => view(button.dataset.view!));
document.querySelector<HTMLButtonElement>("#pause")!.onclick = event => {
  paused = !paused; const button = event.currentTarget as HTMLButtonElement;
  button.textContent = paused ? "Resume" : "Pause"; button.setAttribute("aria-pressed", String(paused));
};
document.querySelector<HTMLSelectElement>("#backend")!.onchange = event => {
  backend = (event.target as HTMLSelectElement).value;
  if (surface) surface.material.uniforms.analyticMode!.value = backend === "analytic" ? 1 : 0;
  needsRender = true;
};
document.querySelector<HTMLButtonElement>("#rebuild")!.onclick = () => { void rebuild(); };
document.querySelector<HTMLSelectElement>("#reflections")!.onchange = event => {
  appearance({ reflectionMode: (event.target as HTMLSelectElement).value as "off" | "environment" | "sharedPlanar" });
};
const resize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); needsRender = true; };
addEventListener("resize", resize); resize(); view("coast");
function animate(now: number): void {
  if (disposed) return;
  const dt = last ? Math.min(.05, Math.max(0, (now - last) / 1000)) : 0; last = now;
  controls.update();
  if (simulation && surface) {
    simulation.update(paused ? 0 : dt); surface.updateView(camera);
    if (frame % 30 === 0 && !rebuilding && !errors.length)
      status.textContent = `${backend === "fft" ? "FFT · 4 × 256²" : "Analytical comparison"} · ${simulation.stats.time.toFixed(1)} s\n`
        + `${surface.coverage.wetFaces.toLocaleString()} connected faces · ${(simulation.stats.textureBytes / 1024 ** 2).toFixed(2)} MiB FFT textures`;
  }
  if (!paused || needsRender) {
    snapshots.begin(camera, [composer.renderTarget1, composer.renderTarget2]);
    if(transmission) composer.render(); else renderer.render(scene, camera);
    needsRender = false;
  }
  frame++; requestAnimationFrame(animate);
}
function dispose(): void {
  if (disposed) return; disposed = true; ++generation; aborter.abort();
  reflectionLease?.dispose(); surface?.dispose(); simulation?.dispose(); controls.dispose(); geometry.dispose(); terrain.material.dispose();
  marker.geometry.dispose(); marker.material.dispose();
  snapshots.dispose(); composer.dispose(); environment.dispose(); light.shadow.dispose();
  sky.geometry.dispose(); sky.material.dispose(); renderer.dispose(); removeEventListener("resize", resize);
}
const lab = {
  rebuild, dispose,
  appearance,
  setReflectionCeiling: (ceiling: OceanReflectionCeiling) => { reflectionCeiling = ceiling; reflectionLease?.update(body, ceiling); needsRender = true; },
  setTransmission: (enabled: boolean) => { transmission = enabled; needsRender = true; },
  setDark: (dark: boolean) => {
    light.intensity = dark ? 0 : 2.5; ambient.intensity = dark ? 0 : 1.2;
    scene.environment = dark ? null : environment.texture; needsRender = true;
  },
  measure: () => {
    // Isolate surface radiance from sky/terrain/fog, without another FFT step.
    const target = new WebGLRenderTarget(32, 32, { type: FloatType });
    const previous = renderer.getRenderTarget(), background = scene.background, fog = scene.fog;
    const skyVisible = sky.visible, terrainVisible = terrain.visible, clear = renderer.getClearColor(new Color()).clone(), alpha = renderer.getClearAlpha();
    const pixels = new Float32Array(32 * 32 * 4);
    try {
      sky.visible = terrain.visible = false; scene.background = null; scene.fog = null; renderer.setClearColor(0, 0);
      renderer.setRenderTarget(target); renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, 32, 32, pixels);
      let radiance = 0, waterRed = 0, waterGreen = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        radiance += pixels[i]! + pixels[i+1]! + pixels[i+2]!;
        // GL rows start at the bottom. The marker itself is above the horizon;
        // this lower half can receive its red only through the water reflection.
        if (i < 32 * 16 * 4) { waterRed += pixels[i]!; waterGreen += pixels[i+1]!; }
      }
      return { finite: pixels.every(Number.isFinite), radiance: radiance / (32 * 32 * 3),
        waterRed: waterRed / (32 * 16), waterGreen: waterGreen / (32 * 16) };
    } finally {
      renderer.setRenderTarget(previous); renderer.setClearColor(clear, alpha); scene.background = background; scene.fog = fog;
      sky.visible = skyVisible; terrain.visible = terrainVisible; target.dispose(); needsRender = true;
    }
  },
  override: (kind: "normal" | "depth") => {
    const target = new WebGLRenderTarget(32, 32), previous = renderer.getRenderTarget();
    const override = scene.overrideMaterial;
    const material = kind === "normal" ? new MeshNormalMaterial() : new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    const pixels = new Uint8Array(32 * 32 * 4), time = simulation!.stats.time;
    try {
      renderer.setRenderTarget(target); scene.overrideMaterial = material;
      renderSceneWithLakeOverride(scene, kind, () => renderer.render(scene, camera));
      renderer.readRenderTargetPixels(target, 0, 0, 32, 32, pixels);
      return { variation: new Set(pixels).size, frozen: time === simulation!.stats.time };
    } finally { scene.overrideMaterial = override; renderer.setRenderTarget(previous); target.dispose(); material.dispose(); needsRender = true; }
  },
  probe: () => simulation?.probe() ?? Promise.resolve([]),
  stats: () => ({ ready: !!surface, backend, paused, frame, rebuilding, maxSliceMs, errors: [...errors],
    time: simulation?.stats.time ?? 0, updates: simulation?.stats.updates ?? 0, draws: simulation?.stats.draws ?? 0,
    fftBytes: simulation?.stats.textureBytes ?? 0, textures: renderer.info.memory.textures,
    transmission: surface?.material.uniforms.waterSceneEnabled!.value ?? 0, snapshots: snapshots.copies,
    planarEnabled: surface?.material.uniforms.planarReflectionEnabled!.value ?? 0, planarCaptures,
    reflectionSources: reflections.size, reflectionSize: (reflectionLease?.source?.binding.texture.image as { width?: number } | undefined)?.width ?? 0,
    reflectionMode: body.appearance?.reflectionMode ?? "environment", reflectionCeiling,
    anchor: surface?.material.uniforms.anchor!.value.toArray() ?? [],
    geometries: renderer.info.memory.geometries, triangles: renderer.info.render.triangles,
    island: surface ? sampleOceanCoverage(surface.coverage, 10, 0).status : "unknown",
    basin: surface ? sampleOceanCoverage(surface.coverage, 0, 0).status : "unknown",
    offshore: surface ? sampleOceanCoverage(surface.coverage, 300, 0).status : "unknown" }),
};
declare global { interface Window { __oceanLab: typeof lab } }
window.__oceanLab = lab;
addEventListener("pagehide", dispose, { once: true });
void rebuild().then(() => { requestAnimationFrame(animate); });
