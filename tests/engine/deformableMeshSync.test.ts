import assert from "node:assert/strict";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  Object3D,
  PlaneGeometry,
  SkinnedMesh,
  Vector3,
} from "three";

import { DentTarget } from "../../engine/render-three/deformableMeshSync";
import type { DentParams, DentPart, DentVec3 } from "../../engine/physics/deformable/impactDeform";

const params: DentParams = { dentImpulse: 100, fullImpulse: 1100, radius: 0.5, maxDepth: 0.2, plasticity: 0.5, maxDents: 8 };
const INTO: DentVec3 = [0, 0, -1];

const panel = (size = 4, cells = 40): BufferGeometry => new PlaneGeometry(size, size, cells, cells);

const objectWith = (geometry: BufferGeometry): { root: Group; mesh: Mesh } => {
  const root = new Group();
  const mesh = new Mesh(geometry);
  root.add(mesh);
  return { root, mesh };
};

const positionsOf = (geometry: BufferGeometry): number[] => Array.from(geometry.getAttribute("position").array as ArrayLike<number>);

/** A body panel left of x = 0, and right of it a "Door" node holding a panel. */
const twoPieceObject = (): { root: Group; body: Mesh; door: Mesh } => {
  const root = new Group();
  const body = new Mesh(panel(4));
  body.position.x = -2;
  const doorNode = new Group();
  doorNode.name = "Door";
  doorNode.position.x = 2;
  const door = new Mesh(panel(4));
  doorNode.add(door);
  root.add(body, doorNode);
  return { root, body, door };
};

const DOOR_PART: DentPart = { id: "door", nodes: ["Door"], zone: { min: [0, -2, -1], max: [4, 2, 1] } };

/** Deepest world-space push of a mesh below the plane its rest geometry lies in. */
function deepestWorld(mesh: Mesh, axis: "x" | "y" | "z" = "z"): number {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute("position");
  const vertex = new Vector3();
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
    low = Math.min(low, vertex[axis]);
    high = Math.max(high, vertex[axis]);
  }
  return high - low;
}

/** World width of the moved area of a panel lying in the XY plane. */
function dentWidth(mesh: Mesh): number {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute("position");
  const vertex = new Vector3();
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
    if (Math.abs(vertex.z) < 1e-4) continue;
    low = Math.min(low, vertex.x);
    high = Math.max(high, vertex.x);
  }
  return high - low;
}

/** Registers dent-to-geometry checks. */
export function registerDeformableMeshSyncTests(check: (label: string, run: () => void) => void): void {
  check("deformable mesh: only the dented copy changes, the shared geometry stays byte for byte", () => {
    const shared = panel();
    const before = positionsOf(shared);
    const first = objectWith(shared);
    const second = objectWith(shared);
    assert.equal(new DentTarget(first.root).hit([0, 0, 0.1], INTO, 0.1, params), "dented");
    assert.notEqual(first.mesh.geometry, shared);
    assert.equal(second.mesh.geometry, shared);
    assert.deepEqual(positionsOf(shared), before);
    assert.deepEqual(shared.userData, {}, "the copy must not mark the model it came from");
    assert.equal(first.mesh.geometry.userData.forgeDeformClone, true);
    assert.ok(Math.abs(deepestWorld(first.mesh) - 0.1) < 1e-5);
    assert.equal(deepestWorld(second.mesh), 0);
  });

  check("deformable mesh: a hit in a part's zone stays on that part, however close the body is", () => {
    const car = twoPieceObject();
    const target = new DentTarget(car.root, { parts: [DOOR_PART] });
    const bodyGeometry = car.body.geometry;
    assert.equal(target.hit([0.1, 0, 0.1], INTO, 0.1, params), "dented");
    assert.equal(target.lastPart, "door");
    assert.equal(car.body.geometry, bodyGeometry, "the body sits inside the radius and keeps the shared model");
    assert.ok(Math.abs(deepestWorld(car.door) - 0.1) < 0.02, `door ${deepestWorld(car.door)}`);
    assert.equal(target.dentList[0]!.part, "door");
  });

  check("deformable mesh: a hit outside every zone stays on the body", () => {
    const car = twoPieceObject();
    const target = new DentTarget(car.root, { parts: [DOOR_PART] });
    const doorGeometry = car.door.geometry;
    assert.equal(target.partAt([-0.1, 0, 0.1], INTO, params.radius), null);
    assert.equal(target.hit([-0.1, 0, 0.1], INTO, 0.1, params), "dented");
    assert.equal(target.lastPart, null);
    assert.equal(car.door.geometry, doorGeometry);
    assert.ok(deepestWorld(car.body) > 0.05);
    assert.equal("part" in target.dentList[0]!, false);
  });

  check("deformable mesh: a zone is read in object space, so it follows a moved, scaled object", () => {
    const car = twoPieceObject();
    car.root.position.set(100, 0, 0);
    car.root.rotation.y = Math.PI;
    car.root.scale.setScalar(2);
    const target = new DentTarget(car.root, { parts: [{ ...DOOR_PART, zone: { min: [0, -9, -9], max: [9, 9, 9] } }] });
    const facing: DentVec3 = [0, 0, 1];
    assert.equal(target.partAt([95, 0, -0.1], facing, params.radius), "door", "the door side faces -X after the half turn");
    assert.equal(target.partAt([105, 0, -0.1], facing, params.radius), null);
  });

  check("deformable mesh: a contact point off the surface still counts for the part under it", () => {
    const car = twoPieceObject();
    const thin = { ...DOOR_PART, zone: { min: [0, -2, -0.1], max: [4, 2, 0.1] } as DentPart["zone"] };
    const target = new DentTarget(car.root, { parts: [thin] });
    assert.equal(target.partAt([1, 0, 0.6], INTO, params.radius), "door");
    assert.equal(target.hit([1, 0, 0.6], INTO, 0.1, params), "dented");
    assert.equal(target.lastPart, "door");
  });

  check("deformable mesh: a surface point outside the zone stays off the part behind it", () => {
    const car = twoPieceObject();
    const behind = { ...DOOR_PART, zone: { min: [0, -2, -3], max: [4, 2, -1] } as DentPart["zone"] };
    const target = new DentTarget(car.root, { parts: [behind] });
    assert.equal(target.partAt([1, 0, 0.1], INTO, params.radius), null);
  });

  check("deformable mesh: a zone with no surface along the hit falls back to the body", () => {
    const car = twoPieceObject();
    const target = new DentTarget(car.root, { parts: [{ ...DOOR_PART, zone: { min: [-9, -9, -9], max: [9, 9, 9] } }] });
    assert.equal(target.partAt([-3, 0, 0.1], INTO, params.radius), "door");
    assert.equal(target.hit([-3, 0, 0.1], INTO, 0.1, params), "dented");
    assert.equal(target.lastPart, null);
    assert.deepEqual(target.dentList.map((dent) => dent.part), [undefined]);
  });

  check("deformable mesh: neighbouring dents on two parts stay separate, and replay on their own meshes", () => {
    const live = twoPieceObject();
    const target = new DentTarget(live.root, { parts: [DOOR_PART] });
    target.hit([0.05, 0, 0.1], INTO, 0.05, params);
    target.hit([-0.05, 0, 0.1], INTO, 0.05, params);
    assert.deepEqual(target.dentList.map((dent) => dent.part), ["door", undefined]);

    const replayed = twoPieceObject();
    new DentTarget(replayed.root, { parts: [DOOR_PART] }).restore(target.dentList, params);
    assert.deepEqual(positionsOf(replayed.door.geometry), positionsOf(live.door.geometry));
    assert.deepEqual(positionsOf(replayed.body.geometry), positionsOf(live.body.geometry));
  });

  check("deformable mesh: a saved dent of a removed part stays on the body", () => {
    const car = twoPieceObject();
    const doorGeometry = car.door.geometry;
    new DentTarget(car.root, { parts: [DOOR_PART] }).restore([{ point: [-0.1, 0, 0], direction: INTO, depth: 0.1, part: "gone" }], params);
    assert.equal(car.door.geometry, doorGeometry);
    assert.ok(deepestWorld(car.body) > 0.05);
  });

  check("deformable mesh: a part whose nodes are not in the model is reported", () => {
    const car = twoPieceObject();
    const target = new DentTarget(car.root, { parts: [DOOR_PART, { ...DOOR_PART, id: "hood", nodes: ["Hood"] }] });
    assert.deepEqual(target.unmatchedParts(), ["hood"]);
  });

  check("deformable mesh: a miss or a skip leaves the shared geometry in place", () => {
    const shared = panel();
    const { root, mesh } = objectWith(shared);
    const target = new DentTarget(root);
    assert.equal(target.hit([50, 0, 0.1], INTO, 0.1, params), "missed");
    assert.equal(target.hit([0, 0, 0.1], INTO, 0, params), "skipped");
    assert.equal(mesh.geometry, shared);
    assert.deepEqual(target.dentList, []);
  });

  check("deformable mesh: the radius and depth are world metres on a scaled, turned object", () => {
    const { root, mesh } = objectWith(panel(4));
    root.scale.set(2, 2, 2);
    root.position.set(10, 0, 0);
    root.rotation.z = Math.PI / 2;
    const target = new DentTarget(root);
    assert.equal(target.hit([10, 0, 0.1], INTO, 0.1, params), "dented");
    assert.ok(Math.abs(deepestWorld(mesh) - 0.1) < 1e-4, `depth ${deepestWorld(mesh)}`);
    const width = (() => {
      mesh.updateWorldMatrix(true, false);
      const position = mesh.geometry.getAttribute("position");
      const vertex = new Vector3();
      let low = Number.POSITIVE_INFINITY;
      let high = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < position.count; index += 1) {
        vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(vertex.z) < 1e-4) continue;
        low = Math.min(low, vertex.y);
        high = Math.max(high, vertex.y);
      }
      return high - low;
    })();
    assert.ok(width > 0.6 && width <= 1.01, `width ${width}`);
  });

  check("deformable mesh: quantized and interleaved vertices unpack to plain floats", () => {
    const source = panel(2, 20);
    const position = source.getAttribute("position");
    const quantized = new Int16Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      quantized[index * 3] = Math.round(position.getX(index) * 10000);
      quantized[index * 3 + 1] = Math.round(position.getY(index) * 10000);
      quantized[index * 3 + 2] = 0;
    }
    const interleavedNormals = new Int8Array(position.count * 4);
    for (let index = 0; index < position.count; index += 1) interleavedNormals[index * 4 + 2] = 127;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(quantized, 3));
    geometry.setAttribute("normal", new InterleavedBufferAttribute(new InterleavedBuffer(interleavedNormals, 4), 3, 0, true));
    geometry.setIndex(source.getIndex());

    const { root, mesh } = objectWith(geometry);
    // KHR_mesh_quantization: the node's scale turns integers back into metres.
    mesh.scale.setScalar(1 / 10000);
    assert.equal(new DentTarget(root).hit([0, 0, 0.1], INTO, 0.1, params), "dented");
    const written = mesh.geometry;
    assert.ok(written.getAttribute("position").array instanceof Float32Array);
    assert.ok(written.getAttribute("normal").array instanceof Float32Array);
    assert.equal((written.getAttribute("normal") as BufferAttribute).isBufferAttribute, true);
    assert.ok(Math.abs(deepestWorld(mesh) - 0.1) < 1e-4, `depth ${deepestWorld(mesh)}`);
    assert.ok(dentWidth(mesh) <= 1.01, `width ${dentWidth(mesh)}`);
    for (let index = 0; index < written.getAttribute("normal").count; index += 1) {
      const normal = new Vector3().fromBufferAttribute(written.getAttribute("normal") as BufferAttribute, index);
      assert.ok(Math.abs(normal.length() - 1) < 1e-4, `normal ${index}`);
    }
  });

  check("deformable mesh: replaying a saved list gives the live shape", () => {
    const live = objectWith(panel());
    const target = new DentTarget(live.root);
    target.hit([0, 0, 0.1], INTO, 0.08, params);
    target.hit([0.1, 0, 0.1], INTO, 0.05, params);
    target.hit([1, 0.5, 0.1], INTO, 0.06, params);
    assert.equal(target.dentList.length, 2, "the second hit deepens the first dent");

    const saved = JSON.parse(JSON.stringify(target.dentList));
    const replay = objectWith(panel());
    new DentTarget(replay.root).restore(saved, params);
    const a = positionsOf(live.mesh.geometry);
    const b = positionsOf(replay.mesh.geometry);
    for (let index = 0; index < a.length; index += 1) assert.ok(Math.abs(a[index]! - b[index]!) < 1e-5, `position ${index}`);
  });

  check("deformable mesh: bounds cover the dent without a rescan", () => {
    const { root, mesh } = objectWith(panel());
    const target = new DentTarget(root);
    target.hit([0, 0, 0.1], INTO, 0.1, params);
    const box = mesh.geometry.boundingBox!;
    assert.ok(box.min.z <= -0.1 && box.max.z >= 0, `box ${box.min.z}..${box.max.z}`);
    assert.ok(mesh.geometry.boundingSphere!.radius > Math.hypot(2, 2));
  });

  check("deformable mesh: dispose restores the shared geometry and frees the copy", () => {
    const shared = panel();
    const { root, mesh } = objectWith(shared);
    const target = new DentTarget(root);
    target.hit([0, 0, 0.1], INTO, 0.1, params);
    const copy = mesh.geometry;
    let disposed = 0;
    copy.addEventListener("dispose", () => { disposed += 1; });
    target.dispose();
    assert.equal(mesh.geometry, shared);
    assert.equal(disposed, 1);
    assert.deepEqual(target.dentList, []);
  });

  check("deformable mesh: a mesh-paint clone is written in place, keeps its colours and stays its owner's", () => {
    const shared = panel();
    const paint = shared.clone();
    paint.userData.forgeMeshPaintClone = true;
    const colors = new Float32Array(paint.getAttribute("position").count * 4).fill(0.25);
    paint.setAttribute("color", new BufferAttribute(colors, 4));
    const { root, mesh } = objectWith(paint);
    const target = new DentTarget(root);
    target.hit([0, 0, 0.1], INTO, 0.1, params);
    assert.equal(mesh.geometry, paint);
    assert.equal(paint.getAttribute("color").array, colors);
    assert.ok(Math.abs(deepestWorld(mesh) - 0.1) < 1e-5);
    let disposed = 0;
    paint.addEventListener("dispose", () => { disposed += 1; });
    target.dispose();
    assert.equal(disposed, 0, "the placement frees its own mesh-paint clone");
  });

  check("deformable mesh: excluded and skinned meshes stay rigid", () => {
    const root = new Group();
    const body = new Mesh(panel());
    const wheel = new Mesh(panel());
    wheel.name = "wheel-front-left";
    wheel.position.z = -0.001;
    const skinned = new SkinnedMesh(panel());
    skinned.position.z = -0.002;
    root.add(body, wheel, skinned as Object3D);
    const wheelGeometry = wheel.geometry;
    const skinnedGeometry = skinned.geometry;
    const target = new DentTarget(root, { exclude: (mesh) => mesh.name.startsWith("wheel-") });
    assert.equal(target.hit([0, 0, 0.1], INTO, 0.1, params), "dented");
    assert.notEqual(body.geometry.uuid, wheelGeometry.uuid);
    assert.equal(wheel.geometry, wheelGeometry);
    assert.equal(skinned.geometry, skinnedGeometry);
  });
}
