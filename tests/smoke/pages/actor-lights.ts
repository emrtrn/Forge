import { SceneApp } from "@/scene/SceneApp";
import { createForgeRuntime } from "@/scene/ForgeRuntime";
import { BoxGeometry, Color, Mesh, MeshStandardMaterial, PointLight, SpotLight, Vector3 } from "three";
import type { Object3D, PerspectiveCamera, Scene } from "three";

// Exercise both production host builders. Only this disposable scene and its
// receiving surfaces are test-owned; no authored content is saved.
const canvas = document.querySelector("canvas")!;
const editor = new URLSearchParams(location.search).has("editor");
const runtime = editor ? null : await createForgeRuntime({ canvas });
const app = runtime?.app ?? new SceneApp(canvas, { enabled: true });
if (runtime) await runtime.loadLevel("layouts/__playwright-smoke.level.json");
const internal = app as unknown as {
  actorObjects: Object3D[] | Map<string, Object3D>;
  scene: Scene;
  camera: PerspectiveCamera;
};
const hosts = () => Array.from(internal.actorObjects.values());
await new Promise<void>((resolve) => {
  const check = () => hosts().length > 0 ? resolve() : window.setTimeout(check, 50);
  check();
});
const host = hosts()[0]!;
const points: PointLight[] = [], spots: SpotLight[] = [];
host.traverse((child) => {
  if (child instanceof PointLight) points.push(child);
  if (child instanceof SpotLight) spots.push(child);
});
// Two matte receivers: the spot lights the left one; the point lights the right.
for (const x of [-2, 2]) {
  const mesh = new Mesh(new BoxGeometry(2, 2, 0.25), new MeshStandardMaterial({ color: "#ffffff", roughness: 1 }));
  mesh.position.set(x, 2, -1);
  internal.scene.add(mesh);
}
internal.scene.background = new Color("#111111");
internal.camera.position.set(0, 3, 10);
internal.camera.lookAt(0, 2, 0);
internal.camera.updateMatrixWorld(true);
host.updateMatrixWorld(true);
document.querySelector("output")!.textContent = JSON.stringify({
  spots: spots.length, points: points.length,
  pointPosition: points[0]?.getWorldPosition(new Vector3()).toArray(),
});
const toggle = document.querySelector<HTMLButtonElement>("button")!;
toggle.disabled = false;
toggle.addEventListener("click", () => {
  const point = points[0];
  if (point) point.intensity = point.intensity > 0 ? 0 : 10;
  toggle.textContent = point?.intensity ? "Point light off" : "Point light on";
});
app.start();
