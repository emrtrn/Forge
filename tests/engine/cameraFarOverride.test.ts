/** Level view distance pins gameplay camera far planes (OPEN_WORLD_PLAN Faz 7a). */
import assert from "node:assert/strict";
import { PerspectiveCamera } from "three";
import { cameraFarOverride, setCameraFarOverride } from "../../engine/render-three/camera";
import { PlayerCameraManager } from "../../src/game/playerCameraManager";

type Check = (label: string, fn: () => void) => void;

export function registerCameraFarOverrideTests(check: Check): void {
  check("camera far override: pins the far plane and restores the camera's own far", () => {
    const camera = new PerspectiveCamera(44, 1, 0.1, 2000);
    setCameraFarOverride(camera, 3000);
    assert.equal(camera.far, 3000);
    assert.equal(cameraFarOverride(camera), 3000);
    assert.ok(Math.abs(camera.projectionMatrix.elements[10]! + (3000 + 0.1) / (3000 - 0.1)) < 1e-9);
    // A second override keeps the original far as the value to hand back.
    setCameraFarOverride(camera, 1500);
    setCameraFarOverride(camera, null);
    assert.equal(camera.far, 2000);
    assert.equal(cameraFarOverride(camera), undefined);
    // Clearing a camera that was never overridden leaves it alone.
    camera.far = 750;
    setCameraFarOverride(camera, null);
    assert.equal(camera.far, 750);
  });

  check("camera far override: wins over a view target's far clip in PlayerCameraManager", () => {
    const camera = new PerspectiveCamera(44, 1, 0.1, 2000);
    const manager = new PlayerCameraManager(camera);
    const pose = { position: [0, 2, 5] as [number, number, number], target: [0, 1, 0] as [number, number, number] };
    setCameraFarOverride(camera, 4000);
    manager.setViewTarget({ source: "spring-arm", pose, projection: { fov: 50, near: 0.2, far: 100 } });
    manager.update(1 / 60);
    assert.equal(camera.far, 4000);
    assert.equal(camera.near, 0.2);
    assert.equal(camera.fov, 50);
    setCameraFarOverride(camera, null);
    manager.update(1 / 60);
    assert.equal(camera.far, 100);
  });
}
