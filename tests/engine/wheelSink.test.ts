import assert from "node:assert/strict";
import {
  BELLY_FULL_OVERLAP, MAX_SINK_RATE, MIN_SINK_REST_LENGTH, SINK_CLEARANCE_MARGIN,
  bellyDragImpulse, digTargetDepth, slewSinkDepth, tractionSlip, wheelFootprintDepth, wheelSinkLimit,
} from "../../engine/physics/surface/wheelSink";

type Check = (label: string, fn: () => void) => void;
const close = (actual: number, expected: number, epsilon = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

/** TERRAIN_DEFORMATION Faz 3: pure suspension sink, belly drag, traction and tyre footprint checks. */
export function registerWheelSinkTests(check: Check): void {
  check("wheel sink: slew limits sinking and recovery and arrives exactly without overshooting", () => {
    close(slewSinkDepth(0.1, 0.3, 0.1), 0.1 + MAX_SINK_RATE * 0.1);
    close(slewSinkDepth(0.3, 0.1, 0.1), 0.3 - MAX_SINK_RATE * 0.1);
    assert.equal(slewSinkDepth(0.1, 0.12, 1), 0.12);
    assert.equal(slewSinkDepth(0.12, 0.1, 1), 0.1);
    assert.equal(slewSinkDepth(0.12, 0.12, 1), 0.12);
    close(slewSinkDepth(0, 1, 0.5, 0.1), 0.05);
  });

  check("wheel sink: slew guards invalid inputs and never returns a negative depth", () => {
    for (const dt of [0, -1, NaN, Infinity, -Infinity]) assert.equal(slewSinkDepth(0.2, 0.3, dt), 0.2);
    for (const previous of [-1, NaN, Infinity, -Infinity]) {
      assert.equal(slewSinkDepth(previous, 0.2, 0), 0);
      close(slewSinkDepth(previous, 0.2, 0.1), 0.03);
    }
    for (const target of [-1, NaN, Infinity, -Infinity]) {
      close(slewSinkDepth(0.2, target, 0.1), 0.17);
      assert.equal(slewSinkDepth(0.2, target, 10), 0);
    }
    for (const rate of [0, -1, NaN, Infinity]) assert.equal(slewSinkDepth(0.2, 0.3, 1, rate), 0.2);
  });

  check("wheel sink: GAZ-52 and car suspension bounds compete with chassis clearance", () => {
    const truck = { position: [0, 0.83, 0] as const, radius: 0.537, suspensionRestLength: 0.35 };
    const bottom = 1.53 - 2.14 / 2;
    close(bottom, 0.46);
    const clearance = bottom - (0.83 - 0.35 - 0.537);
    close(clearance, 0.517);
    close(clearance - SINK_CLEARANCE_MARGIN, 0.467);
    close(wheelSinkLimit(truck, bottom), 0.3);
    close(wheelSinkLimit(truck, bottom), 0.35 - MIN_SINK_REST_LENGTH);
    // A larger clearance margin makes the clearance bound win for the same GAZ-52 geometry.
    close(wheelSinkLimit(truck, bottom, 0.25), clearance - 0.25);
    const car = { position: [0, 0.3, 0] as const, radius: 0.3, suspensionRestLength: 0.15 };
    close(wheelSinkLimit(car, 0.05), 0.15 - MIN_SINK_REST_LENGTH);
    close(wheelSinkLimit(car, 0.05, 0.15, 0.02), 0.05);
    assert.equal(wheelSinkLimit(car, -0.2), 0);
    assert.equal(wheelSinkLimit({ ...car, suspensionRestLength: 0.02 }, 0.05), 0);
  });

  check("wheel sink: sink limit rejects non-finite wheel geometry and clearance settings", () => {
    const wheel = { position: [0, 0.3, 0] as const, radius: 0.3, suspensionRestLength: 0.15 };
    for (const invalid of [NaN, Infinity, -Infinity]) {
      assert.equal(wheelSinkLimit({ ...wheel, position: [invalid, 0.3, 0] }, 0.05), 0);
      assert.equal(wheelSinkLimit({ ...wheel, position: [0, invalid, 0] }, 0.05), 0);
      assert.equal(wheelSinkLimit({ ...wheel, position: [0, 0.3, invalid] }, 0.05), 0);
      assert.equal(wheelSinkLimit({ ...wheel, radius: invalid }, 0.05), 0);
      assert.equal(wheelSinkLimit({ ...wheel, suspensionRestLength: invalid }, 0.05), 0);
      assert.equal(wheelSinkLimit(wheel, invalid), 0);
      assert.equal(wheelSinkLimit(wheel, 0.05, invalid), 0);
      assert.equal(wheelSinkLimit(wheel, 0.05, 0.05, invalid), 0);
    }
  });

  check("wheel sink: belly drag opposes horizontal velocity, leaves y alone and scales with time", () => {
    const impulse = bellyDragImpulse([3, 17, -4], BELLY_FULL_OVERLAP, 0.6, 1000, 0.1);
    const magnitude = 0.6 * 1000 * 9.81 * 0.1;
    close(impulse[0], -magnitude * 3 / 5);
    assert.equal(impulse[1], 0);
    close(impulse[2], magnitude * 4 / 5);
    const shorter = bellyDragImpulse([3, -9, -4], BELLY_FULL_OVERLAP, 0.6, 1000, 0.05);
    close(Math.hypot(...shorter), magnitude / 2);
  });

  check("wheel sink: belly drag ramps linearly with overlap and speed below one metre per second", () => {
    const magnitude = (speed: number, overlap: number) => Math.hypot(...bellyDragImpulse([speed, 0, 0], overlap, 0.2, 1000, 0.01));
    const full = magnitude(1, BELLY_FULL_OVERLAP);
    close(magnitude(1, BELLY_FULL_OVERLAP / 2), full / 2);
    close(magnitude(0.5, BELLY_FULL_OVERLAP), full / 2);
    close(magnitude(0.25, BELLY_FULL_OVERLAP / 2), full / 8);
    close(magnitude(2, BELLY_FULL_OVERLAP * 2), full);
  });

  check("wheel sink: belly drag caps the impulse at momentum so a physics slice never reverses motion", () => {
    const velocity = [-0.3, 4, 0.4] as const;
    const mass = 1000;
    const impulse = bellyDragImpulse(velocity, 1, 1e6, mass, 100);
    close(Math.hypot(...impulse), mass * 0.5);
    close(velocity[0] + impulse[0] / mass, 0);
    close(velocity[2] + impulse[2] / mass, 0);
    assert.equal(impulse[1], 0);
  });

  check("wheel sink: belly drag returns zero without overlap, motion, time, mass or resistance", () => {
    assert.deepEqual(bellyDragImpulse([0, 8, 0], 0.1, 0.6, 1000, 0.1), [0, 0, 0]);
    for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
      assert.deepEqual(bellyDragImpulse([1, 0, 1], invalid, 0.6, 1000, 0.1), [0, 0, 0]);
      assert.deepEqual(bellyDragImpulse([1, 0, 1], 0.1, invalid, 1000, 0.1), [0, 0, 0]);
      assert.deepEqual(bellyDragImpulse([1, 0, 1], 0.1, 0.6, invalid, 0.1), [0, 0, 0]);
      assert.deepEqual(bellyDragImpulse([1, 0, 1], 0.1, 0.6, 1000, invalid), [0, 0, 0]);
    }
    for (const invalid of [NaN, Infinity, -Infinity]) {
      assert.deepEqual(bellyDragImpulse([invalid, 0, 1], 0.1, 0.6, 1000, 0.1), [0, 0, 0]);
      assert.deepEqual(bellyDragImpulse([1, invalid, 1], 0.1, 0.6, 1000, 0.1), [0, 0, 0]);
      assert.deepEqual(bellyDragImpulse([1, 0, invalid], 0.1, 0.6, 1000, 0.1), [0, 0, 0]);
    }
  });

  check("wheel sink: traction slip measures the engine impulse beyond the friction circle", () => {
    // Limit 4000 N x 0.1 s x 0.5 = 200 N s; forward = 1000 N x 0.1 s x 0.5 = 50 N s.
    assert.equal(tractionSlip(1000, 0, 4000, 0.5, 0.1), 0, "inside the circle");
    // Straight-line spin, without any side impulse.
    close(tractionSlip(1000, 0, 500, 0.5, 0.1), 1 - 25 / 50);
    close(tractionSlip(-1000, 0, 500, 0.5, 0.1), 0.5);
    // Cornering shares the circle.
    close(tractionSlip(1000, 120, 2000, 0.5, 0.1), 1 - 100 / 130);
    assert.equal(tractionSlip(1000, 0, 0, 0.5, 0.1), 1, "no load: no grip");
    assert.equal(tractionSlip(0, 120, 500, 0.5, 0.1), 0, "an undriven wheel cannot spin");
    assert.equal(tractionSlip(1000, 0, 500, 0.5, 0), 0);
    for (const invalid of [NaN, Infinity, -Infinity]) {
      assert.equal(tractionSlip(invalid, 0, 500, 0.5, 0.1), 0);
      assert.equal(tractionSlip(1000, invalid, 500, 0.5, 0.1), 0);
      assert.equal(tractionSlip(1000, 0, invalid, 0.5, 0.1), 0);
      assert.equal(tractionSlip(1000, 0, 500, invalid, 0.1), 0);
      assert.equal(tractionSlip(1000, 0, 500, 0.5, invalid), 0);
    }
  });

  check("wheel sink: digging grows with slip and time, reaches the cap and never shallows an existing rut", () => {
    close(digTargetDepth(0.1, 0.5, 0.08, 0.25, 0.22), 0.11);
    close(digTargetDepth(0.1, 2, 0.08, 0.25, 0.22), 0.12);
    assert.equal(digTargetDepth(0.21, 1, 0.08, 1, 0.22), 0.22);
    assert.equal(digTargetDepth(0.3, 1, 0.08, 1, 0.22), 0.3);
    assert.equal(digTargetDepth(0.22, 1, 0.08, 1, 0.22), 0.22);
    for (const current of [-1, NaN, Infinity, -Infinity]) close(digTargetDepth(current, 1, 0.08, 0.5, 0.22), 0.04);
  });

  check("wheel sink: digging holds the sanitised depth on invalid rates, times, caps or slip", () => {
    for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(digTargetDepth(0.1, invalid, 0.08, 1, 0.22), 0.1);
      assert.equal(digTargetDepth(0.1, 1, invalid, 1, 0.22), 0.1);
      assert.equal(digTargetDepth(0.1, 1, 0.08, invalid, 0.22), 0.1);
      assert.equal(digTargetDepth(0.1, 1, 0.08, 1, invalid), 0.1);
      assert.equal(digTargetDepth(invalid, 0, 0.08, 1, 0.22), Number.isFinite(invalid) && invalid > 0 ? invalid : 0);
    }
  });

  check("wheel sink: footprint averages a one-sided rut and heading rotates the axle from X to Z", () => {
    const samples: [number, number][] = [];
    const depthAt = (x: number, z: number) => {
      samples.push([x, z]);
      return x > 10.1 ? 0.3 : 0;
    };
    close(wheelFootprintDepth(depthAt, 10, 20, 0, 2), 0.1);
    assert.deepEqual(samples, [[9.3, 20], [10, 20], [10.7, 20]]);
    samples.length = 0;
    assert.equal(wheelFootprintDepth(depthAt, 10, 20, Math.PI / 2, 2), 0);
    samples.forEach(([x], index) => {
      close(x, 10);
      close(samples[index]![1], [20.7, 20, 19.3][index]!);
    });
    close(wheelFootprintDepth((_x, z) => z < 19.9 ? 0.6 : 0, 10, 20, Math.PI / 2, 2), 0.2);
  });

  check("wheel sink: footprint sanitises samples and samples only the centre for invalid or zero width", () => {
    for (const invalid of [NaN, Infinity, -Infinity, -0.3]) {
      close(wheelFootprintDepth((x) => x < -0.1 ? invalid : 0.3, 0, 0, 0, 1), 0.2);
    }
    for (const width of [-1, 0, NaN, Infinity, -Infinity]) {
      const samples: [number, number][] = [];
      assert.equal(wheelFootprintDepth((x, z) => { samples.push([x, z]); return 0.3; }, 10, 20, 0, width), 0.3);
      assert.deepEqual(samples, [[10, 20]]);
    }
    assert.equal(wheelFootprintDepth(() => -1, 0, 0, 0, 1), 0);
    assert.equal(wheelFootprintDepth(() => NaN, 0, 0, 0, 1), 0);
    for (const invalid of [NaN, Infinity, -Infinity]) {
      const unexpected = () => { assert.fail("invalid contact or heading must not sample the field"); };
      assert.equal(wheelFootprintDepth(unexpected, invalid, 0, 0, 1), 0);
      assert.equal(wheelFootprintDepth(unexpected, 0, invalid, 0, 1), 0);
      assert.equal(wheelFootprintDepth(unexpected, 0, 0, invalid, 1), 0);
    }
  });
}
