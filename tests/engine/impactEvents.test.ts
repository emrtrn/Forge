import assert from "node:assert/strict";
import {
  ImpactAccumulator, forceToImpulse, impulseToForceThreshold, manifoldNormal,
  restingImpulseFloor, weightedContactPoint,
  type ImpactSample, type ImpactVec3,
} from "../../engine/physics/impactEvents";

type Check = (label: string, fn: () => void) => void;

const step = 1 / 60;
const close = (actual: number, expected: number, epsilon = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const close3 = (actual: ImpactVec3 | null, expected: ImpactVec3, epsilon = 1e-9): void => {
  assert.ok(actual, "expected a vector");
  for (let axis = 0; axis < 3; axis += 1) close(actual[axis]!, expected[axis]!, epsilon);
};
const sample = (patch: Partial<ImpactSample> = {}): ImpactSample => ({
  a: "crate", b: "floor", impulse: 10, normal: [0, -1, 0],
  points: [{ point: [0, 0, 0], weight: 1 }], relativeSpeed: 3, ...patch,
});

export function registerImpactEventTests(check: Check): void {
  check("impact: force and impulse thresholds convert through the slice length", () => {
    close(forceToImpulse(6000, step), 100);
    close(impulseToForceThreshold(100, step), 6000);
    close(forceToImpulse(impulseToForceThreshold(37.5, step), step), 37.5);
    assert.equal(impulseToForceThreshold(10, 0), Number.POSITIVE_INFINITY);
    // Faz 0: 10 kg resting at 60 Hz presses ≈1.6 N·s per slice; the floor is 4×.
    close(restingImpulseFloor(10, step), 4 * 10 * 9.81 / 60);
    assert.equal(restingImpulseFloor(-1, step), 0);
  });

  check("impact: manifold normal follows the flipped flag without -0", () => {
    assert.deepEqual(manifoldNormal([0, 1, 0], false), [0, 1, 0]);
    assert.deepEqual(manifoldNormal([0, 1, 0], true), [0, -1, 0]);
    assert.deepEqual(manifoldNormal([0.6, 0, -0.8], true), [-0.6, 0, 0.8]);
  });

  check("impact: contact point is impulse-weighted, speculative points only as a fallback", () => {
    close3(weightedContactPoint([
      { point: [0, 0, 0], weight: 3 },
      { point: [4, 0, 0], weight: 1 },
      { point: [100, 100, 100], weight: 0 },
    ]), [1, 0, 0]);
    close3(weightedContactPoint([
      { point: [0, 2, 0], weight: 0 },
      { point: [2, 0, 0], weight: 0 },
    ]), [1, 1, 0]);
    close3(weightedContactPoint([
      { point: [Number.NaN, 0, 0], weight: 5 },
      { point: [1, 1, 1], weight: 1 },
    ]), [1, 1, 1]);
    assert.equal(weightedContactPoint([]), null);
  });

  check("impact: slices of one frame merge into one impact per pair", () => {
    const accumulator = new ImpactAccumulator();
    accumulator.add(sample({ impulse: 30, points: [{ point: [0, 0, 0], weight: 1 }], relativeSpeed: 3 }));
    accumulator.add(sample({ impulse: 10, points: [{ point: [4, 0, 0], weight: 1 }], relativeSpeed: 1 }));
    const frame = accumulator.takeFrame();
    assert.equal(frame.overBudget, 0);
    assert.equal(frame.impacts.length, 1);
    const [impact] = frame.impacts;
    assert.ok(impact);
    assert.equal(impact.a, "crate");
    assert.equal(impact.b, "floor");
    close(impact.impulse, 40);
    close3(impact.point, [1, 0, 0]);
    close3(impact.normal, [0, -1, 0]);
    assert.equal(impact.relativeSpeed, 3);
    assert.deepEqual(accumulator.takeFrame().impacts, [], "a frame starts empty");
  });

  check("impact: pairs are ordered by id and the normal turns with the swap", () => {
    const accumulator = new ImpactAccumulator();
    // floor → crate seen from the floor: normal out of the floor is +Y.
    accumulator.add(sample({ a: "floor", b: "crate", normal: [0, 1, 0], impulse: 5 }));
    accumulator.add(sample({ a: "crate", b: "floor", normal: [0, -1, 0], impulse: 5 }));
    const { impacts } = accumulator.takeFrame();
    assert.equal(impacts.length, 1);
    assert.equal(impacts[0]?.a, "crate");
    close3(impacts[0]?.normal ?? null, [0, -1, 0]);
    close(impacts[0]?.impulse ?? 0, 10);
  });

  check("impact: weighted normal is unit length; cancelling slices fall back to the strongest", () => {
    const accumulator = new ImpactAccumulator();
    accumulator.add(sample({ normal: [1, 0, 0], impulse: 1 }));
    accumulator.add(sample({ normal: [0, 1, 0], impulse: 1 }));
    close3(accumulator.takeFrame().impacts[0]?.normal ?? null, [Math.SQRT1_2, Math.SQRT1_2, 0]);

    accumulator.add(sample({ normal: [1, 0, 0], impulse: 2 }));
    accumulator.add(sample({ normal: [-1, 0, 0], impulse: 2 }));
    close3(accumulator.takeFrame().impacts[0]?.normal ?? null, [1, 0, 0]);
  });

  check("impact: a pair with no manifold points reports a null point", () => {
    const accumulator = new ImpactAccumulator();
    accumulator.add(sample({ points: [] }));
    const [impact] = accumulator.takeFrame().impacts;
    assert.equal(impact?.point, null);
    close(impact?.impulse ?? 0, 10);
  });

  check("impact: noise below the floor and invalid samples produce no event", () => {
    const accumulator = new ImpactAccumulator({ minImpulse: 5 });
    accumulator.add(sample({ a: "a", b: "b", impulse: 2 }));
    accumulator.add(sample({ a: "a", b: "b", impulse: 2 }));
    accumulator.add(sample({ a: "c", b: "c", impulse: 50 }));
    accumulator.add(sample({ a: "d", b: "e", impulse: 0 }));
    accumulator.add(sample({ a: "d", b: "e", impulse: Number.NaN }));
    accumulator.add(sample({ a: "f", b: "g", impulse: -20 }));
    assert.deepEqual(accumulator.takeFrame(), { impacts: [], overBudget: 0 });

    // Sub-floor slices that add up above the floor within a frame do report.
    accumulator.add(sample({ a: "a", b: "b", impulse: 3 }));
    accumulator.add(sample({ a: "a", b: "b", impulse: 3 }));
    close(accumulator.takeFrame().impacts[0]?.impulse ?? 0, 6);
  });

  check("impact: the per-frame budget keeps the strongest pairs in pair order", () => {
    const accumulator = new ImpactAccumulator({ maxImpactsPerFrame: 2 });
    accumulator.add(sample({ a: "p1", b: "z", impulse: 5 }));
    accumulator.add(sample({ a: "p2", b: "z", impulse: 50 }));
    accumulator.add(sample({ a: "p3", b: "z", impulse: 20 }));
    accumulator.add(sample({ a: "p4", b: "z", impulse: 20 }));
    const frame = accumulator.takeFrame();
    assert.deepEqual(frame.impacts.map(({ a }) => a), ["p2", "p3"], "ties break by pair, output sorts by pair");
    assert.equal(frame.overBudget, 2);

    const silent = new ImpactAccumulator({ maxImpactsPerFrame: 0 });
    silent.add(sample());
    assert.deepEqual(silent.takeFrame(), { impacts: [], overBudget: 1 });
  });

  check("impact: insertion order does not change the reported frame", () => {
    const samples = [
      sample({ a: "b", b: "a", impulse: 4, normal: [0, 0, 1] }),
      sample({ a: "c", b: "d", impulse: 7 }),
      sample({ a: "a", b: "b", impulse: 2, normal: [0, 0, -1] }),
    ];
    const forward = new ImpactAccumulator();
    for (const item of samples) forward.add(item);
    const backward = new ImpactAccumulator();
    for (const item of [...samples].reverse()) backward.add(item);
    assert.deepEqual(forward.takeFrame(), backward.takeFrame());
  });

  check("impact: clear drops the pending frame", () => {
    const accumulator = new ImpactAccumulator();
    accumulator.add(sample());
    accumulator.clear();
    assert.deepEqual(accumulator.takeFrame().impacts, []);
  });
}
