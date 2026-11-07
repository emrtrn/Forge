import assert from "node:assert/strict";
import { createMacroRelief, type MacroReliefOptions } from "../../engine/worldbuilder/macroRelief";

export async function registerMacroReliefTests(check: (label: string, fn: () => Promise<void>) => Promise<void>) {
  const base = (): MacroReliefOptions => ({
    seed: 42, amplitude: 300, lift: 40, wavelength: 600, directionDegrees: 0, spurStretch: 0.55,
    bounds: { min: [-1100, -1100], max: [1100, 1100] }, edgeFade: 50,
    protections: [
      { id: "river", sources: [{ kind: "polyline", points: [[-300, -1100], [-300, 1100]] }], inner: 22, falloff: 140 },
      // A village of single houses: one smooth outline, not a chain of circles.
      { id: "village", sources: [[100, 0], [140, 30], [180, -20], [120, -60]].map(([x, z]) => ({ kind: "point" as const, position: [x!, z!] as [number, number], radius: 8 })),
        inner: 45, falloff: 320, blur: 48 },
    ],
  });

  await check("macro relief: determinism, seed and caller-owned snapshot", async () => {
    const config = base();
    const first = createMacroRelief(config), second = createMacroRelief(config);
    for (let z = -1000; z <= 1000; z += 37) {
      // Neighbour tiles evaluate a shared world-space edge without a local seed/phase.
      assert.equal(first.displacementAt(700, z), second.displacementAt(700, z));
    }
    const at = first.displacementAt(800, 600);
    assert.ok(at > 0);
    assert.notEqual(at, createMacroRelief({ ...base(), seed: 43 }).displacementAt(800, 600));
    config.protections[0]!.inner = 900;
    assert.equal(first.displacementAt(800, 600), at, "factory snapshots caller-owned data");
  });

  await check("macro relief: protections hold their ground, bounds and range", async () => {
    const relief = createMacroRelief(base());
    for (let z = -1000; z <= 1000; z += 13) {
      // Exact zero at least one mask cell (8 m) inside `inner`.
      for (const x of [-314, -300, -286]) assert.equal(relief.displacementAt(x, z), 0, `river at ${x},${z}`);
    }
    // Every house and the ground between them, within the village band.
    for (let x = 60; x <= 220; x += 4) {
      for (let z = -90; z <= 60; z += 4) {
        const near = [[100, 0], [140, 30], [180, -20], [120, -60]].some(([hx, hz]) => Math.hypot(x - hx!, z - hz!) <= 8 + 45 - 8);
        if (near) assert.equal(relief.displacementAt(x, z), 0, `village at ${x},${z}`);
      }
    }
    assert.equal(relief.displacementAt(1101, 0), 0);
    assert.equal(relief.displacementAt(-1100, 0), 0);
    assert.ok(relief.weightAt(-200, 500) > 0 && relief.weightAt(-200, 500) < 1, "rises across the falloff");
    let peak = 0;
    for (let x = -1000; x <= 1000; x += 23) for (let z = -1000; z <= 1000; z += 23) {
      const value = relief.displacementAt(x, z);
      assert.ok(value >= 0 && value <= 340 + 1e-9, `range at ${x},${z}`);
      peak = Math.max(peak, value);
    }
    assert.ok(peak > 150, `mountains rise (peak ${peak.toFixed(1)} m)`);
  });

  await check("macro relief: spurStretch lengthens crests along directionDegrees", async () => {
    // Mean slope along the crest direction is gentler than across it.
    const meanSlope = (degrees: number, along: [number, number]) => {
      const relief = createMacroRelief({ ...base(), protections: [], directionDegrees: degrees, lift: 0 });
      let sum = 0, count = 0;
      for (let x = -900; x <= 900; x += 31) for (let z = -900; z <= 900; z += 31) {
        sum += Math.abs(relief.displacementAt(x + along[0], z + along[1]) - relief.displacementAt(x - along[0], z - along[1]));
        count += 1;
      }
      return sum / count;
    };
    assert.ok(meanSlope(0, [4, 0]) < meanSlope(0, [0, 4]) * 0.8, "crests along +X");
    assert.ok(meanSlope(90, [0, 4]) < meanSlope(90, [4, 0]) * 0.8, "crests along +Z");
  });

  await check("macro relief: invalid parameters are rejected", async () => {
    const relief = createMacroRelief(base());
    assert.throws(() => createMacroRelief({ ...base(), wavelength: 0 }));
    assert.throws(() => createMacroRelief({ ...base(), amplitude: Infinity }));
    assert.throws(() => createMacroRelief({ ...base(), seed: 0.5 }));
    assert.throws(() => createMacroRelief({ ...base(), edgeFade: 0 }));
    assert.throws(() => createMacroRelief({ ...base(), octaves: 0 }));
    assert.throws(() => createMacroRelief({ ...base(), gain: 1 }));
    assert.throws(() => createMacroRelief({ ...base(), spurStretch: 1.5 }));
    assert.throws(() => createMacroRelief({ ...base(), protections: [{ id: "bad", sources: [{ kind: "point", position: [NaN, 0] }], inner: 1, falloff: 1 }] }));
    assert.throws(() => createMacroRelief({ ...base(), protections: [{ id: "empty", sources: [], inner: 1, falloff: 1 }] }));
    assert.throws(() => createMacroRelief({ ...base(), protections: [{ id: "neg", sources: [{ kind: "point", position: [0, 0] }], inner: -1, falloff: 1 }] }));
    assert.throws(() => relief.displacementAt(NaN, 0));
  });
}
