import { Box3, Mesh, Raycaster, Vector3, type Group, type PerspectiveCamera, type Scene, type WebGLRenderer } from "three";
import { createForgeRuntime } from "@/scene/ForgeRuntime";
import { createDefaultRuntimeModules } from "@/scene/capabilities/defaultRuntimeModules";
import { createGameModule } from "@/game/gameModule";
import type { PhysicsSubsystem } from "@engine/physics/physicsSubsystem";
import { updateLandscapeLod } from "@engine/render-three/landscape";
import type { Entity } from "@engine/scene/entity";

// Test-only readback of the real shell, rendering and Rapier bodies. Authoring
// uses the normal editor page, user controls and real disk save endpoints.
const forge = await createForgeRuntime({ canvas: document.querySelector("canvas")!,
  modules: createDefaultRuntimeModules(), gameModules: [createGameModule()] });
await forge.loadLevel("layouts/__playwright-spline-world.level.json");
forge.start();
const internal = forge.app as unknown as { frameHandle: number; camera: PerspectiveCamera; scene: Scene;
  renderer: WebGLRenderer; landscapeObjects: Group[]; landscapeColliderEntities: Entity[]; physicsSubsystem: PhysicsSubsystem;
  postProcessPipeline: { render(dt: number): void } | null };
(window as any).__splineRoad = {
  ready: true,
  capture() {
    cancelAnimationFrame(internal.frameHandle);
    const road = internal.landscapeObjects[0]!.getObjectByName("LandscapeSplineMeshes")!;
    road.updateWorldMatrix(true, true);
    let meshCount = 0; road.traverse((child) => { if (child instanceof Mesh) meshCount++; });
    const bounds = new Box3().setFromObject(road);
    const samples = [-8, -0.1, 0.1, 8].map((x) => {
      const ray = new Raycaster(new Vector3(x, 30, -16), new Vector3(0, -1, 0));
      const hit = ray.intersectObject(road, true)[0];
      const trace = internal.physicsSubsystem.traceCamera([x, 30, -16], [x, -10, -16]);
      return { x, renderY: hit?.point.y ?? null, physicsY: trace === null ? null : 30 - trace * 40 };
    });
    internal.camera.position.set(20, 23, 10); internal.camera.lookAt(0, 7, -16); internal.camera.updateMatrixWorld(true);
    for (const object of internal.landscapeObjects) updateLandscapeLod(object, internal.camera);
    if (internal.postProcessPipeline) internal.postProcessPipeline.render(0);
    else internal.renderer.render(internal.scene, internal.camera);
    return { meshCount, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, samples,
      colliders: internal.landscapeColliderEntities.map((entity) => entity.id),
      parents: internal.landscapeObjects.map((object) => ({ position: object.position.toArray(), road: Boolean(object.getObjectByName("LandscapeSplineMeshes")) })) };
  },
};
