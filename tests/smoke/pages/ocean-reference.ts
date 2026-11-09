import { ACESFilmicToneMapping, AmbientLight, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute,
  FogExp2, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { OceanFft } from "../../../engine/render-three/ocean/oceanFft";
import { OceanSurface } from "../../../engine/render-three/ocean/oceanSurface";
import { prepareOceanCoverage, sampleOceanCoverage } from "../../../engine/terrain/oceanCoverage";
import { CooperativeWork } from "../../../engine/core/cooperativeWork";
import type { OceanWaterBody } from "../../../engine/scene/oceanWater";

const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = .85;
const scene = new Scene(), camera = new PerspectiveCamera(55, innerWidth / innerHeight, .15, 6000);
const skyColor = new Color("#aec2cf"); scene.background = skyColor; scene.fog = new FogExp2(skyColor, .001);
const controls = new OrbitControls(camera, canvas); controls.maxPolarAngle = Math.PI * .495;
controls.minDistance = 3; controls.maxDistance = 1000; controls.enableDamping = true;
const sky = new Sky(); sky.scale.setScalar(5000); scene.add(sky);
sky.material.uniforms.turbidity!.value = 5; sky.material.uniforms.rayleigh!.value = 1.7;
const sun = new Vector3(-.4, .7, -.6).normalize(); sky.material.uniforms.sunPosition!.value.copy(sun);
const light = new DirectionalLight("#fff3da", 2.5); light.position.copy(sun).multiplyScalar(100); scene.add(light);
scene.add(new AmbientLight("#c9e1ef", 1.2));
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
let simulation: OceanFft | undefined, surface: OceanSurface | undefined, paused = false, last = 0, frame = 0;
let backend = "fft", generation = 0, aborter = new AbortController(), rebuilding = false, disposed = false;
let needsRender = true;
controls.addEventListener("change", () => { needsRender = true; });
let maxSliceMs = 0;
const errors: string[] = [];
function view(name: string): void {
  if (name === "sea") { camera.position.set(120, 4, 150); controls.target.set(30, 1, -150); }
  else if (name === "aerial") { camera.position.set(100, 140, 130); controls.target.set(0, 0, 0); }
  else { camera.position.set(58, 12, 68); controls.target.set(-8, 0, -10); }
  controls.update();
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
    surface?.dispose(); simulation?.dispose(); simulation = nextSim; surface = nextSurface;
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
const resize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); needsRender = true; };
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
  if (!paused || needsRender) { renderer.render(scene, camera); needsRender = false; }
  frame++; requestAnimationFrame(animate);
}
function dispose(): void {
  if (disposed) return; disposed = true; ++generation; aborter.abort();
  surface?.dispose(); simulation?.dispose(); controls.dispose(); geometry.dispose(); terrain.material.dispose();
  sky.geometry.dispose(); sky.material.dispose(); renderer.dispose(); removeEventListener("resize", resize);
}
const lab = {
  rebuild, dispose,
  probe: () => simulation?.probe() ?? Promise.resolve([]),
  stats: () => ({ ready: !!surface, backend, paused, frame, rebuilding, maxSliceMs, errors: [...errors],
    time: simulation?.stats.time ?? 0, updates: simulation?.stats.updates ?? 0, draws: simulation?.stats.draws ?? 0,
    fftBytes: simulation?.stats.textureBytes ?? 0, textures: renderer.info.memory.textures,
    geometries: renderer.info.memory.geometries, triangles: renderer.info.render.triangles,
    island: surface ? sampleOceanCoverage(surface.coverage, 10, 0).status : "unknown",
    basin: surface ? sampleOceanCoverage(surface.coverage, 0, 0).status : "unknown",
    offshore: surface ? sampleOceanCoverage(surface.coverage, 300, 0).status : "unknown" }),
};
declare global { interface Window { __oceanLab: typeof lab } }
window.__oceanLab = lab;
addEventListener("pagehide", dispose, { once: true });
void rebuild().then(() => { requestAnimationFrame(animate); });
