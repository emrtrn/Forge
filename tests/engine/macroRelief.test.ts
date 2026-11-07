import assert from "node:assert/strict";
import { createMacroRelief, type MacroReliefOptions } from "../../engine/worldbuilder/macroRelief";

export async function registerMacroReliefTests(check: (label: string, fn: () => Promise<void>) => Promise<void>) {
  await check("macro relief: global determinism, masks, bounds and invalid parameter rejection", async () => {
    const config: MacroReliefOptions = { seed: 42, amplitude: 140, wavelength: 300, directionDegrees: 15,
      bounds: { min: [-1000, -1000], max: [1000, 1000] }, edgeFade: 50,
      protections: [{ id: "river", source: { kind: "polyline", points: [[0, -900], [0, 900]], radii: [25, 25] }, falloff: 100 },
        { id: "site", source: { kind: "point", position: [400, 400], radius: 60 }, falloff: 80 }] };
    const first = createMacroRelief(config), second = createMacroRelief(config);
    for (let z = -900; z <= 900; z += 18) {
      assert.equal(first.displacementAt(0, z), 0);
      // Neighbour tiles evaluate a shared world-space edge without a local seed/phase.
      assert.equal(first.displacementAt(384, z), second.displacementAt(384, z));
      assert.ok(first.displacementAt(384, z) >= 0 && first.displacementAt(384, z) <= config.amplitude);
    }
    assert.equal(first.displacementAt(400, 400), 0);
    assert.equal(first.displacementAt(1001, 0), 0);
    assert.equal(first.displacementAt(-1000, 0), 0);
    const at = first.displacementAt(600, 300);
    assert.ok(at > 0);
    assert.notEqual(at, createMacroRelief({ ...config, seed: 43 }).displacementAt(600, 300));
    config.protections[0]!.falloff = 1000;
    assert.equal(first.displacementAt(600, 300), at, "factory snapshots caller-owned data");
    assert.ok(first.weightAt(25.01, 100) < 1e-6, "smooth transition beside the protected footprint");
    assert.throws(() => createMacroRelief({ ...config, wavelength: 0 }));
    assert.throws(() => createMacroRelief({ ...config, amplitude: Infinity }));
    assert.throws(() => createMacroRelief({ ...config, seed: 0.5 }));
    assert.throws(() => createMacroRelief({ ...config, edgeFade: 0 }));
    assert.throws(() => createMacroRelief({ ...config, protections: [{ id: "bad", source: { kind: "point", position: [NaN, 0] }, falloff: 1 }] }));
    assert.throws(() => first.displacementAt(NaN, 0));
  });
}
