import assert from "node:assert/strict";
import { DEFAULT_TERRAIN_EROSION_SETTINGS, erodeTerrainRegion, type TerrainErosionSettings } from "../../engine/terrain/terrainErosion";

type Check = (label: string, fn: () => void) => void;
const size = 65;
function run(source: Float64Array, patch: Partial<TerrainErosionSettings> = {}, strength = 0.75) {
  return erodeTerrainRegion({ x0: 0, x1: size - 1, z0: 0, z1: size - 1,
    originX: -32, originZ: -32, spacing: 1, x: 0, z: 0, radius: 26, strength, falloff: 1,
    settings: { ...DEFAULT_TERRAIN_EROSION_SETTINGS, ...patch }, sample: (x, z) => source[z * size + x],
  });
}
const total = (heights: Float64Array) => heights.reduce((sum, height) => sum + height, 0);

export function registerTerrainErosionTests(check: Check): void {
  check("terrain erosion Thermal lowers steep peaks, builds foothills and conserves soil", () => {
    const source = Float64Array.from({ length: size * size }, (_, i) => 25 * Math.exp(-((i % size - 32) ** 2 + (Math.floor(i / size) - 32) ** 2) / 12));
    const output = run(source);
    assert.ok(output[32 * size + 32]! < source[32 * size + 32]! - 1);
    assert.ok(output.some((height, i) => height > source[i]! + 0.05), "soil must accumulate below the eroded slope");
    assert.ok(Math.abs(total(output) - total(source)) < 1e-8);
    assert.deepEqual(run(source, { erosionTalus: 89 }), source, "stable slopes stay intact");
  });

  check("terrain erosion Hydraulic transports sediment downhill and creates seeded channel detail", () => {
    const source = Float64Array.from({ length: size * size }, (_, i) => 20 - 0.4 * Math.min(i % size, 40) + 0.2 * Math.sin(Math.floor(i / size) * 0.5));
    const output = run(source, { erosionHydraulic: true });
    assert.ok(output.every(Number.isFinite));
    assert.ok(output.some((height, i) => height < source[i]! - 0.05), "water must erode the slope");
    assert.ok(output.some((height, i) => height > source[i]! + 0.05), "transported soil must settle");
    assert.ok(total(output) <= total(source) + 1e-7, "runoff may remove soil; deposition must not create new soil");
    assert.deepEqual(output, run(source, { erosionHydraulic: true }));
    assert.notDeepEqual(output, run(source, { erosionHydraulic: true, erosionSeed: 2 }));
  });

  check("terrain erosion Thermal stays bounded on pits and checkerboard slopes at maximum iterations", () => {
    const source = Float64Array.from({ length: size * size }, (_, i) => ((i % size + Math.floor(i / size)) % 2) * 100);
    const output = run(source, { erosionIterations: 64, erosionTalus: 0 }, 1);
    assert.ok(output.every((height) => Number.isFinite(height) && height >= 0 && height <= 100));
    assert.ok(Math.abs(total(output) - total(source)) < 1e-7);
  });

  check("terrain erosion does not disturb flat ground or protected vertices; zero strength/rain/capacity are no-ops", () => {
    const flat = new Float64Array(size * size).fill(7);
    assert.deepEqual(run(flat), flat);
    assert.deepEqual(run(flat, { erosionHydraulic: true }), flat);
    const source = Float64Array.from({ length: size * size }, (_, i) => (i % size) * 2);
    assert.deepEqual(run(source, {}, 0), source);
    assert.deepEqual(run(source, { erosionHydraulic: true, erosionRainAmount: 0 }), source);
    assert.deepEqual(run(source, { erosionHydraulic: true, erosionSedimentCapacity: 0 }), source);
    for (const hydraulic of [false, true]) {
      const output = run(source, { erosionHydraulic: hydraulic });
      for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
        if (Math.hypot(x - 32, z - 32) >= 26) assert.equal(output[z * size + x], source[z * size + x]);
      }
    }
  });

  check("terrain erosion handles holes and outer boundaries without writing outside the mask", () => {
    for (const hydraulic of [false, true]) {
      const output = erodeTerrainRegion({ x0: 0, x1: 16, z0: 0, z1: 16, spacing: 1, originX: 0, originZ: 0,
        x: 1, z: 1, radius: 10, strength: 1, falloff: 1, settings: { ...DEFAULT_TERRAIN_EROSION_SETTINGS, erosionHydraulic: hydraulic },
        sample: (x, z) => x >= 5 && x <= 7 && z >= 5 && z <= 7 ? undefined : x * 2 + z,
      });
      for (let z = 0; z <= 16; z++) for (let x = 0; x <= 16; x++) {
        assert.equal(Number.isNaN(output[z * 17 + x]), x >= 5 && x <= 7 && z >= 5 && z <= 7);
      }
    }
  });

  check("terrain erosion validates settings and bounds expensive brush allocations", () => {
    const source = new Float64Array(size * size);
    for (const invalid of [{ erosionIterations: 0 }, { erosionIterations: 65 }, { erosionTalus: NaN },
      { erosionRainAmount: -1 }, { erosionSedimentCapacity: Infinity }, { erosionEvaporation: 2 }, { erosionSeed: -1 }]) {
      assert.throws(() => run(source, invalid), /Invalid terrain erosion settings/);
    }
    assert.throws(() => erodeTerrainRegion({ x0: 0, x1: 1024, z0: 0, z1: 1024, spacing: 0.01, originX: 0, originZ: 0,
      x: 1, z: 1, radius: 10, strength: 1, falloff: 1, settings: DEFAULT_TERRAIN_EROSION_SETTINGS, sample: () => 0,
    }), /reduce Brush Size/);
  });
}
