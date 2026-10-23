import assert from "node:assert/strict";
import {
  DEFORMATION_DEPTH_SCALE, DeformationField, targetDepthForWheel,
  type DeformationDirtyRect, type WheelDeformationStamp,
} from "../../engine/scene/deformationField";

type Check = (label: string, fn: () => void) => void;
const quantum = 1 / DEFORMATION_DEPTH_SCALE;
const close = (actual: number, expected: number, epsilon = quantum): void =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const wheel = (patch: Partial<WheelDeformationStamp> = {}): WheelDeformationStamp => ({
  from: [0.0625, 0.0625], to: [0.0625, 0.0625], width: 0.25, contactLength: 0.25,
  targetDepth: 0.2, compaction: 1, disturbance: 180, ...patch,
});
const covered = (rects: readonly DeformationDirtyRect[], index: number, size: number): boolean =>
  rects.some(({ x, y, width, height }) => index % size >= x && index % size < x + width
    && Math.floor(index / size) >= y && Math.floor(index / size) < y + height);

function assertDirtyCoversChanges(field: DeformationField, mutate: () => void): DeformationDirtyRect[] {
  const beforeDepth = field.depth.slice();
  const beforeTint = field.disturbance.slice();
  mutate();
  const rects = field.takeDirty();
  assert.ok(rects.length <= 4);
  for (const rect of rects) {
    assert.ok(Number.isInteger(rect.x) && Number.isInteger(rect.y));
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0);
    assert.ok(rect.x + rect.width <= field.cellsPerSide && rect.y + rect.height <= field.cellsPerSide);
  }
  let changed = 0;
  for (let index = 0; index < field.depth.length; index += 1) {
    if (field.depth[index] !== beforeDepth[index] || field.disturbance[index] !== beforeTint[index]) {
      changed += 1;
      assert.ok(covered(rects, index, field.cellsPerSide), `dirty region missed texture cell ${index}`);
    }
  }
  assert.ok(changed > 0, "fixture must change cells");
  assert.deepEqual(field.takeDirty(), []);
  return rects;
}

export function registerDeformationFieldTests(check: Check): void {
  check("deformation field: defaults and configurable integral grid", () => {
    const field = new DeformationField();
    assert.equal(field.windowSize, 64);
    assert.equal(field.cellSize, 0.125);
    assert.equal(field.cellsPerSide, 512);
    assert.ok(field.depth instanceof Uint16Array);
    assert.ok(field.disturbance instanceof Uint8Array);
    assert.equal(field.depth.byteLength + field.disturbance.byteLength, 768 * 1024);
    assert.deepEqual(field.stats(), { activeCellCount: 0, maxDepth: 0 });
    assert.deepEqual(field.takeDirty(), [{ x: 0, y: 0, width: 512, height: 512 }]);
    assert.equal(new DeformationField({ windowSize: 3, cellSize: 1 }).cellsPerSide, 3);
    for (const options of [{ windowSize: 0 }, { cellSize: -1 }, { windowSize: NaN },
      { cellSize: Infinity }, { windowSize: 1, cellSize: 0.3 }]) {
      assert.throws(() => new DeformationField(options), RangeError);
    }
  });

  check("deformation field: wheel and disc stamp sample round trip", () => {
    const field = new DeformationField();
    field.stampWheel(wheel());
    assert.deepEqual(field.sample(0.0625, 0.0625), { depth: 0.2, disturbance: 180 });
    field.stampDisc([1.0625, 1.0625], 0.05, 0.35);
    assert.deepEqual(field.sample(1.0625, 1.0625), { depth: 0.35, disturbance: 255 });
    assert.equal(field.depth[0], 2000);
    close(field.stats().maxDepth, 0.35);
    field.stampDisc([1.0625, 1.0625], 0.05, 0.1);
    close(field.sample(1.0625, 1.0625).depth, 0.35);
  });

  check("deformation field: depth is bilinear across both texture seams", () => {
    const field = new DeformationField({ windowSize: 4, cellSize: 1 });
    for (const [x, z, depth] of [[-0.5, -0.5, 0.1], [0.5, -0.5, 0.2], [-0.5, 0.5, 0.3], [0.5, 0.5, 0.4]]) {
      field.stampDisc([x!, z!], 0.1, depth!);
    }
    close(field.sample(0, 0).depth, 0.25);
    close(field.sample(0.25, 0).depth, 0.275);
    close(field.sample(-0.5, -0.5).depth, 0.1);
  });

  check("deformation field: toroidal wrap retains tracks across recenter", () => {
    const field = new DeformationField({ windowSize: 8, cellSize: 1 });
    const depths = field.depth;
    const tint = field.disturbance;
    field.stampDisc([3.5, 0.5], 0.1, 0.3);
    field.stampDisc([-3.5, 0.5], 0.1, 0.5);
    field.recenter(2, 0);
    assert.deepEqual(field.sample(3.5, 0.5), { depth: 0.3, disturbance: 255 });
    assert.deepEqual(field.sample(4.5, 0.5), { depth: 0, disturbance: 0 });
    field.stampDisc([4.5, 0.5], 0.1, 0.4);
    field.recenter(3, 0);
    close(field.sample(4.5, 0.5).depth, 0.4);
    assert.equal(field.depth, depths, "storage identity survives recenter");
    assert.equal(field.disturbance, tint);
    assert.equal(field.stats().activeCellCount, 2);
  });

  check("deformation field: recenter clears only entering cells in every direction", () => {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 3], [-2, 3], [2, -3], [-2, -3]]) {
      const field = new DeformationField({ windowSize: 8, cellSize: 1 });
      field.stampDisc([0, 0], 20, 0.2);
      field.takeDirty();
      field.recenter(dx!, dz!);
      let retained = 0;
      for (let z = dz! - 4; z < dz! + 4; z += 1) {
        for (let x = dx! - 4; x < dx! + 4; x += 1) {
          const old = x >= -4 && x < 4 && z >= -4 && z < 4;
          assert.deepEqual(field.sample(x + 0.5, z + 0.5), { depth: old ? 0.2 : 0, disturbance: old ? 255 : 0 });
          if (old) retained += 1;
        }
      }
      assert.equal(field.stats().activeCellCount, retained);
    }
  });

  check("deformation field: subcell recenter is idle and teleport clears all", () => {
    const field = new DeformationField({ windowSize: 8, cellSize: 1 });
    field.stampDisc([0.5, 0.5], 0.1, 0.3);
    field.takeDirty();
    field.recenter(0.99, 0.99);
    assert.deepEqual(field.takeDirty(), []);
    close(field.sample(0.5, 0.5).depth, 0.3);
    field.recenter(-8, 8);
    assert.deepEqual(field.stats(), { activeCellCount: 0, maxDepth: 0 });
    assert.ok(field.depth.every((depth) => depth === 0));
    assert.ok(field.disturbance.every((tint) => tint === 0));
    assert.deepEqual(field.takeDirty(), [{ x: 0, y: 0, width: 8, height: 8 }]);
    assert.throws(() => field.recenter(Infinity, 0), RangeError);
    assert.throws(() => field.recenter(Number.MAX_VALUE, 0), RangeError);
  });

  check("deformation field: decay visits only active cells and removes recovered cells", () => {
    const field = new DeformationField();
    field.stampDisc([0.0625, 0.0625], 0.02, 0.1);
    field.stampDisc([1.0625, 0.0625], 0.02, 0.2);
    assert.equal(field.stats().activeCellCount, 2);
    assert.equal(field.decay(1, 0), 0);
    assert.equal(field.decay(0.5, 0.1), 2);
    close(field.sample(0.0625, 0.0625).depth, 0.05);
    close(field.sample(1.0625, 0.0625).depth, 0.15);
    assert.equal(field.decay(0.5, 0.1), 2);
    assert.deepEqual(field.sample(0.0625, 0.0625), { depth: 0, disturbance: 0 });
    assert.equal(field.stats().activeCellCount, 1);
    assert.equal(field.decay(1, 0.1), 1);
    assert.deepEqual(field.stats(), { activeCellCount: 0, maxDepth: 0 });
    assert.equal(field.decay(1, 0.1), 0);
  });

  check("deformation field: fractional recovery and disturbance-only cells eventually clear", () => {
    const field = new DeformationField();
    field.stampDisc([0.0625, 0.0625], 0.02, 0.001);
    const active = field.stats().activeCellCount;
    for (let step = 0; step < 100; step += 1) assert.equal(field.decay(0.01, 0.001), active);
    close(field.sample(0.0625, 0.0625).depth, 0, quantum);
    field.decay(0.1, 0.001);
    assert.equal(field.stats().activeCellCount, 0);
    field.stampDisc([0.0625, 0.0625], 0.02, 0, 1, 10);
    assert.equal(field.stats().activeCellCount, 1);
    field.decay(1, 1);
    assert.equal(field.stats().activeCellCount, 0);
    assert.deepEqual(field.sample(0.0625, 0.0625), { depth: 0, disturbance: 0 });
    field.stampDisc([0.0625, 0.0625], 0.02, 0.2);
    field.decay(Number.MAX_VALUE, Number.MAX_VALUE);
    assert.equal(field.stats().activeCellCount, 0);
  });

  check("deformation field: swept wheel has no gaps at 30 metres per second", () => {
    const field = new DeformationField();
    for (let step = 0; step < 20; step += 1) {
      field.stampWheel(wheel({ from: [step * 0.5, 0.0625], to: [(step + 1) * 0.5, 0.0625],
        width: 0.25, contactLength: 0.125 }));
    }
    for (let cell = 0; cell < 80; cell += 1) close(field.sample((cell + 0.5) * 0.125, 0.0625).depth, 0.2);
    assert.equal(field.sample(5, 0.5).depth, 0);
    const compacted = new DeformationField();
    compacted.stampWheel(wheel({ from: [0, 0.0625], to: [10, 0.0625], compaction: 0.25 }));
    for (let cell = 0; cell < 80; cell += 1) {
      close(compacted.sample((cell + 0.5) * 0.125, 0.0625).depth, 0.05);
    }
  });

  check("deformation field: heading rotates footprint independently of sweep direction", () => {
    const field = new DeformationField();
    field.stampWheel(wheel({ from: [0.0625, 0.0625], to: [0.0625, 1.0625],
      width: 0.125, contactLength: 0.75, heading: Math.PI / 2 }));
    close(field.sample(0.3125, 0.5625).depth, 0.2);
    assert.equal(field.sample(0.5625, 0.5625).depth, 0);
    // An oblique rectangle swept sideways: check its whole Minkowski footprint
    // against an independent dense union of intermediate rectangle positions.
    const diagonal = new DeformationField({ windowSize: 4, cellSize: 0.125 });
    const heading = Math.PI / 4;
    diagonal.stampWheel(wheel({ from: [-0.5, 0], to: [0.5, 0], width: 0.3, contactLength: 0.7, heading }));
    for (let z = -8; z < 8; z += 1) {
      for (let x = -8; x < 8; x += 1) {
        const px = (x + 0.5) * 0.125;
        const pz = (z + 0.5) * 0.125;
        let inside = false;
        for (let step = 0; step <= 1000; step += 1) {
          const rx = px - (-0.5 + step / 1000);
          if (Math.abs(rx * Math.cos(heading) - pz * Math.sin(heading)) <= 0.15
            && Math.abs(rx * Math.sin(heading) + pz * Math.cos(heading)) <= 0.35) inside = true;
        }
        assert.equal(diagonal.sample(px, pz).depth > 0, inside, `cell ${x},${z}`);
      }
    }
  });

  check("deformation field: compaction is monotonic and never exceeds the target", () => {
    const field = new DeformationField();
    let previous = 0;
    for (let pass = 0; pass < 40; pass += 1) {
      field.stampWheel(wheel({ compaction: 0.25 }));
      const depth = field.sample(0.0625, 0.0625).depth;
      assert.ok(depth >= previous && depth <= 0.2);
      if (pass === 0) close(depth, 0.05);
      previous = depth;
    }
    close(previous, 0.2, quantum / 0.25);
    field.stampWheel(wheel({ targetDepth: 0.05 }));
    close(field.sample(0.0625, 0.0625).depth, previous);
    const disc = new DeformationField();
    disc.stampDisc([0.0625, 0.0625], 0.02, 0.2, 0.5);
    close(disc.sample(0.0625, 0.0625).depth, 0.1);
    disc.stampDisc([0.0625, 0.0625], 0.02, 0.2, 0.5);
    close(disc.sample(0.0625, 0.0625).depth, 0.15);
  });

  check("deformation field: dirty rectangles cover stamps decay and recenter with wrapping", () => {
    const field = new DeformationField({ windowSize: 8, cellSize: 1 });
    field.takeDirty();
    const rects = assertDirtyCoversChanges(field, () => { field.stampDisc([0, 0], 1, 0.2); });
    assert.equal(rects.length, 4, "both texture seams split a small stamp into four rectangles");
    assert.equal(rects.reduce((sum, rect) => sum + rect.width * rect.height, 0), 4);
    const decayRects = assertDirtyCoversChanges(field, () => { field.decay(0.1, 0.1); });
    assert.equal(decayRects.length, 4);
    assert.equal(decayRects.reduce((sum, rect) => sum + rect.width * rect.height, 0), 4);
    field.stampDisc([0, 0], 20, 0.2);
    field.takeDirty();
    assertDirtyCoversChanges(field, () => { field.recenter(1, -1); });
    // Several operations without taking dirty, including texture-space decay
    // and another world-space stamp, must still cover every changed channel.
    assertDirtyCoversChanges(field, () => {
      field.decay(0.1, 0.1);
      field.stampDisc([4.5, -1.5], 0.1, 0.4);
      field.recenter(2, 1);
    });
  });

  check("deformation field: entering-strip dirty coverage excludes retained cells", () => {
    const field = new DeformationField({ windowSize: 8, cellSize: 1 });
    field.takeDirty();
    field.recenter(1, 0);
    assert.deepEqual(field.takeDirty(), [{ x: 4, y: 0, width: 1, height: 8 }]);
  });

  check("deformation field: outside-window samples and clipped stamps cannot alias", () => {
    const field = new DeformationField({ windowSize: 8, cellSize: 1 });
    field.stampDisc([-3.5, -3.5], 0.1, 0.2);
    field.stampDisc([4.5, 4.5], 0.1, 1);
    assert.deepEqual(field.sample(-3.5, -3.5), { depth: 0.2, disturbance: 255 });
    close(field.sample(-4, -4).depth, 0.2, 0);
    for (const [x, z] of [[4, 0], [0, 4], [-4.001, 0], [0, -4.001], [4.5, 4.5], [NaN, 0], [0, Infinity]]) {
      assert.deepEqual(field.sample(x!, z!), { depth: 0, disturbance: 0 });
    }
    field.stampWheel(wheel({ from: [-1000, 0.5], to: [1000, 0.5], width: 0.5, contactLength: 0.5 }));
    for (let x = -4; x < 4; x += 1) close(field.sample(x + 0.5, 0.5).depth, 0.2);
  });

  check("deformation field: invalid stamp inputs are inert and channels saturate", () => {
    const field = new DeformationField();
    field.takeDirty();
    for (const patch of [{ width: 0 }, { contactLength: -1 }, { heading: NaN }, { compaction: NaN },
      { targetDepth: NaN, disturbance: NaN }]) assert.equal(field.stampWheel(wheel(patch)), 0);
    assert.equal(field.stampDisc([NaN, 0], 1, 1), 0);
    assert.equal(field.stampDisc([0, 0], -1, 1), 0);
    assert.deepEqual(field.takeDirty(), []);
    field.stampWheel(wheel({ targetDepth: Number.MAX_VALUE, disturbance: 1000, compaction: 2 }));
    assert.deepEqual(field.sample(0.0625, 0.0625), { depth: 6.5535, disturbance: 255 });
    assert.equal(field.decay(NaN, 1), 0);
    assert.equal(field.decay(1, -1), 0);
  });

  check("deformation field: wheel target depth clamps participation and load ratio", () => {
    const profile = { maxDepth: 0.22 };
    close(targetDepthForWheel(profile, 0.5, 1500, 3000), 0.055);
    close(targetDepthForWheel(profile, 1, 6000, 3000), 0.22);
    close(targetDepthForWheel(profile, 2, 3000, 3000), 0.22);
    close(targetDepthForWheel(profile, 1, Number.MAX_VALUE, Number.MIN_VALUE), 0.22);
    for (const [deformability, load, nominal] of [[0, 3000, 3000], [-1, 3000, 3000],
      [1, -1, 3000], [1, 3000, 0], [1, NaN, 3000], [NaN, 3000, 3000], [1, 3000, Infinity]]) {
      assert.equal(targetDepthForWheel(profile, deformability!, load!, nominal!), 0);
    }
    assert.equal(targetDepthForWheel(undefined, 1, 3000, 3000), 0);
    assert.equal(targetDepthForWheel({ maxDepth: -1 }, 1, 3000, 3000), 0);
  });

  check("deformation field: four wheels for 600 steps stay within a local cell work budget", () => {
    const field = new DeformationField();
    let visited = 0;
    for (let step = 0; step < 600; step += 1) {
      const z = step * 0.5;
      field.recenter(0, z);
      for (const x of [-0.8, 0.8]) {
        for (const axle of [-1.2, 1.2]) visited += field.stampWheel(wheel({
          from: [x, z + axle], to: [x, z + axle + 0.5], width: 0.25, contactLength: 0.3,
        }));
      }
      field.takeDirty();
    }
    assert.ok(visited > 20_000 && visited < 100_000, `visited ${visited} candidates for 2400 stamps`);
    assert.ok(field.stats().activeCellCount > 0 && field.stats().activeCellCount < 5000);
  });
}
