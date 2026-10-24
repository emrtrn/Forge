/** Camera-following sun shadow binding (OPEN_WORLD_PLAN Faz 7c1). */
import assert from "node:assert/strict";
import { DirectionalLight, Group, Scene, Vector3 } from "three";
import { FOLLOW_SHADOW_DEPTH, updateSunFollowShadow } from "../../engine/render-three/sunFollowShadow";

type Check = (label: string, fn: () => void) => void;

function sunUnderRotatedRoot(): { scene: Scene; sun: DirectionalLight } {
  const scene = new Scene();
  // Light actors parent the light under a transformed root, the target in the scene.
  const root = new Group();
  root.position.set(4, 8, 4);
  root.rotation.set(-0.7, 0.5, 0);
  scene.add(root);
  const sun = new DirectionalLight("#ffffff", 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  root.add(sun);
  scene.add(sun.target);
  sun.target.position.set(-6, 0, -9);
  scene.updateMatrixWorld(true);
  return { scene, sun };
}

function lightDirection(sun: DirectionalLight): Vector3 {
  const from = sun.getWorldPosition(new Vector3());
  return sun.target.getWorldPosition(new Vector3()).sub(from).normalize();
}

export function registerSunFollowShadowTests(check: Check): void {
  check("sun follow shadow: re-centres ahead of the camera without turning the light", () => {
    const { sun } = sunUnderRotatedRoot();
    const before = lightDirection(sun);
    const camera = new Vector3(1200, 40, -800);
    const ok = updateSunFollowShadow(sun, camera, new Vector3(0, -0.3, -1), { halfExtent: 45 });
    assert.equal(ok, true);
    const after = lightDirection(sun);
    assert.ok(before.distanceTo(after) < 1e-9, `direction ${before.toArray()} → ${after.toArray()}`);
    const target = sun.target.getWorldPosition(new Vector3());
    // Half an extent ahead along the horizontal forward, within a texel of the focus laterally.
    const texel = 90 / 1024;
    const focus = new Vector3(1200, 40, -800 - 22.5);
    const offset = target.clone().sub(focus);
    const alongLight = offset.dot(after);
    assert.ok(offset.clone().addScaledVector(after, -alongLight).length() <= texel * Math.SQRT1_2 + 1e-6);
    assert.ok(Math.abs(alongLight) < 1e-6);
    assert.ok(Math.abs(sun.getWorldPosition(new Vector3()).distanceTo(target) - FOLLOW_SHADOW_DEPTH) < 1e-6);
    const shadow = sun.shadow.camera;
    assert.deepEqual([shadow.left, shadow.right, shadow.top, shadow.bottom, shadow.near, shadow.far], [-45, 45, 45, -45, 0, 300]);
    assert.ok(Math.abs(sun.shadow.bias + 0.02 / 300) < 1e-12);
  });

  check("sun follow shadow: sub-texel camera motion keeps the frustum still", () => {
    const { sun } = sunUnderRotatedRoot();
    updateSunFollowShadow(sun, new Vector3(50, 2, 50), new Vector3(1, 0, 0), { halfExtent: 60 });
    const first = sun.target.getWorldPosition(new Vector3());
    const direction = lightDirection(sun);
    // Move along the light direction: no lateral component, so no texel change.
    updateSunFollowShadow(sun, new Vector3(50, 2, 50).addScaledVector(direction, 3), new Vector3(1, 0, 0), { halfExtent: 60 });
    const second = sun.target.getWorldPosition(new Vector3());
    const lateral = second.clone().sub(first);
    lateral.addScaledVector(direction, -lateral.dot(direction));
    assert.ok(lateral.length() < 1e-6, `lateral drift ${lateral.length()}`);
  });
}
