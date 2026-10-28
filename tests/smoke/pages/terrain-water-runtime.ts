import { createForgeRuntime } from "@/scene/ForgeRuntime";
import { createDefaultRuntimeModules } from "@/scene/capabilities/defaultRuntimeModules";
import { createGameModule } from "@/game/gameModule";
import type { AuthoredEnvironment } from "@engine/render-three/authoredEnvironment";
import { updateLandscapeLod, type LandscapeObject } from "@engine/render-three/landscape";
import { sharedTerrainDeformation } from "@engine/render-three/terrain/terrainDeformation";
import type { DeformationField } from "@engine/scene/deformationField";
import type { PlanarReflectionSource } from "@engine/render-three/planarReflectionSource";
import type { TerrainWaterContact } from "@engine/render-three/terrain/terrainWaterState";
import { DataUtils, type WebGLRenderTarget } from "three";
import type { Object3D, PerspectiveCamera, Scene, ShaderMaterial, Texture, Vector4, WebGLRenderer } from "three";

// Real shell/modules/physics/vehicle/lighting, with test-only readback. No debug
// physics wires and no production globals or authored-content writes.
const forge = await createForgeRuntime({ canvas: document.querySelector("canvas")!,
  modules: createDefaultRuntimeModules(), gameModules: [createGameModule()], debug: false });
await forge.loadLevel("assets/starter-content/Levels/LandscapeTest.level.json");
forge.start();
let reflectedPixels: Uint8Array | null = null;
let captureSerial = 0;
let realWaterContacts: TerrainWaterContact[] = [];
let calmRipplePixels: Uint8Array | null = null;
function drawRuntimeReview() {
  const state = forge.app as unknown as { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera;
    environment: AuthoredEnvironment; updateFollowShadow(): void;
    postProcessPipeline: { render(dt: number): void } | null };
  state.environment.update(0); state.updateFollowShadow();
  state.renderer.info.reset();
  if (state.postProcessPipeline) state.postProcessPipeline.render(0);
  else state.renderer.render(state.scene, state.camera);
}
(window as any).__terrainWaterRuntime = {
  ready: true,
  snapshot: () => forge.app.getTerrainDeformationSnapshot(),
  captureWater() {
    const internal = forge.app as unknown as { frameHandle: number; renderer: WebGLRenderer; scene: Scene;
      camera: PerspectiveCamera; landscapeObjects: LandscapeObject[]; postProcessPipeline: { render(dt: number): void } | null };
    cancelAnimationFrame(internal.frameHandle);
    const physicalSnapshot = forge.app.getTerrainDeformationSnapshot();
    const deformation = sharedTerrainDeformation();
    const field = (deformation.water as unknown as { field: DeformationField }).field;
    const wheels = [...deformation.water.state.previous.values()];
    realWaterContacts = wheels;
    // The physics/contact bridge was checked above. Extend its real wheel
    // footprints only in this disposable scene, making an 8 m rut visible
    // without waiting for a bogged truck to cover that distance in software GL.
    const seeded = [];
    for (const wheel of wheels) {
      field.stampWheel({ from: [wheel.x, wheel.z - 5], to: [wheel.x, wheel.z + 4], width: wheel.width,
        contactLength: 0.5, targetDepth: 0.18, compaction: 1, disturbance: 255 });
      for (let dz = -5; dz <= 4; dz += 0.25) seeded.push({ ...wheel, id: `qa:${wheel.id}:${dz}`, z: wheel.z + dz });
    }
    deformation.update(field.takeDirty());
    if (physicalSnapshot) deformation.water.advance(1 / 60, seeded, physicalSnapshot.centre, field);
    // Keep the test's authored/custom pipeline. Switching to Ultra after
    // stopping its rAF rebuilds post-processing mid-capture.
    internal.camera.fov = 45; internal.camera.updateProjectionMatrix();
    internal.camera.position.set(22, 1.8, -38.5);
    internal.camera.lookAt(20.96, 0.8, -44.42); internal.camera.updateMatrixWorld(true);
    for (const object of internal.landscapeObjects) updateLandscapeLod(object, internal.camera);
    drawRuntimeReview();
    return { physicalSnapshot, snapshot: forge.app.getTerrainDeformationSnapshot(), reversed: internal.camera.reversedDepth,
      textures: internal.renderer.info.memory.textures, draws: internal.renderer.info.render.calls,
      exposure: internal.renderer.toneMappingExposure, toneMapping: internal.renderer.toneMapping,
      camera: { position: internal.camera.position.toArray(), far: internal.camera.far },
      depthState: internal.renderer.state.buffers.depth.getReversed() };
  },
  wheelRippleAppearance(on: boolean) {
    const internal = forge.app as unknown as { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera;
      landscapeObjects: LandscapeObject[]; postProcessPipeline: { render(dt: number): void } | null };
    const deformation = sharedTerrainDeformation();
    const water = deformation.water;
    if (!on) {
      // Choose a wet part of the extended real tyre footprint. The original
      // contact can now legitimately sit on a dry gap between puddles.
      const target = (water as unknown as { targets: [WebGLRenderTarget, WebGLRenderTarget] }).targets[0];
      const pixels = new Uint16Array(target.width * target.height * 4);
      internal.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
      const origin = water.uniforms.uTerrainWaterWindow.value;
      realWaterContacts = realWaterContacts.map(contact => {
        let best = contact, distance = Infinity;
        for (let z = 0; z < target.height; z++) for (let x = 0; x < target.width; x++) {
          const wx = origin.x + (x + .5) * 32 / target.width, wz = origin.y + (z + .5) * 32 / target.height;
          const d = Math.abs(wz - contact.z);
          if (Math.abs(wx - contact.x) < contact.width * .2 && d < 1.5 && d < distance
            && DataUtils.fromHalfFloat(pixels[(z * target.width + x) * 4 + 3]!) > .95) {
            best = { ...contact, x: wx, z: wz }; distance = d;
          }
        }
        if (!Number.isFinite(distance)) throw new Error("No water patch on the seeded wheel footprint");
        return best;
      });
      const wheel = realWaterContacts.reduce((closest, item) => item.x > closest.x ? item : closest);
      internal.camera.fov = 50; internal.camera.updateProjectionMatrix();
      internal.camera.position.set(wheel.x + 2, wheel.y + 0.85, wheel.z + 1.2);
      internal.camera.lookAt(wheel.x, wheel.y - 0.12, wheel.z); internal.camera.updateMatrixWorld(true);
      for (const object of internal.landscapeObjects) updateLandscapeLod(object, internal.camera);
      const field = (water as unknown as { field: DeformationField }).field;
      const centre = forge.app.getTerrainDeformationSnapshot()!.centre;
      const contacts = realWaterContacts.map((contact) => ({ ...contact, tractionSlip: 0.8 }));
      for (let i = 0; i < 24; i++) {
        water.advance(1 / 60, contacts, centre, field);
        water.render(internal.renderer, internal.scene, internal.camera, deformation.uniforms.uDeformTex!.value as Texture,
          deformation.uniforms.uDeformWindow!.value as Vector4, deformation.uniforms.uDeformDepthRange!.value as number);
      }
    }
    (water as unknown as { copy: ShaderMaterial }).copy.uniforms.rippleStrength!.value = on ? 1 : 0;
    // Compare only wavefronts: both images keep the same reflection capture.
    const groups = (water as unknown as { groups?: { source: PlanarReflectionSource }[] }).groups ?? [];
    const updates = groups.map((group) => group.source.update);
    groups.forEach((group) => { group.source.update = () => {}; });
    try {
      drawRuntimeReview();
    } finally { groups.forEach((group, i) => { group.source.update = updates[i]!; }); }
    const gl = internal.renderer.getContext();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let changed = 0, maxDifference = 0;
    if (!on) calmRipplePixels = pixels;
    else if (calmRipplePixels) for (let i = 0; i < pixels.length; i += 4) {
      const delta = Math.max(...[0, 1, 2].map((channel) => Math.abs(pixels[i + channel]! - calmRipplePixels![i + channel]!)));
      maxDifference = Math.max(maxDifference, delta);
      if (delta >= 8) changed++;
    }
    return { changed, maxDifference, wavefronts: water.state.ripples.length };
  },
  vehicleReflection(withVehicle: boolean) {
    const internal = forge.app as unknown as { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera;
      actorObjects: Map<string, Object3D>; landscapeObjects: LandscapeObject[];
      postProcessPipeline: { render(dt: number): void } | null };
    internal.camera.fov = 50; internal.camera.updateProjectionMatrix();
    internal.camera.lookAt(22, -0.1, -41.8); internal.camera.updateMatrixWorld(true);
    for (const object of internal.landscapeObjects) updateLandscapeLod(object, internal.camera);
    const deformation = sharedTerrainDeformation();
    const water = deformation.water;
    const groups = (water as unknown as { groups?: { source: PlanarReflectionSource; level: number }[] }).groups ?? [];
    const actor = internal.actorObjects.get("actor:0")!;
    actor.visible = withVehicle;
    captureSerial++;
    for (const group of groups) group.source.setPlaneHeight(group.level + captureSerial * 1e-5);
    try {
      water.render(internal.renderer, internal.scene, internal.camera, deformation.uniforms.uDeformTex!.value as Texture,
        deformation.uniforms.uDeformWindow!.value as Vector4, deformation.uniforms.uDeformDepthRange!.value as number);
    } finally { actor.visible = true; }
    // Hold the captured image for the main frame. The real truck remains visible;
    // only its contribution to the reflection differs between the two pictures.
    const updates = groups.map((group) => group.source.update);
    groups.forEach((group) => { group.source.update = () => {}; });
    try {
      drawRuntimeReview();
    } finally { groups.forEach((group, i) => { group.source.update = updates[i]!; }); }
    const gl = internal.renderer.getContext();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let changed = 0, maxDifference = 0;
    if (withVehicle) reflectedPixels = pixels;
    else if (reflectedPixels) for (let i = 0; i < pixels.length; i += 4) {
      const delta = Math.max(Math.abs(pixels[i]! - reflectedPixels[i]!), Math.abs(pixels[i + 1]! - reflectedPixels[i + 1]!), Math.abs(pixels[i + 2]! - reflectedPixels[i + 2]!));
      maxDifference = Math.max(maxDifference, delta);
      if (delta > 15) changed++;
    }
    return { changed, maxDifference };
  },
};
