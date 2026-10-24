/** Small-object distance culling of static placements (OPEN_WORLD_PLAN Faz 7e). */
import assert from "node:assert/strict";
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from "three";
import {
  DETAIL_CULL_MAX_DISTANCE,
  detailBatchCulled,
  detailCullDistance,
  detailCullWindow,
} from "../../engine/world/detailCulling";
import { StaticDetailCulling } from "../../engine/render-three/staticDetailCulling";

type Check = (label: string, fn: () => void) => void;

function batchAt(positions: readonly [number, number, number][], scale = 1): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial(), positions.length);
  positions.forEach((position, index) => {
    mesh.setMatrixAt(index, new Matrix4().makeScale(scale, scale, scale).setPosition(...position));
  });
  mesh.computeBoundingSphere();
  return mesh;
}

function group(...meshes: InstancedMesh[]): Group {
  const root = new Group();
  root.add(...meshes);
  return root;
}

export function registerDetailCullingTests(check: Check): void {
  check("detail culling: cull distance is 200 × radius, and large assets never cull", () => {
    assert.equal(detailCullDistance(0.5), 100);
    assert.equal(detailCullDistance(5), DETAIL_CULL_MAX_DISTANCE);
    assert.equal(detailCullDistance(5.01), null);
    assert.equal(detailCullDistance(0), null);
    assert.equal(detailCullDistance(Number.NaN), null);
    assert.deepEqual(detailCullWindow(100, 0.5), [40, 50]);
    assert.deepEqual(detailCullWindow(100, 0), [80, 100]);
  });

  check("detail culling: a batch is skipped only when its nearest point is past its largest instance's distance", () => {
    // Sphere centre 160 m away, radius 10: nearest point 150 m.
    assert.equal(detailBatchCulled(160, 10, 100, 1, 1), true);
    assert.equal(detailBatchCulled(160, 10, 100, 1.5, 1), false);
    assert.equal(detailBatchCulled(160, 10, 100, 2, 0.5), true);
    assert.equal(detailBatchCulled(105, 10, 100, 1, 1), false);
  });

  check("detail culling: small assets render through shared size-scaled fade clones, large ones are left alone", () => {
    const culling = new StaticDetailCulling();
    const a = batchAt([[0, 0, 0]]);
    const b = batchAt([[50, 0, 0]]);
    const source = a.material as MeshStandardMaterial;
    b.material = source;
    assert.equal(culling.register("rock", 0.87, group(a, b), { skipWholeInstanced: true }), true);
    assert.notEqual(a.material, source);
    assert.equal(a.material, b.material, "one clone per asset and source material");
    assert.match(String((a.material as MeshStandardMaterial).customProgramCacheKey()), /forge-foliage-fade-scaled-v1/);
    assert.ok(a.customDepthMaterial && a.customDistanceMaterial);
    // Registering an already-faded batch again (a rebuild) keeps the same clone.
    assert.equal(culling.register("rock", 0.87, group(a), { skipWholeInstanced: false }), true);
    assert.equal(a.material, b.material);

    const building = batchAt([[0, 0, 0]]);
    const buildingMaterial = building.material;
    assert.equal(culling.register("building", 12, group(building), { skipWholeInstanced: true }), false);
    assert.equal(building.material, buildingMaterial);
    culling.dispose();
  });

  check("detail culling: compact batches hide past range and come back, never un-hiding someone else's mesh", () => {
    const culling = new StaticDetailCulling();
    const near = batchAt([[10, 0, 0]]);
    const far = batchAt([[300, 0, 0], [310, 0, 0]]);
    const scaled = batchAt([[300, 0, 0]], 3);
    culling.register("crate", 1, group(near, far, scaled), { skipWholeInstanced: true });
    const camera = new Vector3(0, 0, 0);
    culling.update(camera, 1); // cull distance 200 m
    assert.equal(near.visible, true);
    assert.equal(far.visible, false);
    assert.equal(scaled.visible, true, "a 3× instance fades at 600 m");
    assert.equal(culling.culledMeshCount(), 1);
    culling.update(new Vector3(200, 0, 0), 1);
    assert.equal(far.visible, true);
    assert.equal(near.visible, true);

    near.visible = false; // hidden by its owner, not by culling
    culling.update(camera, 1);
    culling.update(new Vector3(5, 0, 0), 1);
    assert.equal(near.visible, false);

    culling.release(far);
    assert.equal(far.visible, true, "releasing un-hides what culling hid");
    culling.update(camera, 1);
    assert.equal(far.visible, true, "a released batch is no longer driven");
    culling.dispose();
  });

  check("detail culling: per-placement clones fade and skip by their own world scale", () => {
    const culling = new StaticDetailCulling();
    const level = new Group();
    const instanced = batchAt([[0, 0, 0]]);
    const clone = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    clone.position.set(300, 0, 0);
    const bigClone = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    bigClone.position.set(300, 0, 50);
    bigClone.scale.setScalar(3);
    level.add(instanced, clone, bigClone);
    // A level-wide batch: its InstancedMesh only fades, its clones still skip whole.
    culling.register("crate", 1, level, { skipWholeInstanced: false });
    culling.update(new Vector3(0, 0, 0), 1);
    assert.match(String((clone.material as MeshStandardMaterial).customProgramCacheKey()), /forge-foliage-fade-scaled-v1/);
    assert.equal(clone.visible, false);
    assert.equal(bigClone.visible, true);
    assert.equal(instanced.visible, true);
    culling.update(new Vector3(1000, 0, 0), 1);
    assert.equal(instanced.visible, true, "a level-wide InstancedMesh is never skipped whole");
    culling.dispose();
  });
}
