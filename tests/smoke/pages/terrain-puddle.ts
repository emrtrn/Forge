import { AmbientLight, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DirectionalLight,
  Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, PMREMGenerator,
  Raycaster, RepeatWrapping, Scene, TextureLoader, Vector2, Vector3, WebGLRenderer } from "three";
import { resolveLevelWind } from "@engine/environment/wind";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { DeformationField } from "@engine/scene/deformationField";
import { buildTerrainPuddle, type TerrainPuddleRegion } from "@engine/terrain/terrainPuddle";
import { TerrainPuddleSurface } from "@engine/render-three/terrain/terrainPuddleSurface";
import { terrainDeformationDisplacement } from "@engine/render-three/terrain/terrainDeformation";
import { PlanarReflectionSource } from "@engine/render-three/planarReflectionSource";

const renderer = new WebGLRenderer({ canvas: document.querySelector("canvas")!, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
const scene = new Scene(); scene.background = new Color("#839092");
const room = new RoomEnvironment(), pmrem = new PMREMGenerator(renderer), environment = pmrem.fromScene(room);
scene.environment = environment.texture; room.dispose(); pmrem.dispose();
const sun = new DirectionalLight("#fff0d6", 3); sun.position.set(-5, 12, 8);
scene.add(sun, new AmbientLight("#b4c6d3", 1.4));
const camera = new PerspectiveCamera(44, innerWidth / innerHeight, .05, 100);
camera.position.set(9, 6, 10); camera.lookAt(0, 0, 0);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 0, 0);
controls.enablePan = false; controls.maxPolarAngle = Math.PI * .48;
// Reserve left click for placing water; OrbitControls accepts undefined to disable.
controls.mouseButtons.LEFT = undefined;

let field = new DeformationField({ windowSize: 32, cellSize: .125 });
const window = { minX: -16, minZ: -16, size: 32 };
const region: TerrainPuddleRegion = { minX: -6, minZ: -6, size: 12, cellSize: .125, level: -.02, seed: [0, 0] };
const reflection = new PlanarReflectionSource(region.level, "medium");
// Simple scale/context geometry also makes the reflected scene legible.
for (let i = 0; i < 5; i++) {
  const post = new Mesh(new BoxGeometry(.18, 1.8, .18), new MeshStandardMaterial({ color: "#4b3422" }));
  post.position.set(-4.5 + i * 1.8, .9, -5.3); scene.add(post);
}
const wall = new Mesh(new BoxGeometry(8.2, 1.4, .14), new MeshStandardMaterial({ color: "#755438" }));
wall.position.set(-.9, 1.4, -5.3); scene.add(wall);
// A broad central hollow, a second isolated hollow and small dry hummocks.
function base(x: number, z: number): number {
  return .13 + .008 * x + .012 * Math.sin(x * 2.7) * Math.cos(z * 2.1)
    - .24 * Math.exp(-(x * x / 5 + z * z / 7))
    - .24 * Math.exp(-((x - 3.7) ** 2 / .65 + (z + 2.7) ** 2 / .9))
    + .16 * Math.exp(-((x + .75) ** 2 + (z + .7) ** 2) / .2);
}
const depth = (x: number, z: number) => field.sample(x, z).depth;
const bed = (x: number, z: number) => base(x, z) + terrainDeformationDisplacement(depth, window, x, z).offset;
const groundGeometry = new BufferGeometry();
const n = 96, points: number[] = [], indices: number[] = [], colours: number[] = [];
const soil = new Color();
for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) {
  const wx = -6 + x * .125, wz = -6 + z * .125;
  points.push(wx, base(wx, wz), wz); colours.push(.22, .14, .08);
}
for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
  const a = z * (n + 1) + x; indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
}
groundGeometry.setAttribute("position", new Float32BufferAttribute(points, 3));
groundGeometry.setAttribute("color", new Float32BufferAttribute(colours, 3)); groundGeometry.setIndex(indices);
const ground = new Mesh(groundGeometry, new MeshStandardMaterial({ vertexColors: true, roughness: .58 })); scene.add(ground);
const puddles: { seed: [number, number]; surface: TerrainPuddleSurface; area: number }[] = [];
const status = document.querySelector<HTMLOutputElement>("#status")!;
let failure = "", rebuildingMs = 0, driving = false, travel = -4.5, lastRing = 0, rebuildSeconds = 0;
let revision = 0;
function rebuild() {
  const start = performance.now();
  const positions = groundGeometry.getAttribute("position"), colors = groundGeometry.getAttribute("color");
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), d = depth(x, z);
    positions.setY(i, bed(x, z));
    const noise = .01 * Math.sin(x * 37 + z * 23) * Math.cos(z * 31);
    soil.setRGB(.065 + noise, .04 + noise * .7, .022 + noise * .4).multiplyScalar(1 - Math.min(.45, d * 3));
    colors.setXYZ(i, soil.r, soil.g, soil.b);
  }
  positions.needsUpdate = colors.needsUpdate = true;
  groundGeometry.computeVertexNormals(); groundGeometry.computeBoundingSphere();
  failure = "";
  for (const puddle of puddles) {
    const data = buildTerrainPuddle({ ...region, seed: puddle.seed }, bed);
    if (puddle.surface.rebuild(data)) puddle.area = data.area;
    else failure = data.status === "open-boundary" ? "Su sınırı avluyu aşıyor; önceki yüzey korundu." : "Zemin verisi eksik; önceki yüzey korundu.";
  }
  rebuildingMs = performance.now() - start; revision++;
  status.textContent = failure || `${puddles.reduce((sum, p) => sum + p.area, 0).toFixed(2)} m² su · en derin iz ${(field.stats().maxDepth * 100).toFixed(1)} cm`;
}
function addPuddle(seed: [number, number]) {
  const data = buildTerrainPuddle({ ...region, seed }, bed);
  if (data.status !== "ready") { status.textContent = "Bu noktada seçilen su seviyesinin altında kapalı bir çukur yok."; return; }
  // A click inside an existing basin selects it rather than stacking water.
  const ray = new Raycaster(new Vector3(seed[0], region.level + 1, seed[1]), new Vector3(0, -1, 0));
  scene.updateMatrixWorld(true);
  if (puddles.some(p => ray.intersectObject(p.surface).length > 0)) return;
  if (puddles.length >= 4) { status.textContent = "Prototipte en fazla dört birikinti."; return; }
  const surface = new TerrainPuddleSurface(); scene.add(surface); reflection.addConsumer(surface);
  surface.setWindOrigin(seed[0], seed[1]);
  puddles.push({ seed, surface, area: data.area }); rebuild();
}
const chassis = new Group();
const body = new Mesh(new BoxGeometry(1.5, .55, 2.3), new MeshStandardMaterial({ color: "#63766b", roughness: .8 }));
body.position.y = .72; chassis.add(body);
const tyres = Array.from({ length: 4 }, (_, i) => {
  const tyre = new Mesh(new CylinderGeometry(.38, .38, .3, 20), new MeshStandardMaterial({ color: "#181b19", roughness: .95 }));
  tyre.rotation.z = Math.PI / 2; tyre.position.set(i % 2 ? .8 : -.8, .4, i < 2 ? -.85 : .85);
  chassis.add(tyre); return tyre;
});
scene.add(chassis); chassis.position.z = travel;
function step(dt: number) {
  for (const p of puddles) p.surface.advance(dt);
  if (!driving) return;
  const old = travel; travel = Math.min(4.5, travel + dt * 1.4); chassis.position.z = travel;
  for (const tyre of tyres) {
    const x = tyre.position.x, z = travel + tyre.position.z;
    field.stampWheel({ from: [x, old + tyre.position.z], to: [x, z], width: .4, contactLength: .45,
      targetDepth: .15, compaction: .65, disturbance: 255 });
    tyre.position.y = bed(x, z) + .38; tyre.rotation.x -= (travel - old) / .38;
    if (travel - lastRing > .16 && bed(x, z) < region.level - .005) {
      const contact = new Raycaster(new Vector3(x, region.level + 1, z), new Vector3(0, -1, 0));
      for (const p of puddles) if (contact.intersectObject(p.surface).length) p.surface.ripple(x, z, .8);
    }
  }
  if (travel - lastRing > .16) lastRing = travel;
  // Coalesce wheel revisions; never scan the grid at render-frame frequency.
  rebuildSeconds += dt;
  if (rebuildSeconds >= .1 || travel >= 4.5) { rebuild(); rebuildSeconds = 0; }
  if (travel >= 4.5) driving = false;
}
function reset() {
  driving = false; rebuildSeconds = 0; travel = lastRing = -4.5; chassis.position.z = travel;
  field = new DeformationField({ windowSize: 32, cellSize: .125 });
  for (const tyre of tyres) { tyre.position.y = bed(tyre.position.x, travel + tyre.position.z) + .38; tyre.rotation.x = 0; }
  for (const p of puddles) { reflection.removeConsumer(p.surface); scene.remove(p.surface); p.surface.dispose(); } puddles.length = 0;
  addPuddle([0, 0]); addPuddle([3.7, -2.7]); rebuild();
}
document.querySelector("#drive")!.addEventListener("click", () => { if (!driving) { travel = lastRing = -4.5; driving = true; } });
document.querySelector("#reset")!.addEventListener("click", reset);
document.querySelector<HTMLInputElement>("#level")!.addEventListener("input", event => {
  region.level = Number((event.target as HTMLInputElement).value) / 100;
  reflection.setPlaneHeight(region.level);
  document.querySelector("#level-text")!.textContent = `${Math.round(region.level * 100)} cm`; rebuild();
});
const waterToggle = document.querySelector<HTMLInputElement>("#water")!;
renderer.domElement.addEventListener("click", event => {
  if (event.button !== 0) return;
  const bounds = renderer.domElement.getBoundingClientRect(), ray = new Raycaster();
  ray.setFromCamera(new Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2), camera);
  const hit = ray.intersectObject(ground)[0]; if (hit) addPuddle([hit.point.x, hit.point.z]);
});
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
let previous = performance.now();
function frame() {
  const now = performance.now(), dt = Math.min(.05, (now - previous) / 1000); previous = now;
  step(dt);
  for (const p of puddles) p.surface.visible = waterToggle.checked && p.surface.geometry.getAttribute("position").count > 0;
  controls.update(); scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  if (waterToggle.checked) reflection.update(renderer, scene, camera);
  renderer.render(scene, camera);
}
reset(); renderer.setAnimationLoop(frame);
let windNormal: ReturnType<TextureLoader["loadAsync"]> | null = null;
const api = {
  wind: async (strength: number, seconds: number, angle = false) => {
    renderer.setAnimationLoop(null);
    const texture = await (windNormal ??= new TextureLoader().loadAsync("/assets/starter-content/Textures/T_Water_N.png"));
    texture.wrapS = texture.wrapT = RepeatWrapping;
    const wind = resolveLevelWind({ worldEnvironment: { wind: { directionDeg: 70, strength, gust: .4 } } }, { season: "summer", weather: { preset: "clear", intensity: 1 } });
    camera.position.set(angle ? 3 : 1.8, angle ? 4 : 1.5, angle ? 3 : 3.5); camera.lookAt(0, -.02, -.4); camera.updateMatrixWorld(true);
    for (const puddle of puddles) {
      puddle.surface.setWindNormal(texture); puddle.surface.updateWind(wind, seconds);
      puddle.surface.setPlanarReflectionBinding(reflection.binding);
    }
    scene.updateMatrixWorld(true); reflection.update(renderer, scene, camera); renderer.render(scene, camera);
    return { glError: renderer.getContext().getError(), geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
  },
  pause: () => { renderer.setAnimationLoop(null); frame(); },
  render: frame,
  drive: () => { driving = true; travel = lastRing = -4.5; },
  reset,
  advance: (steps: number) => { for (let i = 0; i < Math.min(steps, 400); i++) step(1 / 30); frame(); },
  snapshot: () => ({ area: puddles.reduce((s, p) => s + p.area, 0), depth: field.stats().maxDepth,
    bed: bed(.8, 1), base: base(.8, 1), level: region.level, revision, rebuildingMs,
    triangles: puddles.reduce((s, p) => s + p.surface.geometry.getAttribute("position").count / 3, 0),
    geometries: renderer.info.memory.geometries, glError: renderer.getContext().getError() }),
};
declare global { interface Window { __terrainPuddle: typeof api } }
globalThis.window.__terrainPuddle = api;
addEventListener("pagehide", () => {
  renderer.setAnimationLoop(null); controls.dispose(); environment.dispose(); reflection.dispose();
  void windNormal?.then(texture => texture.dispose());
  scene.traverse(object => { if (object instanceof Mesh) { object.geometry.dispose(); const m = object.material; if (!Array.isArray(m)) m.dispose(); } });
  renderer.dispose();
});
