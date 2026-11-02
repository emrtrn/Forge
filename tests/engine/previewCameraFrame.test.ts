import assert from "node:assert/strict";
import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { framePreviewCamera } from "../../src/editor/previewCameraFrame";

export function registerPreviewCameraFrameTests(check: (label: string, fn: () => void) => void): void {
  const box = new Box3(new Vector3(1700, 0, 4350), new Vector3(4155, 12, 4920));
  const corners = () => [box.min.x, box.max.x].flatMap(x => [box.min.y, box.max.y].flatMap(y =>
    [box.min.z, box.max.z].map(z => new Vector3(x, y, z))));
  check("preview camera: kilometre top/portrait bounds fit the frustum and keep north up", () => {
    for (const aspect of [1.6, 0.6]) {
      const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 2000);
      camera.position.set(0, 10, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
      const height = framePreviewCamera(camera, box, aspect)!;
      assert.ok(height > 80);
      assert.deepEqual(camera.up.toArray(), [0, 0, -1]);
      for (const p of corners()) {
        p.project(camera);
        assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1, p.toArray().join(","));
      }
    }
  });
  check("preview camera: perspective framing includes far corners, empty bounds leave the camera alone", () => {
    const camera = new PerspectiveCamera(44, 1, 0.1, 2000);
    camera.position.set(5, 5, 5); camera.lookAt(0, 0, 0);
    framePreviewCamera(camera, box, 0.7);
    for (const p of corners()) {
      p.project(camera);
      assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1, p.toArray().join(","));
    }
    const before = camera.position.toArray();
    assert.equal(framePreviewCamera(camera, new Box3(), 1), null);
    assert.deepEqual(camera.position.toArray(), before);
  });
}
