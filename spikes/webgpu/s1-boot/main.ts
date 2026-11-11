// S1 Boot: WebGPURenderer + init, real backend proof, adapter / device info,
// timestamp queries, and whether the frame rate is uncapped under the harness
// flags. A small lit, shadowed instanced field gives the GPU timer something
// to measure. URL: ?forceWebGL=1 runs the WebGL2 backend for comparison only.
import * as THREE from "three/webgpu";
import { createSpikeRenderer, report, startMeasuredLoop } from "../shared/spike";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;

async function main(): Promise<void> {
  const spike = await createSpikeRenderer(canvas, { forceWebGL: params.get("forceWebGL") === "1" });
  const { renderer, proof } = spike;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fb4d8);
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 40, 90);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x40382c, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(60, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 400 });
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x4f6b3a, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const side = 60;
  const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshStandardMaterial({ color: 0xb08850, roughness: 0.7 }), side * side);
  boxes.castShadow = true;
  boxes.receiveShadow = true;
  const m = new THREE.Matrix4();
  for (let i = 0; i < side * side; i += 1) {
    const x = (i % side) - side / 2;
    const z = Math.floor(i / side) - side / 2;
    m.makeTranslation(x * 3, 0.75 + Math.sin(x * 0.3) * Math.cos(z * 0.3) * 2 + 2, z * 3);
    boxes.setMatrixAt(i, m);
  }
  scene.add(boxes);

  let t = 0;
  startMeasuredLoop(spike, (dt) => {
    t += dt / 1000;
    boxes.rotation.y = t * 0.05;
    renderer.render(scene, camera);
  }, "s1");

  // Sample the witness after a short warm-up.
  await new Promise((r) => setTimeout(r, Number(params.get("settleMs") ?? 6000)));
  const witness = JSON.parse(canvas.dataset.forgePerf ?? "null");
  report(proof.isWebGPUBackend || params.get("forceWebGL") === "1" ? "complete" : "failed", {
    proof,
    canvas: [canvas.width, canvas.height],
    devicePixelRatio: window.devicePixelRatio,
    witness,
    threeRevision: THREE.REVISION,
  });
}

main().catch((error: unknown) => {
  report("failed", { error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) });
});
