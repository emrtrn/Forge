import assert from "node:assert/strict";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";

import { bakeFracture } from "../../engine/physics/fracture/fractureBake";
import { fractureSourceHash } from "../../engine/physics/fracture/fractureTypes";
import { checkFractureSource, polyhedronFromMesh, polyhedronVolume } from "../../engine/physics/fracture/voronoiFracture";
import { fractureChunkGeometry, fractureSourceFromObject } from "../../engine/render-three/fractureGeometry";

type Check = (label: string, fn: () => void) => void;

const close = (actual: number, expected: number, epsilon = 1e-5): void =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

export function registerFractureGeometryTests(check: Check): void {
  check("fracture geometry: model meshes merge in root space with transformed normals and a material list", () => {
    const root = new Group();
    root.position.set(100, 0, 0); // the root's own transform is not applied
    const wood = new MeshStandardMaterial();
    const metal = new MeshStandardMaterial();
    const a = new Mesh(new BoxGeometry(1, 1, 1), wood);
    a.position.set(0, 2, 0);
    const b = new Mesh(new BoxGeometry(1, 1, 1), [metal, wood]);
    b.rotation.set(0, Math.PI / 2, 0);
    b.scale.setScalar(2);
    root.add(a, b);
    const source = fractureSourceFromObject(root);
    assert.equal(source.meshCount, 2);
    assert.deepEqual(source.materials, [wood, metal]);
    assert.equal(source.mesh.positions.length, 2 * 24 * 3);
    assert.equal(source.mesh.indices!.length, 2 * 36);
    // First box sits 2 m up in root space; its +X face normal (vertex 0) stays +X.
    close(source.mesh.positions[1]!, 2.5);
    close(source.mesh.normals[0]!, 1);
    // Second box: scale 2 → vertices at ±1; rotated 90° about Y, its +X normal becomes -Z.
    const second = 24;
    close(Math.abs(source.mesh.positions[second * 3]!), 1);
    close(source.mesh.normals[second * 3 + 2]!, -1);
    close(source.mesh.normals[second * 3]!, 0);
  });

  check("fracture geometry: a mirrored node keeps outward winding, so the merged box stays closed and positive", () => {
    const root = new Group();
    const mirrored = new Mesh(new BoxGeometry(2, 1, 1), new MeshStandardMaterial());
    mirrored.scale.set(-1, 1, 1);
    root.add(mirrored);
    const { mesh } = fractureSourceFromObject(root);
    // Convex only holds with outward winding: flipped triangles would put every
    // other vertex on their outer side.
    assert.deepEqual(checkFractureSource(mesh, 1e-6), { closed: true, convex: true });
    close(polyhedronVolume(polyhedronFromMesh(mesh)), 2);
  });

  check("fracture geometry: a three BoxGeometry bakes into chunks that keep its volume and draw with two groups", () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(2, 1, 0.5), new MeshStandardMaterial()));
    const { mesh } = fractureSourceFromObject(root);
    assert.deepEqual(checkFractureSource(mesh, 1e-6), { closed: true, convex: true });
    const baked = bakeFracture(mesh, { seed: 7, cellCount: 10, totalMass: 10 });
    close(baked.chunks.reduce((sum, chunk) => sum + chunk.volume, 0), 1, 1e-6);
    for (const chunk of baked.chunks) {
      const geometry = fractureChunkGeometry(chunk);
      assert.equal(geometry.getAttribute("position").count, chunk.geometry.positions.length / 3);
      assert.equal(geometry.getIndex()!.count, chunk.geometry.indices.length);
      assert.deepEqual(geometry.groups.map((group) => group.materialIndex), chunk.geometry.groups.map((group) => group.materialIndex));
      assert.ok(geometry.groups.some((group) => group.materialIndex === 1), "every chunk of a 10-cell box has a cut face");
      // Pivot-relative: the chunk's own bounds straddle its origin.
      const box = geometry.boundingBox!;
      assert.ok(box.min.x < 0 && box.max.x > 0 && box.min.y < 0 && box.max.y > 0);
      geometry.dispose();
    }
  });

  check("fracture geometry: the editor model and a runtime clone hash the same; an edit changes it", () => {
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial());
    mesh.position.set(0, 1, 0);
    root.add(mesh);
    const hash = fractureSourceHash(fractureSourceFromObject(root).mesh);
    // The runtime instantiates models with clone(true), sharing geometry.
    assert.equal(fractureSourceHash(fractureSourceFromObject(root.clone(true)).mesh), hash);
    root.position.set(5, 5, 5); // the root's placement is not part of the asset
    assert.equal(fractureSourceHash(fractureSourceFromObject(root).mesh), hash);
    mesh.position.y = 1.01;
    assert.notEqual(fractureSourceHash(fractureSourceFromObject(root).mesh), hash);
  });
}
