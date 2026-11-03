import assert from "node:assert/strict";
import { bakeFracture, type FractureBakeResult } from "../../engine/physics/fracture/fractureBake";
import {
  checkFractureSource, clipPolyhedron, fractureSeeds, meshBounds, polyhedronCentroid,
  polyhedronCorners, polyhedronFromMesh, polyhedronVolume, voronoiCellPlanes,
  type FractureSourceMesh, type FractureVec3,
} from "../../engine/physics/fracture/voronoiFracture";

type Check = (label: string, fn: () => void) => void;
const close = (actual: number, expected: number, epsilon = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected} (epsilon ${epsilon})`);
const close3 = (actual: FractureVec3, expected: FractureVec3, epsilon = 1e-9): void => {
  for (let axis = 0; axis < 3; axis += 1) close(actual[axis]!, expected[axis]!, epsilon);
};
const dot = (a: FractureVec3, b: FractureVec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: FractureVec3, b: FractureVec3): FractureVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: FractureVec3, b: FractureVec3): FractureVec3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const read3 = (values: Float32Array, index: number): FractureVec3 =>
  [values[index * 3]!, values[index * 3 + 1]!, values[index * 3 + 2]!];

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

function rotatedBox(): FractureSourceMesh {
  const source = box();
  const rotate = ([x, y, z]: FractureVec3): FractureVec3 => {
    const c = Math.sqrt(3) / 2;
    const y1 = c * y - 0.5 * z;
    const z1 = 0.5 * y + c * z;
    return [c * x + 0.5 * z1, y1, -0.5 * x + c * z1];
  };
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (const index of source.indices!) {
    positions.push(...rotate(read3(source.positions, index)));
    normals.push(...rotate(read3(source.normals, index)));
    uvs.push(source.uvs![index * 2]!, source.uvs![index * 2 + 1]!);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: null };
}

function lShape(): FractureSourceMesh {
  const polygon = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]] as const;
  const positions: number[] = [];
  const normals: number[] = [];
  const point = (index: number, z: number): FractureVec3 => [polygon[index]![0], polygon[index]![1], z];
  const triangle = (a: FractureVec3, b: FractureVec3, c: FractureVec3): void => {
    positions.push(...a, ...b, ...c);
    const n = cross(sub(b, a), sub(c, a));
    const length = Math.hypot(...n);
    for (let i = 0; i < 3; i += 1) normals.push(n[0] / length, n[1] / length, n[2] / length);
  };
  for (const [a, b, c] of [[0, 1, 3], [1, 2, 3], [0, 3, 5], [3, 4, 5]] as const) {
    triangle(point(a, 0.5), point(b, 0.5), point(c, 0.5));
    triangle(point(c, -0.5), point(b, -0.5), point(a, -0.5));
  }
  for (let i = 0; i < polygon.length; i += 1) {
    const next = (i + 1) % polygon.length;
    triangle(point(i, -0.5), point(next, -0.5), point(next, 0.5));
    triangle(point(i, -0.5), point(next, 0.5), point(i, 0.5));
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: null, indices: null };
}

function random32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function conserve(result: FractureBakeResult, expected: number, mass: number, minimum = 0.002): void {
  close(result.sourceVolume, expected, expected * 1e-6);
  close(result.chunks.reduce((sum, c) => sum + c.volume, 0), expected, expected * 1e-6);
  close(result.chunks.reduce((sum, c) => sum + c.mass, 0), mass, 1e-9);
  assert.equal(result.seeds.length, result.chunks.length);
  for (const [index, chunk] of result.chunks.entries()) {
    assert.equal(chunk.id, `c${index}`);
    assert.ok(chunk.volume >= minimum * result.sourceVolume);
    close(chunk.mass / mass, chunk.volume / result.chunks.reduce((sum, c) => sum + c.volume, 0));
  }
}

function buffers(result: FractureBakeResult): Buffer {
  return Buffer.concat(result.chunks.flatMap(({ geometry }) =>
    [geometry.positions, geometry.normals, geometry.uvs].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength))));
}

/** Registers pure fracture geometry, source validation and bake regression checks. */
export function registerFractureTests(check: Check): void {
  check("fracture: seeds are deterministic, inset, uniformly sampled and focused", () => {
    const bounds = { min: [-2, -3, -4] as const, max: [2, 3, 4] as const };
    const options = { seed: 123, cellCount: 1000, bounds };
    const seeds = fractureSeeds(options);
    assert.equal(seeds.length, 1000);
    assert.deepEqual(seeds, fractureSeeds(options));
    assert.deepEqual(seeds, fractureSeeds({ ...options, seed: 123 + 4294967296 }));
    assert.notDeepEqual(seeds, fractureSeeds({ ...options, seed: 124 }));
    for (const point of seeds) for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(point[axis]! >= bounds.min[axis]! * 0.98 && point[axis]! <= bounds.max[axis]! * 0.98);
    }
    for (let axis = 0; axis < 3; axis += 1) close(seeds.reduce((sum, p) => sum + p[axis]!, 0) / seeds.length, 0, 0.15);
    const focused = fractureSeeds({ ...options, focus: { point: [0, 0, 0], radius: 0.2, share: 0.4 } });
    assert.ok(focused.slice(0, 400).every((p) => Math.hypot(...p) <= 0.2));
    const fraction = focused.filter((p) => Math.hypot(...p) <= 0.2).length / focused.length;
    close(fraction, 0.4, 0.01);
    const clamped = fractureSeeds({ ...options, cellCount: 3, focus: { point: [20, 20, 20], radius: 0.1, share: 1 } });
    assert.deepEqual(clamped, Array.from({ length: 3 }, () => [1.96, 2.94, 3.92]));
  });

  check("fracture: bisectors are outward unit planes in seed order and skip coincidence", () => {
    assert.deepEqual(voronoiCellPlanes([[0, 0, 0], [2, 0, 0], [0, 0, 0], [0, 4, 0]], 0), [
      { normal: [1, 0, 0], offset: 1 }, { normal: [0, 1, 0], offset: 2 },
    ]);
  });

  check("fracture: clipping conserves the kept volume and creates one outward cap", () => {
    const poly = polyhedronFromMesh(box([1, 1, 1]));
    const plane = { normal: [1, 0, 0] as const, offset: 0.25 };
    const clipped = clipPolyhedron(poly, plane, { epsilon: 1e-9, interiorUvScale: 2 });
    assert.ok(clipped);
    close(polyhedronVolume(clipped), 0.75);
    close3(polyhedronCentroid(clipped), [-0.125, 0, 0]);
    const caps = clipped.faces.filter((face) => face.interior);
    assert.equal(caps.length, 1);
    for (const vertex of caps[0]!.vertices) {
      close(vertex.position[0], 0.25);
      close3(vertex.normal, [1, 0, 0]);
      close(vertex.uv[0], vertex.position[1] / 2);
      close(vertex.uv[1], vertex.position[2] / 2);
    }
    for (const face of clipped.faces) for (const vertex of face.vertices) assert.ok(vertex.position[0] <= 0.25 + 1e-9);
    assert.equal(clipPolyhedron(poly, { ...plane, offset: -1 }, { epsilon: 1e-9, interiorUvScale: 1 }), null);
    const unchanged = clipPolyhedron(poly, { ...plane, offset: 1 }, { epsilon: 1e-9, interiorUvScale: 1 });
    assert.ok(unchanged);
    close(polyhedronVolume(unchanged), 1);
    assert.ok(unchanged.faces.every((face) => !face.interior));
    assert.equal(polyhedronCorners(poly, 1e-9).length, 8);
  });

  check("fracture: clipping through source vertices keeps a closed boundary and interpolates attributes", () => {
    const source = box([1, 1, 1]);
    const poly = polyhedronFromMesh(source);
    const plane = { normal: [Math.SQRT1_2, Math.SQRT1_2, 0] as const, offset: 0 };
    const cut = clipPolyhedron(poly, plane, { epsilon: 1e-9, interiorUvScale: 1 });
    assert.ok(cut);
    close(polyhedronVolume(cut), 0.5);
    assert.equal(cut.faces.filter((face) => face.interior).length, 1);
    for (const face of cut.faces.filter((face) => !face.interior)) {
      for (const vertex of face.vertices) {
        const sourceFace = poly.faces.find((candidate) => candidate.vertices.every((v) => dot(v.normal, vertex.normal) > 0.999));
        assert.ok(sourceFace);
        const a = sourceFace.vertices[0]!;
        const b = sourceFace.vertices[1]!;
        const c = sourceFace.vertices[2]!;
        // Original box faces have affine UVs; every retained/crossing vertex must preserve them.
        const u = sub(b.position, a.position);
        const v = sub(c.position, b.position);
        const d = sub(vertex.position, a.position);
        const su = dot(d, u) / dot(u, u);
        const sv = dot(d, v) / dot(v, v);
        close(vertex.uv[0], a.uv[0] + su * (b.uv[0] - a.uv[0]) + sv * (c.uv[0] - b.uv[0]));
        close(vertex.uv[1], a.uv[1] + su * (b.uv[1] - a.uv[1]) + sv * (c.uv[1] - b.uv[1]));
      }
    }
    const varying = clipPolyhedron({ faces: [{ interior: false, vertices: [
      { position: [-1, 0, 0], normal: [1, 0, 0], uv: [0, 0] },
      { position: [1, 0, 0], normal: [0, 1, 0], uv: [1, 0] },
      { position: [-1, 1, 0], normal: [0, 0, 1], uv: [0, 1] },
    ] }] }, { normal: [1, 0, 0], offset: 0 }, { epsilon: 1e-9, interiorUvScale: 1 });
    assert.ok(varying);
    const crossing = varying.faces[0]!.vertices.find((v) => v.position[0] === 0 && v.position[1] === 0);
    assert.ok(crossing);
    close3(crossing.normal, [Math.SQRT1_2, Math.SQRT1_2, 0]);
    assert.deepEqual(crossing.uv, [0.5, 0]);
  });

  check("fracture: 16-cell box conserves volume and mass with valid convex hulls", () => {
    const mesh = box();
    assert.equal(mesh.positions.length / 3, 24);
    const result = bakeFracture(mesh, { seed: 1234, cellCount: 16, totalMass: 37 });
    conserve(result, 1, 37);
    assert.equal(result.chunks.length, 16);
    for (const [index, chunk] of result.chunks.entries()) {
      const planes = voronoiCellPlanes(result.seeds, index);
      assert.ok(chunk.hull.length >= 4);
      const origin = chunk.hull[0]!;
      let noncoplanar = false;
      for (const a of chunk.hull) for (const b of chunk.hull) for (const c of chunk.hull) {
        if (Math.abs(dot(sub(a, origin), cross(sub(b, origin), sub(c, origin)))) > 1e-12) noncoplanar = true;
      }
      assert.ok(noncoplanar);
      for (const point of chunk.hull) {
        const p: FractureVec3 = [point[0] + chunk.pivot[0], point[1] + chunk.pivot[1], point[2] + chunk.pivot[2]];
        for (const plane of planes) assert.ok(dot(plane.normal, p) <= plane.offset + 3e-6);
        for (let axis = 0; axis < 3; axis += 1) assert.ok(Math.abs(p[axis]!) <= [1, 0.5, 0.25][axis]! + 3e-6);
      }
      close3(polyhedronCentroid(polyhedronFromMesh({ ...chunk.geometry, indices: chunk.geometry.indices })), [0, 0, 0], 1e-7);
    }
  });

  check("fracture: 2000 strict-interior box samples belong to exactly one cell", () => {
    const result = bakeFracture(box(), { seed: 1234, cellCount: 16, totalMass: 1 });
    const cells = result.seeds.map((_, i) => voronoiCellPlanes(result.seeds, i));
    const random = random32(5678);
    let sampled = 0;
    while (sampled < 2000) {
      const p: FractureVec3 = [(random() - 0.5) * 1.98, (random() - 0.5) * 0.99, (random() - 0.5) * 0.495];
      if (cells.some((planes) => planes.some((plane) => Math.abs(dot(plane.normal, p) - plane.offset) < 3e-6))) continue;
      assert.equal(cells.filter((planes) => planes.every((plane) => dot(plane.normal, p) < plane.offset)).length, 1);
      sampled += 1;
    }
  });

  check("fracture: geometry indices, material groups and flat normals remain valid", () => {
    const result = bakeFracture(box(), { seed: 1234, cellCount: 16, totalMass: 1 });
    for (const { geometry } of result.chunks) {
      assert.equal(geometry.normals.length, geometry.positions.length);
      assert.equal(geometry.uvs.length, geometry.positions.length / 3 * 2);
      let end = 0;
      let previous = -1;
      for (const group of geometry.groups) {
        assert.equal(group.start, end);
        assert.ok(group.count > 0 && group.count % 3 === 0);
        assert.ok(group.materialIndex > previous);
        previous = group.materialIndex;
        end += group.count;
        for (let i = group.start; i < end; i += 1) {
          const index = geometry.indices[i]!;
          assert.ok(index < geometry.positions.length / 3);
          const n = read3(geometry.normals, index);
          close(Math.hypot(...n), 1, 1e-6);
          if (group.materialIndex === 0) {
            assert.ok([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
              .some((source) => n.every((v, axis) => Math.abs(v - source[axis]!) <= 1e-6)));
          }
        }
      }
      assert.equal(end, geometry.indices.length);
    }
    const single = bakeFracture(box(), { seed: 1, cellCount: 1, totalMass: 1 });
    assert.deepEqual(single.chunks[0]!.geometry.groups, [{ start: 0, count: 36, materialIndex: 0 }]);
  });

  check("fracture: rotated non-indexed source conserves volume and uses box-projected interior UVs", () => {
    const mesh = rotatedBox();
    assert.equal(mesh.indices, null);
    const result = bakeFracture(mesh, { seed: 42, cellCount: 16, totalMass: 12, interiorUvScale: 0.7 });
    conserve(result, polyhedronVolume(polyhedronFromMesh(mesh)), 12);
    let checked = 0;
    for (const chunk of result.chunks) {
      const { geometry, pivot } = chunk;
      assert.ok([...geometry.uvs].every(Number.isFinite));
      for (const group of geometry.groups.filter((g) => g.materialIndex === 1)) {
        for (let i = group.start; i < group.start + group.count; i += 1) {
          const index = geometry.indices[i]!;
          const n = read3(geometry.normals, index);
          const p = read3(geometry.positions, index);
          const dominant = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0
            : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
          const axes = dominant === 0 ? [1, 2] : dominant === 1 ? [0, 2] : [0, 1];
          for (let uv = 0; uv < 2; uv += 1) {
            const axis = axes[uv]!;
            close(geometry.uvs[index * 2 + uv]!, (p[axis]! + pivot[axis]!) / 0.7, 3e-7);
          }
          checked += 1;
        }
      }
    }
    assert.ok(checked > 0);
  });

  check("fracture: repeated bakes deep-equal and Float32 buffers are byte-identical", () => {
    const mesh = rotatedBox();
    const options = { seed: 923, cellCount: 16, totalMass: 18 };
    const before = { positions: mesh.positions.slice(), normals: mesh.normals.slice(), uvs: mesh.uvs!.slice() };
    const a = bakeFracture(mesh, options);
    const b = bakeFracture(mesh, options);
    assert.deepEqual(a, b);
    assert.ok(buffers(a).equals(buffers(b)));
    assert.deepEqual(mesh.positions, before.positions);
    assert.deepEqual(mesh.normals, before.normals);
    assert.deepEqual(mesh.uvs, before.uvs);
  });

  check("fracture: degenerate focused seeds are removed and neighbours absorb their volume", () => {
    const result = bakeFracture(box(), { seed: 1, cellCount: 8, totalMass: 5,
      focus: { point: [0, 0, 0], radius: 1e-4, share: 0.5 } });
    assert.ok(result.mergedCells >= 1);
    assert.equal(result.mergedCells + result.chunks.length, 8);
    conserve(result, 1, 5);
    const original = fractureSeeds({ seed: 1, cellCount: 8, bounds: meshBounds(box()),
      focus: { point: [0, 0, 0], radius: 1e-4, share: 0.5 } });
    const volumes = original.map((_, i) => {
      let cell = polyhedronFromMesh(box());
      for (const plane of voronoiCellPlanes(original, i)) {
        const clipped = clipPolyhedron(cell, plane, { epsilon: 1e-6 * Math.hypot(2, 1, 0.5), interiorUvScale: 1 });
        if (!clipped) return 0;
        cell = clipped;
      }
      return polyhedronVolume(cell);
    });
    const smallest = volumes.indexOf(Math.min(...volumes));
    assert.ok(volumes[smallest]! < 0.002);
    assert.equal(result.mergedCells, 1);
    assert.deepEqual(result.seeds, original.filter((_, i) => i !== smallest));
    // Even an impossible minimum stops at one surviving seed.
    const single = bakeFracture(box(), { seed: 12, cellCount: 4, totalMass: 2, minChunkVolumeFraction: 2 });
    assert.equal(single.mergedCells, 3);
    assert.equal(single.chunks.length, 1);
    close(single.chunks[0]!.volume, 1);
  });

  check("fracture: source checks distinguish closed convex, concave and open meshes", () => {
    const mesh = box();
    assert.deepEqual(checkFractureSource(mesh, 1e-6), { closed: true, convex: true });
    assert.deepEqual(checkFractureSource(rotatedBox(), 1e-6), { closed: true, convex: true });
    assert.deepEqual(checkFractureSource(lShape(), 1e-6), { closed: true, convex: false });
    assert.equal(checkFractureSource({ ...mesh, indices: mesh.indices!.slice(6) }, 1e-6).closed, false);
    for (const invalid of [lShape(), { ...mesh, indices: mesh.indices!.slice(6) }]) {
      const result = bakeFracture(invalid, { seed: 3, cellCount: 4, totalMass: 2 });
      for (const chunk of result.chunks) {
        assert.ok([chunk.volume, chunk.mass, ...chunk.pivot, ...chunk.geometry.positions, ...chunk.geometry.normals,
          ...chunk.geometry.uvs, ...chunk.hull.flat()].every(Number.isFinite));
      }
    }
  });

  check("fracture: invalid cell counts, mass and empty meshes report clear errors", () => {
    const mesh = box();
    for (const cellCount of [0, 2.5]) {
      assert.throws(() => bakeFracture(mesh, { seed: 0, cellCount, totalMass: 1 }), /cellCount.*integer.*1/);
      assert.throws(() => fractureSeeds({ seed: 0, cellCount, bounds: meshBounds(mesh) }), /cellCount.*integer.*1/);
    }
    assert.throws(() => bakeFracture(mesh, { seed: 0, cellCount: 1, totalMass: NaN }), /totalMass.*finite/);
    for (const interiorUvScale of [0, -1, Infinity]) {
      assert.throws(() => bakeFracture(mesh, { seed: 0, cellCount: 1, totalMass: 1, interiorUvScale }), /interiorUvScale/);
    }
    assert.throws(() => bakeFracture({ positions: new Float32Array(), normals: new Float32Array(), uvs: null, indices: null },
      { seed: 0, cellCount: 1, totalMass: 1 }), /at least one triangle/);
  });

  check("fracture: 16-cell box bake median stays under 500 ms", () => {
    const times: number[] = [];
    const mesh = box();
    for (let i = 0; i < 5; i += 1) {
      const start = performance.now();
      bakeFracture(mesh, { seed: 1234, cellCount: 16, totalMass: 1 });
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = times[2]!;
    console.log(`[fracture] 16-cell box bake median ${median.toFixed(3)} ms`);
    assert.ok(median < 500, `bake median ${median} ms exceeds 500 ms`);
  });
}
