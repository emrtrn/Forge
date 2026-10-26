import { createForgeRuntime } from "@/scene/ForgeRuntime";
import { createDefaultRuntimeModules } from "@/scene/capabilities/defaultRuntimeModules";
import { createGameModule } from "@/game/gameModule";
import { QUALITY_PROFILES } from "@engine/perf/qualityProfiles";
import { updateLandscapeLod, type LandscapeObject } from "@engine/render-three/landscape";
import { sharedTerrainDeformation } from "@engine/render-three/terrain/terrainDeformation";
import type { DeformationField } from "@engine/scene/deformationField";
import type { PlanarReflectionSource } from "@engine/render-three/planarReflectionSource";
import type { Object3D, PerspectiveCamera, Scene, Texture, Vector4, WebGLRenderer } from "three";

// Real shell/modules/physics/vehicle/lighting, with test-only readback. No debug
// physics wires and no production globals or authored-content writes.
const forge = await createForgeRuntime({ canvas: document.querySelector("canvas")!,
  modules: createDefaultRuntimeModules(), gameModules: [createGameModule()], debug: false });
await forge.loadLevel("assets/starter-content/Levels/LandscapeTest.level.json");
forge.start();
let reflectedPixels: Uint8Array | null = null;
let captureSerial = 0;
(window as any).__terrainWaterRuntime = {
  ready: true,
  snapshot: () => forge.app.getTerrainDeformationSnapshot(),
  captureUltra() {
    const internal = forge.app as unknown as { frameHandle: number; renderer: WebGLRenderer; scene: Scene;
      camera: PerspectiveCamera; landscapeObjects: LandscapeObject[]; postProcessPipeline: { render(dt: number): void } | null };
    cancelAnimationFrame(internal.frameHandle);
    const physicalSnapshot = forge.app.getTerrainDeformationSnapshot();
    const deformation = sharedTerrainDeformation();
    const field = (deformation.water as unknown as { field: DeformationField }).field;
    const wheels = [...deformation.water.state.previous.values()];
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
    forge.app.applyQualitySettings(QUALITY_PROFILES.ultra);
    internal.camera.fov = 45; internal.camera.updateProjectionMatrix();
    internal.camera.position.set(22, 1.8, -38.5);
    internal.camera.lookAt(20.96, 0.8, -44.42); internal.camera.updateMatrixWorld(true);
    for (const object of internal.landscapeObjects) updateLandscapeLod(object, internal.camera);
    if (internal.postProcessPipeline) internal.postProcessPipeline.render(0);
    else internal.renderer.render(internal.scene, internal.camera);
    return { physicalSnapshot, snapshot: forge.app.getTerrainDeformationSnapshot(), reversed: internal.camera.reversedDepth,
      textures: internal.renderer.info.memory.textures };
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
    const groups = (water as unknown as { groups: { source: PlanarReflectionSource; level: number }[] }).groups;
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
      if (internal.postProcessPipeline) internal.postProcessPipeline.render(0);
      else internal.renderer.render(internal.scene, internal.camera);
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
