import { AmbientLight, Color, CylinderGeometry, DirectionalLight, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer } from "three";
import { LakeWaterController } from "@/scene/lakeWaterController";
import { createRiverWaterObject } from "@engine/render-three/riverWater";
import { resolveRiverWater } from "@engine/scene/riverWater";
import { FULL_LAKE_QUALITY } from "@engine/perf/lakeQuality";
import type { VehicleState, VehicleWheelState } from "@engine/physics/vehicle/vehicleTypes";
import { createLakeFixture } from "../../engine/fixtures/lakeFixture";

const renderer = new WebGLRenderer({ canvas: document.querySelector("canvas")!, preserveDrawingBuffer: true });
renderer.setSize(800, 600); renderer.setPixelRatio(1); renderer.info.autoReset = false;
const scene = new Scene(); scene.background = new Color("#233544");
const sun = new DirectionalLight(0xffffff, 3); sun.position.set(-17, 18, -21); sun.target.position.set(-20, 12, -12);
scene.add(sun, sun.target, new AmbientLight(0xffffff, 1));
const camera = new PerspectiveCamera(48, 4 / 3, .1, 100); camera.position.set(-20, 20, .5); camera.lookAt(-20, 12, -12);
const bed = new Mesh(new PlaneGeometry(70, 60), new MeshBasicMaterial({ color: "#334c48" }));
bed.rotation.x = -Math.PI / 2; bed.position.set(-20, 9, -12); scene.add(bed);
const f = createLakeFixture();
const river = createRiverWaterObject({ ...resolveRiverWater({ id: "wheel-river", landscapeRef: "l", splineRef: "s", surfaceLevel: 14,
  waveAmplitude: 0, foamOpacity: 0, reflectionMode: "off", refractionStrength: 0, opacity: 1, bedVisibility: 0, surfaceStrength: 0 }),
  spline: { id: "s", points: [{ id: "a", position: [-8, 2, 0], width: 5, falloff: 0 }, { id: "b", position: [8, -2, 0], width: 5, falloff: 0 }],
    segments: [{ id: "s", startPointId: "a", endPointId: "b" }] },
  position: [-20, 0, -12], rotation: [0, 0, 0], heightAt: () => 5, foamNoiseMap: null }, null);
scene.add(river);
let wheels: VehicleWheelState[] = [], tick: ((dt: number) => void) | undefined;
const tyres = Array.from({ length: 4 }, () => {
  const tyre = new Mesh(new CylinderGeometry(.5, .5, .35, 16), new MeshBasicMaterial({ color: "#131313" }));
  tyre.rotation.z = Math.PI / 2; scene.add(tyre); return tyre;
});
const controller = new LakeWaterController({ scene, editor: false, rivers: () => [river], document: () => f,
  load: async (_, key) => f.tiles.get(key)!, normal: async () => null,
  vehicles: { vehicleIds: () => ["vehicle"], vehicleState: () => ({ wheels } as unknown as VehicleState), vehicleDefinition: () => null,
    onPhysicsStep: fn => { tick = fn; return () => { tick = undefined; }; } } });
const source = { ...f.lake, appearance: { foamEnabled: false, surfaceWavesEnabled: false, rippleSpeed: 0, surfaceStrength: 0,
  opacity: 1, bedVisibility: 0, reflectionMode: "off" as const, refractionStrength: 0, wheelRippleStrength: 4 } };
export interface WaterWheelOptions { kind: "river" | "lake"; moving: boolean; foam: boolean; submerged: boolean; ripples?: boolean; highlight?: boolean }
async function frame(options: WaterWheelOptions) {
  await controller.rebuild([source]);
  const quality = { ...FULL_LAKE_QUALITY, foamAllowed: options.foam };
  await controller.setQuality(quality); await river.applyQuality(quality);
  const lake = controller.objects.get(f.lake.id)!;
  lake.visible = options.kind === "lake"; river.visible = options.kind === "river";
  const object = options.kind === "lake" ? lake : river;
  sun.position.set(options.highlight ? options.kind === "lake" ? -20 : -17 : -22, 18, options.highlight ? -21 : -3);
  const before = object.onBeforeRender;
  object.onBeforeRender = function(...args) { before.apply(this, args); this.material.uniforms.time!.value = 0; };
  for (let step = 0; step < 120; step++) {
    const travel = options.moving ? -3 + step / 119 * 3 : 0;
    wheels = tyres.map((tyre, i) => {
      const x = -20 + (i % 2 ? .9 : -.9), z = -12 + (i < 2 ? -1.3 : 1.3) + travel;
      const y = 12 + (options.kind === "river" ? -(x + 20) * .25 : 0) + (options.submerged ? -2 : .1);
      tyre.position.set(x, y, z);
      return { position: [0, 0, 0], radius: .5, suspensionLength: .3, suspensionForce: 0, steering: 0, rotation: step / 20,
        inContact: false, groundEntityId: null, contactPoint: null, hardPoint: [x, y + .3, z],
        worldCenter: [x, y, z], worldAxle: [1, 0, 0], tractionSlip: 0 };
    });
    tick!(1 / 60);
  }
  if (options.ripples === false) object.material.uniforms.wheelRippleCount!.value = 0;
  renderer.info.reset(); renderer.render(scene, camera);
  if (object.material.uniforms.wheelFoamCount!.value) {
    const start = performance.now();
    while (object.material.uniforms.waterFoamReady!.value < .5 && performance.now() - start < 10000) {
      await new Promise(requestAnimationFrame); renderer.render(scene, camera);
    }
  }
  renderer.info.reset(); renderer.render(scene, camera);
  object.onBeforeRender = before;
  const gl = renderer.getContext(), pixels = new Uint8Array(800 * 600 * 4);
  gl.readPixels(0, 0, 800, 600, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let white = 0;
  for (let i = 0; i < pixels.length; i += 4) if (Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 170) white++;
  const samples: number[] = [];
  for (let y = 80; y < 550; y += 8) for (let x = 80; x < 720; x += 8) {
    const i = (y * 800 + x) * 4; samples.push(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
  }
  return { white, samples, ripples: object.material.uniforms.wheelRippleCount!.value, foam: object.material.uniforms.wheelFoamCount!.value,
    foamReady: object.material.uniforms.waterFoamReady!.value, textures: renderer.info.memory.textures,
    draws: renderer.info.render.calls, glError: gl.getError() };
}
declare global { interface Window { __waterWheels: { frame: typeof frame }; } }
window.__waterWheels = { frame };
