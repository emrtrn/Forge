import assert from "node:assert/strict";
import { bakeFracture, type FractureBakeResult, type FractureChunk } from "../../engine/physics/fracture/fractureBake";
import {
  anchoredChunks, bottomAnchorBox, chunksInRadius, damageRadius, releaseSupportHit, supportIslands, type FractureLink,
} from "../../engine/physics/fracture/fractureSupport";
import {
  clipPolyhedron, faceArea, meshBounds, polyhedronFromMesh, voronoiCellPlanes,
  type FractureSourceMesh, type FractureVec3,
} from "../../engine/physics/fracture/voronoiFracture";

const close = (actual: number, expected: number, epsilon = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected} (epsilon ${epsilon})`);
const cross = (a: FractureVec3, b: FractureVec3): FractureVec3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function box(size: FractureVec3 = [2, 1, 0.5]): FractureSourceMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const n of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
    const u: FractureVec3 = Math.abs(n[0]) === 1 ? [0, 1, 0] : [1, 0, 0];
    const v = cross(n, u);
    const base = positions.length / 3;
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      for (let axis = 0; axis < 3; axis += 1) positions.push((n[axis]! + s * u[axis]! + t * v[axis]!) * size[axis]! / 2);
      normals.push(...n);
      uvs.push((s + 1) / 2, (t + 1) / 2);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals),
    uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

function interiorArea(chunk: FractureChunk): number {
  const { positions, indices, groups } = chunk.geometry;
  let area = 0;
  for (const group of groups) {
    if (group.materialIndex !== 1) continue;
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const a = indices[i]! * 3;
      const b = indices[i + 1]! * 3;
      const c = indices[i + 2]! * 3;
      const ab: FractureVec3 = [positions[b]! - positions[a]!, positions[b + 1]! - positions[a + 1]!, positions[b + 2]! - positions[a + 2]!];
      const ac: FractureVec3 = [positions[c]! - positions[a]!, positions[c + 1]! - positions[a + 1]!, positions[c + 2]! - positions[a + 2]!];
      area += Math.hypot(...cross(ab, ac)) / 2;
    }
  }
  return area;
}

function consistent(result: FractureBakeResult): void {
  const areas = result.chunks.map(() => 0);
  for (const link of result.links) {
    areas[link.a]! += link.area;
    areas[link.b]! += link.area;
  }
  for (const [index, chunk] of result.chunks.entries()) {
    const area = interiorArea(chunk);
    close(areas[index]!, area, area * 1e-6);
  }
}

function connected(result: FractureBakeResult): void {
  let previous: FractureLink | undefined;
  for (const link of result.links) {
    assert.ok(link.a >= 0 && link.a < link.b && link.b < result.chunks.length);
    assert.ok(Number.isFinite(link.area) && link.area > 0);
    if (previous) assert.ok(previous.a < link.a || (previous.a === link.a && previous.b < link.b));
    previous = link;
  }
  for (let i = 0; i < result.chunks.length; i += 1) {
    assert.ok(result.links.some(({ a, b }) => a === i || b === i), `chunk ${i} has no link`);
  }
  const present = result.chunks.map(() => true);
  const anchored = result.chunks.map((_, i) => i === 0);
  assert.deepEqual(supportIslands(result.chunks.length, result.links, anchored, present),
    { supported: present, islands: [] });
}

/** Registers pure support graph, anchor region and damage selection regression checks. */
export function registerFractureSupportTests(check: (label: string, fn: () => void) => void): void {
  check("fracture support: clipping preserves neighbor metadata and true face area", () => {
    const planes = voronoiCellPlanes([[0, 0, 0], [2, 0, 0], [0, 0, 0], [0, 4, 0]], 0);
    assert.deepEqual(planes.map((plane) => plane.neighbor), [1, 3]);
    const source = polyhedronFromMesh(box([1, 1, 1]));
    assert.ok(source.faces.every((face) => !Object.hasOwn(face, "neighbor")));
    const cut = clipPolyhedron(source, { normal: [1, 0, 0], offset: 0, neighbor: 0 },
      { epsilon: 1e-9, interiorUvScale: 1 })!;
    const cap = cut.faces.find((face) => face.interior)!;
    assert.equal(cap.neighbor, 0);
    close(faceArea(cap.vertices), 1);
    close(faceArea([]), 0);
    close(faceArea(cap.vertices.slice(0, 2)), 0);
    const trimmed = clipPolyhedron(cut, { normal: [0, 1, 0], offset: 0 },
      { epsilon: 1e-9, interiorUvScale: 1 })!;
    close(faceArea(trimmed.faces.find((face) => face.neighbor === 0)!.vertices), 0.5);
    assert.ok(trimmed.faces.filter((face) => face.neighbor !== 0).every((face) => !Object.hasOwn(face, "neighbor")));
  });

  check("fracture support: 16-cell box links are ordered unique connected and conserve cut area", () => {
    const result = bakeFracture(box(), { seed: 42, cellCount: 16, totalMass: 6 });
    assert.equal(result.chunks.length, 16);
    connected(result);
    consistent(result);
  });

  check("fracture support: two cells share exactly one link matching both interior areas", () => {
    const result = bakeFracture(box(), { seed: 42, cellCount: 2, totalMass: 6 });
    assert.equal(result.links.length, 1);
    const [link] = result.links;
    assert.equal(link!.a, 0);
    assert.equal(link!.b, 1);
    for (const chunk of result.chunks) close(link!.area, interiorArea(chunk), link!.area * 1e-6);
    const single = bakeFracture(box(), { seed: 42, cellCount: 1, totalMass: 6 });
    assert.deepEqual(single.links, []);
  });

  check("fracture support: links are deterministic and consistent for splinters and merged cells", () => {
    const mesh = box();
    const options = { seed: 42, cellCount: 16, totalMass: 6 };
    assert.deepEqual(bakeFracture(mesh, options).links, bakeFracture(mesh, options).links);
    const grain = { axis: 1, stretch: 8 } as const;
    const splinter = bakeFracture(mesh, { ...options, grain });
    assert.deepEqual(splinter.links, bakeFracture(mesh, { ...options, grain }).links);
    connected(splinter);
    consistent(splinter);
    const merged = bakeFracture(mesh, { ...options, minChunkVolumeFraction: 0.05 });
    assert.ok(merged.mergedCells > 0);
    connected(merged);
    consistent(merged);
  });

  check("fracture support: support islands respect anchors absent chunks and invalid links", () => {
    const chain: FractureLink[] = [
      { a: 2, b: 3, area: 1 }, { a: 1, b: 2, area: 1 }, { a: 0, b: 1, area: 1 },
    ];
    const present = [true, false, true, true];
    assert.deepEqual(supportIslands(4, chain, [true, false, false, false], present),
      { supported: [true, false, false, false], islands: [[2, 3]] });
    assert.deepEqual(supportIslands(4, chain, [true, false, false, true], present),
      { supported: [true, false, true, true], islands: [] });
    assert.deepEqual(supportIslands(4, chain, [], present),
      { supported: [false, false, false, false], islands: [[0], [2, 3]] });
    assert.deepEqual(supportIslands(4, chain, [false, true, false, false], present),
      { supported: [false, false, false, false], islands: [[0], [2, 3]] });
    const invalid = [...chain, { a: -1, b: 2, area: 1 }, { a: 0, b: 4, area: 1 }, { a: 0.5, b: 2, area: 1 }];
    assert.deepEqual(supportIslands(4, invalid, [true], present), supportIslands(4, chain, [true], present));
    assert.deepEqual(supportIslands(0, invalid, [], []), { supported: [], islands: [] });
    const scrambled = [{ a: 4, b: 1, area: 1 }, { a: 0, b: 3, area: 1 }, { a: 3, b: 2, area: 1 }];
    assert.deepEqual(supportIslands(5, scrambled, [], [true, true, true, true, true]).islands, [[0, 2, 3], [1, 4]]);
  });

  check("fracture support: bottom slabs anchor real hull bounds including the floor", () => {
    const mesh = box([1, 1, 1]);
    for (let i = 1; i < mesh.positions.length; i += 3) mesh.positions[i]! += 0.5;
    const bounds = meshBounds(mesh);
    const result = bakeFracture(mesh, { seed: 42, cellCount: 16, totalMass: 1 });
    const minY = result.chunks.map((chunk) => Math.min(...chunk.hull.map((point) => point[1] + chunk.pivot[1])));
    for (const fraction of [0.2, 0]) {
      const actual = anchoredChunks(result.chunks, [bottomAnchorBox(bounds, fraction)]);
      assert.deepEqual(actual, minY.map((value) => value <= fraction + 1e-9));
      assert.ok(actual.some(Boolean));
      assert.ok(actual.some((value) => !value));
    }
    assert.deepEqual(anchoredChunks(result.chunks, []), result.chunks.map(() => false));
    assert.deepEqual(anchoredChunks([{ pivot: [0, 0, 0], hull: [] }], [bounds]), [false]);
    const pointChunk = [{ pivot: [2, 3, 4] as const, hull: [[0, 0, 0] as const] }];
    assert.deepEqual(anchoredChunks(pointChunk, [{ min: [0, 0, 0], max: [2 - 0.5e-9, 3, 4] }]), [true]);
    assert.deepEqual(anchoredChunks(pointChunk, [{ min: [0, 0, 0], max: [2 - 2e-9, 3, 4] }]), [false]);
    assert.deepEqual(anchoredChunks(pointChunk, [{ min: [0, 0, 0], max: [1, 1, 1] }, { min: [2, 3, 4], max: [3, 4, 5] }]), [true]);
    for (const axis of [0, 1, 2] as const) {
      const slab = bottomAnchorBox(bounds, 0.2, axis);
      for (const other of [0, 1, 2] as const) {
        close(slab.min[other], bounds.min[other] - Math.sqrt(3) * 0.01);
        close(slab.max[other], other === axis ? bounds.min[axis] + 0.2 : bounds.max[other] + Math.sqrt(3) * 0.01);
      }
      assert.deepEqual(bottomAnchorBox(bounds, -1, axis), bottomAnchorBox(bounds, 0, axis));
      assert.deepEqual(bottomAnchorBox(bounds, 2, axis), bottomAnchorBox(bounds, 1, axis));
    }
  });

  check("fracture support: radius selection includes boundaries excludes absent and falls back deterministically", () => {
    const positions: FractureVec3[] = [[0, 0, 0], [1, 0, 0], [0, 0.5, 0], [0, 0, 2], [-1, 0, 0]];
    const center: FractureVec3 = [0, 0, 0];
    assert.deepEqual(chunksInRadius(positions, [true, true, true, true, true], center, 1), [0, 1, 2, 4]);
    assert.deepEqual(chunksInRadius(positions, [false, true, false, true, true], center, 0.1), [1]);
    assert.deepEqual(chunksInRadius(positions, [false, true, true, true, true], center, 0.1), [2]);
    assert.deepEqual(chunksInRadius(positions, [], center, 5), []);
    for (const radius of [-1, NaN, Infinity, -Infinity, 0]) {
      assert.deepEqual(chunksInRadius(positions, [true, true, true, true, true], center, radius), [0]);
      assert.deepEqual(chunksInRadius(positions, [false, true, true, true, true], center, radius), [2]);
    }
  });

  check("fracture support: damage radius handles growth clamps negative impulses and non-finite inputs", () => {
    close(damageRadius(2, 0.5, 0, 10), 2);
    close(damageRadius(2, 0.5, 4, 10), 4);
    close(damageRadius(2, 0.5, 100, 10), 10);
    close(damageRadius(2, 0.5, -100, 10), 2);
    close(damageRadius(-2, 0, 10, 10), 0);
    close(damageRadius(2, -1, 10, 10), 0);
    close(damageRadius(2, 1, 10, -1), 0);
    for (const value of [NaN, Infinity, -Infinity]) {
      close(damageRadius(value, 0.5, 4, 10), 2);
      close(damageRadius(2, value, 4, 10), 2);
      close(damageRadius(2, 0.5, value, 10), 2);
      close(damageRadius(2, 0.5, 100, value), 52);
    }
  });

  check("fracture support: a hit releases the radius then the islands it cut off, and a second hit collapses the rest", () => {
    // Column 0-1-2-3-4 standing on anchored 0, with 4 also braced by 2.
    const positions: FractureVec3[] = [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0], [1, 3, 0]];
    const links: FractureLink[] = [{ a: 0, b: 1, area: 1 }, { a: 1, b: 2, area: 1 }, { a: 2, b: 3, area: 1 }, { a: 3, b: 4, area: 1 }];
    const anchored = [true, false, false, false, false];
    const present = [true, true, true, true, true];
    assert.deepEqual(releaseSupportHit(positions, links, anchored, present, [1, 3, 0], 0.1), { inRadius: [4], collapsed: [] });
    assert.deepEqual(present, [true, true, true, true, false]);
    assert.deepEqual(releaseSupportHit(positions, links, anchored, present, [0, 1, 0], 0.1), { inRadius: [1], collapsed: [2, 3] });
    assert.deepEqual(present, [true, false, false, false, false]);
    // Nothing anchored: the whole remainder is one island.
    const free = [true, true, true, true, true];
    assert.deepEqual(releaseSupportHit(positions, links, [], free, [0, 0, 0], 0.1), { inRadius: [0], collapsed: [1, 2, 3, 4] });
  });
}
