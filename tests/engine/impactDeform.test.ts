import assert from "node:assert/strict";
import {
  applyDent, createDentSurface, dentDepthForImpulse, locateDent, planDent, resolveDentPart,
  type Dent, type DentParams, type DentSurface, type DentSurfaceInput, type DentVec3,
} from "../../engine/physics/deformable/impactDeform";

const params: DentParams = { dentImpulse: 100, fullImpulse: 1100, radius: 0.5, maxDepth: 0.2, plasticity: 0.5, maxDents: 3 };
const INTO: DentVec3 = [0, 0, -1];

/** A flat grid facing +Z at height `z`, `size` metres wide, centred on the origin. */
function grid(cells: number, size: number, z = 0, nz = 1): DentSurfaceInput {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const row = cells + 1;
  for (let y = 0; y < row; y += 1) {
    for (let x = 0; x < row; x += 1) {
      positions.push((x / cells - 0.5) * size, (y / cells - 0.5) * size, z);
      normals.push(0, 0, nz);
    }
  }
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const a = y * row + x;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  return { positions, normals, indices };
}

const deepest = (surface: DentSurface): number => {
  let depth = 0;
  for (let vertex = 0; vertex < surface.vertexCount; vertex += 1) {
    depth = Math.max(depth, surface.rest[vertex * 3 + 2]! - surface.positions[vertex * 3 + 2]!);
  }
  return depth;
};

const dent = (x: number, y: number, depth: number): Dent => ({ point: [x, y, 0], direction: INTO, depth });

/** Registers the pure dent core's checks. */
export function registerImpactDeformTests(check: (label: string, run: () => void) => void): void {
  check("impact deform: depth ramps from dentImpulse to fullImpulse", () => {
    assert.equal(dentDepthForImpulse(params, 99), 0);
    assert.equal(dentDepthForImpulse(params, Number.NaN), 0);
    assert.equal(dentDepthForImpulse(params, 100), 0);
    assert.ok(Math.abs(dentDepthForImpulse(params, 600) - 0.05) < 1e-9);
    assert.ok(Math.abs(dentDepthForImpulse(params, 1100) - 0.1) < 1e-9);
    assert.ok(Math.abs(dentDepthForImpulse(params, 9000) - 0.1) < 1e-9);
  });

  check("impact deform: a dent moves the centre by its depth and nothing past its radius", () => {
    const surface = createDentSurface(grid(40, 4));
    const change = applyDent(surface, dent(0, 0, 0.1), params);
    assert.ok(change.moved > 0);
    assert.ok(Math.abs(deepest(surface) - 0.1) < 1e-6);
    for (let vertex = 0; vertex < surface.vertexCount; vertex += 1) {
      const distance = Math.hypot(surface.rest[vertex * 3]!, surface.rest[vertex * 3 + 1]!);
      if (distance >= params.radius) assert.equal(surface.positions[vertex * 3 + 2], surface.rest[vertex * 3 + 2]);
    }
  });

  check("impact deform: a vertex never passes maxDepth, however many dents add up", () => {
    const surface = createDentSurface(grid(40, 4));
    for (let hit = 0; hit < 10; hit += 1) applyDent(surface, dent(0, 0, 0.1), params);
    assert.ok(Math.abs(deepest(surface) - params.maxDepth) < 1e-6);
  });

  check("impact deform: the shape does not depend on the dents' order", () => {
    const dents = [dent(0, 0, 0.15), dent(0.2, 0, 0.15), dent(-0.1, 0.3, 0.1)];
    const forward = createDentSurface(grid(40, 4));
    for (const item of dents) applyDent(forward, item, params);
    const backward = createDentSurface(grid(40, 4));
    for (const item of [...dents].reverse()) applyDent(backward, item, params);
    for (let index = 0; index < forward.positions.length; index += 1) {
      assert.ok(Math.abs(forward.positions[index]! - backward.positions[index]!) < 1e-5, `position ${index}`);
    }
  });

  check("impact deform: deepening a dent equals replaying it at its final depth", () => {
    const live = createDentSurface(grid(40, 4));
    applyDent(live, dent(0, 0, 0.05), params);
    applyDent(live, dent(0, 0, 0.07), params);
    const replay = createDentSurface(grid(40, 4));
    applyDent(replay, dent(0, 0, 0.12), params);
    for (let index = 0; index < live.positions.length; index += 1) {
      assert.ok(Math.abs(live.positions[index]! - replay.positions[index]!) < 1e-5, `position ${index}`);
    }
  });

  check("impact deform: normals tilt on the dent's slope and stay authored elsewhere", () => {
    const surface = createDentSurface(grid(40, 4));
    applyDent(surface, dent(0, 0, 0.15), params);
    let tilted = 0;
    for (let vertex = 0; vertex < surface.vertexCount; vertex += 1) {
      const offset = vertex * 3;
      const length = Math.hypot(surface.normals[offset]!, surface.normals[offset + 1]!, surface.normals[offset + 2]!);
      assert.ok(Math.abs(length - 1) < 1e-5);
      const distance = Math.hypot(surface.rest[offset]!, surface.rest[offset + 1]!);
      if (distance > params.radius + 0.2) assert.equal(surface.normals[offset + 2], 1);
      if (distance > 0.15 && distance < 0.35 && surface.normals[offset + 2]! < 0.99) {
        tilted += 1;
        // The slope falls towards the centre, so it faces inwards.
        const inward = surface.normals[offset]! * -surface.rest[offset]! + surface.normals[offset + 1]! * -surface.rest[offset + 1]!;
        assert.ok(inward > 0, `vertex ${vertex}`);
      }
    }
    assert.ok(tilted > 8, `tilted ${tilted}`);
  });

  check("impact deform: a vertex split by a UV seam stays smooth, a hard edge keeps its crease", () => {
    // Two 21×21 grids sharing the x = 0 column, as a UV seam splits vertices.
    const left = grid(20, 2);
    const positions = Array.from(left.positions as number[]);
    const normals = Array.from(left.normals as number[]);
    const indices = Array.from(left.indices as number[]);
    const count = positions.length / 3;
    for (let index = 0; index < count; index += 1) {
      positions.push(positions[index * 3]! + 2, positions[index * 3 + 1]!, positions[index * 3 + 2]!);
      normals.push(0, 0, 1);
    }
    for (const index of left.indices as number[]) indices.push(index + count);
    const seam = createDentSurface({ positions, normals, indices });
    applyDent(seam, { point: [1, 0.3, 0], direction: INTO, depth: 0.15 }, params);
    // x = 1 is the last column of the first grid and the first of the second.
    const row = 21;
    const y = Math.round((0.3 + 1) / 2 * 20) + 2;
    const leftVertex = y * row + 20;
    const rightVertex = count + y * row;
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(Math.abs(seam.normals[leftVertex * 3 + axis]! - seam.normals[rightVertex * 3 + axis]!) < 1e-5, `axis ${axis}`);
    }
    assert.ok(seam.normals[leftVertex * 3 + 2]! < 0.999, "the seam vertex is on the slope");

    // The same position with perpendicular normals is a hard edge.
    const edge = createDentSurface({ positions: [0, 0, 0, 0, 0, 0], normals: [0, 0, 1, 1, 0, 0], indices: [] });
    assert.notEqual(edge.groupOf[0], edge.groupOf[1]);
  });

  check("impact deform: a weld needs the same position, whatever the hash says", () => {
    // Far apart, with the same normal: never one vertex, even on a hash collision.
    const count = 2000;
    const positions: number[] = [];
    const normals: number[] = [];
    for (let index = 0; index < count; index += 1) {
      positions.push(index * 0.37 - 300, (index * 7) % 50, -index * 0.11);
      normals.push(0, 0, 1);
    }
    const surface = createDentSurface({ positions, normals, indices: [] });
    assert.equal(surface.groupStart.length - 1, count);
    // Within the tolerance they are one.
    const close = createDentSurface({ positions: [1, 2, 3, 1.00001, 2, 3], normals: [0, 0, 1, 0, 0, 1], indices: [] });
    assert.equal(close.groupOf[0], close.groupOf[1]);
  });

  check("impact deform: a non-indexed mesh dents and welds its corners", () => {
    const indexed = grid(10, 2);
    const positions: number[] = [];
    const normals: number[] = [];
    for (const index of indexed.indices as number[]) {
      for (let axis = 0; axis < 3; axis += 1) {
        positions.push((indexed.positions as number[])[index * 3 + axis]!);
        normals.push((indexed.normals as number[])[index * 3 + axis]!);
      }
    }
    const surface = createDentSurface({ positions, normals, indices: null });
    assert.ok(applyDent(surface, dent(0, 0, 0.1), params).moved > 0);
    assert.ok(deepest(surface) > 0.05);
    assert.ok(surface.groupStart.length - 1 < surface.vertexCount / 3);
  });

  check("impact deform: the hit finds the striker's side, even off the surface", () => {
    const front = createDentSurface(grid(20, 2, 0.5, 1));
    const back = createDentSurface(grid(20, 2, -0.5, -1));
    const surfaces = [back, front];
    // A collider contact 0.3 m in front of the model.
    assert.deepEqual(locateDent(surfaces, [0, 0, 0.8], INTO, 0.3)?.map((value) => Math.round(value * 1000) / 1000), [0, 0, 0.5]);
    // A contact inside the model still lands on the outside.
    assert.deepEqual(locateDent(surfaces, [0, 0, 0.1], INTO, 0.3)?.map((value) => Math.round(value * 1000) / 1000), [0, 0, 0.5]);
    // The far side faces the other way.
    assert.deepEqual(locateDent(surfaces, [0, 0, -0.8], [0, 0, 1], 0.3)?.map((value) => Math.round(value * 1000) / 1000), [0, 0, -0.5]);
    assert.equal(locateDent(surfaces, [9, 0, 0.8], INTO, 0.3), null, "beside the model");
    assert.equal(locateDent(surfaces, [0, 0, 9], INTO, 0.3), null, "past the search reach");
  });

  check("impact deform: a dent leaves the far side of a thick object alone", () => {
    const front = createDentSurface(grid(20, 2, 0.5, 1));
    const back = createDentSurface(grid(20, 2, -0.5, -1));
    const point = locateDent([front, back], [0, 0, 0.6], INTO, 0.3)!;
    const item = { point, direction: INTO, depth: 0.1 };
    assert.ok(applyDent(front, item, params).moved > 0);
    assert.equal(applyDent(back, item, params).moved, 0);
  });

  check("impact deform: a point resolves to the first zone holding it, or the body", () => {
    const zone = (min: DentVec3, max: DentVec3) => ({ min, max });
    const parts = [
      { id: "mirror", nodes: ["Mirror"], zone: zone([0, 1, 0], [1, 2, 1]) },
      { id: "door", nodes: ["Door"], zone: zone([0, 0, 0], [1, 2, 1]) },
    ];
    assert.equal(resolveDentPart(parts, [0.5, 1.5, 0.5]), "mirror", "an earlier zone wins the overlap");
    assert.equal(resolveDentPart(parts, [0.5, 0.5, 0.5]), "door");
    assert.equal(resolveDentPart(parts, [1, 2, 1]), "mirror", "the box is inclusive");
    assert.equal(resolveDentPart(parts, [1.1, 0.5, 0.5]), null);
    assert.equal(resolveDentPart(undefined, [0, 0, 0]), null);
  });

  check("impact deform: a dent only merges with dents of its own part", () => {
    const onDoor = { ...dent(0, 0, 0.05), part: "door" };
    assert.deepEqual(planDent([onDoor], [0.1, 0, 0], INTO, 0.05, params, "door"), { kind: "deepen", index: 0, extra: 0.05 });
    assert.equal(planDent([onDoor], [0.1, 0, 0], INTO, 0.05, params).kind, "add", "the body beside it is a new dent");
    const added = planDent([dent(0, 0, 0.05)], [0.1, 0, 0], INTO, 0.05, params, "door");
    assert.ok(added.kind === "add" && added.dent.part === "door");
    const body = planDent([], [0, 0, 0], INTO, 0.05, params);
    assert.ok(body.kind === "add" && !("part" in body.dent), "a body dent saves as it always did");
  });

  check("impact deform: the dent list stays bounded", () => {
    assert.equal(planDent([], [0, 0, 0], INTO, 0, params).kind, "skip");
    const first = planDent([], [0, 0, 0], INTO, 0.1, params);
    assert.equal(first.kind, "add");

    const near = planDent([dent(0, 0, 0.05)], [0.1, 0, 0], INTO, 0.05, params);
    assert.deepEqual(near, { kind: "deepen", index: 0, extra: 0.05 });
    assert.equal(planDent([dent(0, 0, 0.05)], [0.4, 0, 0], INTO, 0.05, params).kind, "add", "outside half a radius");
    assert.equal(planDent([dent(0, 0, 0.05)], [0.1, 0, 0], [0, 0, 1], 0.05, params).kind, "add", "the opposite side is its own dent");

    const capped = planDent([dent(0, 0, 0.18)], [0, 0, 0], INTO, 0.1, params);
    assert.ok(capped.kind === "deepen" && Math.abs(capped.extra - 0.02) < 1e-9);
    assert.equal(planDent([dent(0, 0, 0.2)], [0, 0, 0], INTO, 0.1, params).kind, "skip");

    const full = [dent(0, 0, 0.05), dent(2, 0, 0.05), dent(4, 0, 0.05)];
    assert.equal(planDent(full, [0.4, 0, 0], INTO, 0.05, params).kind, "deepen", "a full list merges within the radius");
    assert.equal(planDent(full, [9, 0, 0], INTO, 0.05, params).kind, "skip");
  });
}
