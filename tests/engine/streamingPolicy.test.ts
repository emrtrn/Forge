/** Pure World Partition range, residency, ordering and frame-budget checks. */
import assert from "node:assert/strict";
import {
  budgetStreamingWork,
  computeStreamingTargets,
  type GridStreamingSettings,
  type StreamingSource,
  type StreamingState,
} from "../../engine/world/streamingPolicy";
import { distanceToWorldCell, parseWorldCellKey, worldCellBounds, type WorldCellBounds } from "../../engine/world/worldGrid";

type Check = (label: string, fn: () => void) => void;

const bounds: WorldCellBounds = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };
const empty = (): StreamingState => ({ loaded: new Set(), active: new Set() });
const source: StreamingSource = { position: [5, 5] };
const settings: GridStreamingSettings = { cellSize: 10, loadRange: 15 };

export function registerStreamingPolicyTests(check: Check): void {
  check("streaming policy: box-distance range edges are inclusive, including corners and negatives", () => {
    for (const { key, range, included } of [
      { key: "2_0", range: 14.999, included: false },
      { key: "2_0", range: 15, included: true },
      { key: "2_0", range: 15.001, included: true },
      { key: "-2_0", range: 15, included: true },
      { key: "1_1", range: Math.sqrt(50) - 0.001, included: false },
      { key: "1_1", range: Math.sqrt(50), included: true },
      { key: "0_0", range: 0, included: true },
      { key: "1_0", range: 0, included: false },
    ]) {
      const targets = computeStreamingTargets(empty(), [source], { ...settings, loadRange: range }, bounds);
      assert.equal(targets.toLoad.includes(key), included, `${key} at ${range}`);
    }
    assert.deepEqual(computeStreamingTargets(empty(), [{ position: [0, 0] }], { ...settings, loadRange: 0 }, bounds).toLoad,
      ["-1_-1", "-1_0", "0_-1", "0_0"]);
  });

  check("streaming policy: prefetch and activation split, and activation waits for completed loads", () => {
    const split = { ...settings, loadRange: 25, activateRange: 5 };
    const first = computeStreamingTargets(empty(), [source], split, bounds);
    assert.ok(first.toLoad.includes("2_0"));
    assert.deepEqual(first.toActivate, []);
    const prev = { loaded: new Set(["0_0", "1_0", "2_0"]), active: new Set<string>() };
    const next = computeStreamingTargets(prev, [source], split, bounds);
    assert.deepEqual(next.toActivate, ["0_0", "1_0"]);
    assert.ok(!next.toLoad.some((key) => prev.loaded.has(key)));
    const alreadyActive = computeStreamingTargets({ ...prev, active: new Set(["0_0"]) }, [source], split, bounds);
    assert.deepEqual(alreadyActive.toActivate, ["1_0"]);
  });

  check("streaming policy: activation defaults to load range and is clamped to it", () => {
    const first = computeStreamingTargets(empty(), [source], settings, bounds);
    const prev = { loaded: new Set(first.toLoad), active: new Set<string>() };
    for (const config of [settings, { ...settings, activateRange: 100 }]) {
      const next = computeStreamingTargets(prev, [source], config, bounds);
      assert.deepEqual(next.toActivate, first.toLoad);
      assert.deepEqual(next.toLoad, []);
    }
  });

  check("streaming policy: loaded hysteresis survives crossing the boundary and returning", () => {
    const prev = { loaded: new Set(["2_0"]), active: new Set<string>() };
    for (const x of [5, 4.9, 5, 1.25]) {
      assert.deepEqual(computeStreamingTargets(prev, [{ position: [x, 5] }], settings, bounds).toUnload, []);
    }
    assert.deepEqual(computeStreamingTargets(prev, [{ position: [1.249, 5] }], settings, bounds).toUnload, ["2_0"]);
    const fresh = computeStreamingTargets(empty(), [{ position: [4.9, 5] }], settings, bounds);
    assert.ok(!fresh.toLoad.includes("2_0"), "hysteresis retains residency but does not expand new loads");
    const custom = computeStreamingTargets(prev, [{ position: [-10, 5] }], { ...settings, unloadHysteresisFactor: 2 }, bounds);
    assert.deepEqual(custom.toUnload, []);
  });

  check("streaming policy: active hysteresis deactivates into prefetch before unloading", () => {
    const prev = { loaded: new Set(["1_0"]), active: new Set(["1_0"]) };
    const split = { ...settings, loadRange: 25, activateRange: 5 };
    for (const x of [5, 4.9, 5, 3.75]) {
      const targets = computeStreamingTargets(prev, [{ position: [x, 5] }], split, bounds);
      assert.deepEqual(targets.toDeactivate, []);
      assert.deepEqual(targets.toUnload, []);
    }
    const outside = computeStreamingTargets(prev, [{ position: [3.749, 5] }], split, bounds);
    assert.deepEqual(outside.toDeactivate, ["1_0"]);
    assert.deepEqual(outside.toUnload, []);
    const far = computeStreamingTargets(prev, [{ position: [-50, 5] }], split, bounds);
    assert.deepEqual(far.toDeactivate, ["1_0"]);
    assert.deepEqual(far.toUnload, ["1_0"]);
  });

  check("streaming policy: velocity-ahead ordering works on both axes and is speed independent", () => {
    for (const { velocity, ahead, behind } of [
      { velocity: [1, 0] as const, ahead: "2_0", behind: "-2_0" },
      { velocity: [-1, 0] as const, ahead: "-2_0", behind: "2_0" },
      { velocity: [0, 1] as const, ahead: "0_2", behind: "0_-2" },
      { velocity: [0, -1] as const, ahead: "0_-2", behind: "0_2" },
    ]) {
      const sources = [{ ...source, velocity }];
      const first = computeStreamingTargets(empty(), sources, { ...settings, loadRange: 30 }, bounds);
      assert.ok(first.toLoad.indexOf(ahead) < first.toLoad.indexOf(behind));
      const prev = { loaded: new Set(first.toLoad), active: new Set<string>() };
      assert.deepEqual(computeStreamingTargets(prev, sources, { ...settings, loadRange: 30 }, bounds).toActivate, first.toLoad);
      const faster: StreamingSource = { ...source, velocity: [velocity[0] * 20, velocity[1] * 20] };
      assert.deepEqual(computeStreamingTargets(empty(), [faster], { ...settings, loadRange: 30 }, bounds).toLoad, first.toLoad);
    }
  });

  check("streaming policy: nearest cells precede distant cells and ties use deterministic keys", () => {
    const expected = ["0_0", "-1_0", "0_-1", "0_1", "1_0"];
    for (const sources of [[source], [{ ...source, velocity: [0, 0] as const }]]) {
      assert.deepEqual(computeStreamingTargets(empty(), sources, { ...settings, loadRange: 5 }, bounds).toLoad, expected);
    }
    const prev = { loaded: new Set([...expected].reverse()), active: new Set<string>() };
    assert.deepEqual(computeStreamingTargets(prev, [source], { ...settings, loadRange: 5 }, bounds).toActivate, expected);
  });

  check("streaming policy: two sources union without duplicates and retain each other's cells", () => {
    const sources: StreamingSource[] = [source, { position: [35, 5] }];
    const individual = sources.map((entry) => computeStreamingTargets(empty(), [entry], settings, bounds).toLoad);
    const combined = computeStreamingTargets(empty(), sources, settings, bounds);
    assert.deepEqual(new Set(combined.toLoad), new Set(individual.flat()));
    assert.equal(combined.toLoad.length, new Set(combined.toLoad).size);
    const prev = { loaded: new Set(combined.toLoad), active: new Set(combined.toLoad) };
    const retained = computeStreamingTargets(prev, sources, settings, bounds);
    assert.deepEqual(retained.toUnload, []);
    assert.deepEqual(retained.toDeactivate, []);
    assert.deepEqual(computeStreamingTargets(empty(), [...sources].reverse(), settings, bounds), combined);
  });

  check("streaming policy: source priority bias raises only qualifying cells", () => {
    const sources: StreamingSource[] = [source, { position: [55, 5], priorityBias: 100 }];
    const config = { ...settings, loadRange: 0 };
    assert.deepEqual(computeStreamingTargets(empty(), sources, config, bounds).toLoad, ["5_0", "0_0"]);
    assert.deepEqual(computeStreamingTargets(empty(), [...sources].reverse(), config, bounds).toLoad, ["5_0", "0_0"]);
  });

  check("streaming policy: world-corner clipping excludes cells that only touch the outer edge", () => {
    const corner = { minX: 0, minZ: 0, maxX: 20, maxZ: 20 };
    for (const position of [[0, 0], [20, 20], [-5, -5]] as const) {
      const targets = computeStreamingTargets(empty(), [{ position }], { ...settings, loadRange: 100 }, corner);
      assert.deepEqual(new Set(targets.toLoad), new Set(["0_0", "0_1", "1_0", "1_1"]));
    }
    const prev = { loaded: new Set(["-1_0", "2_0"]), active: new Set(["-1_0", "2_0"]) };
    const clipped = computeStreamingTargets(prev, [source], { ...settings, loadRange: 100 }, corner);
    assert.deepEqual(clipped.toDeactivate, ["-1_0", "2_0"]);
    assert.deepEqual(clipped.toUnload, ["-1_0", "2_0"]);
  });

  check("streaming policy: shifted grids and partial edge cells respect world bounds", () => {
    const shifted: GridStreamingSettings = { cellSize: 10, origin: [3, -7], loadRange: Infinity };
    const world = { minX: -2, minZ: -2, maxX: 12, maxZ: 12 };
    const targets = computeStreamingTargets(empty(), [source], shifted, world);
    assert.deepEqual(new Set(targets.toLoad), new Set(["-1_0", "0_0", "-1_1", "0_1"]));
    assert.deepEqual(computeStreamingTargets(empty(), [{ position: [1000, 1000] }], settings, world).toLoad, []);
  });

  check("streaming policy: quality multiplier scales load, activation and hysteresis, not cell size", () => {
    for (const multiplier of [0, 0.5, 1, 2]) {
      const config = { ...settings, loadRange: 10, activateRange: 5, viewDistanceMultiplier: multiplier };
      const prev = { loaded: new Set(["1_0", "2_0", "3_0"]), active: new Set(["1_0"]) };
      const scaled = computeStreamingTargets(prev, [source], config, bounds);
      const explicit = computeStreamingTargets(prev, [source], { ...settings, loadRange: 10 * multiplier, activateRange: 5 * multiplier }, bounds);
      assert.deepEqual(scaled, explicit);
      assert.equal(scaled.toActivate.includes("2_0"), false);
      assert.equal(scaled.toUnload.includes("2_0"), multiplier < 2);
    }
    const zero = computeStreamingTargets(empty(), [source], { ...settings, loadRange: Infinity, viewDistanceMultiplier: 0 }, bounds);
    assert.deepEqual(zero.toLoad, ["0_0"]);
  });

  check("streaming policy: no sources releases residency and decisions do not mutate inputs", () => {
    const prev = { loaded: new Set(["2_0", "0_0"]), active: new Set(["2_0"]) };
    const sources = Object.freeze([Object.freeze({ position: Object.freeze([5, 5] as const) })]);
    const config = Object.freeze({ ...settings });
    const world = Object.freeze({ ...bounds });
    computeStreamingTargets(prev, sources, config, world);
    assert.deepEqual([...prev.loaded], ["2_0", "0_0"]);
    assert.deepEqual([...prev.active], ["2_0"]);
    assert.deepEqual(computeStreamingTargets(prev, [], config, world), {
      toLoad: [], toActivate: [], toDeactivate: ["2_0"], toUnload: ["0_0", "2_0"],
    });
  });

  check("streaming policy: seeded random walk preserves Activated subset Loaded with budgeted work", () => {
    let seed = 42;
    const random = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const loaded = new Set<string>();
    const active = new Set<string>();
    let x = 5;
    let z = 5;
    for (let step = 0; step < 400; step += 1) {
      x = Math.max(-110, Math.min(110, x + (random() - 0.5) * 35));
      z = Math.max(-110, Math.min(110, z + (random() - 0.5) * 35));
      const sources: StreamingSource[] = [{ position: [x, z], velocity: [random() - 0.5, random() - 0.5] }, source];
      const config = { ...settings, loadRange: 25, activateRange: 10, viewDistanceMultiplier: [0.5, 1, 2][step % 3]! };
      const targets = computeStreamingTargets({ loaded, active }, sources, config, bounds);
      assert.ok(targets.toActivate.every((key) => loaded.has(key) && !targets.toUnload.includes(key)));
      assert.ok(targets.toLoad.every((key) => !loaded.has(key)));
      for (let cz = -10; cz < 10; cz += 1) {
        for (let cx = -10; cx < 10; cx += 1) {
          const wanted = sources.some((entry) => distanceToWorldCell(config, cx, cz, ...entry.position) <= 25 * config.viewDistanceMultiplier);
          assert.equal(targets.toLoad.includes(`${cx}_${cz}`), wanted && !loaded.has(`${cx}_${cz}`));
        }
      }
      for (const key of targets.toDeactivate) active.delete(key);
      assert.ok([...active].every((key) => loaded.has(key)));
      for (const key of targets.toUnload) {
        assert.ok(!active.has(key), "deactivate before unload");
        loaded.delete(key);
      }
      for (const key of budgetStreamingWork(targets.toActivate, { maxCount: 2 }).selected) active.add(key);
      for (const key of budgetStreamingWork(targets.toLoad, { maxMs: 3, estimateMsPerItem: 1 }).selected) loaded.add(key);
      assert.ok([...active].every((key) => loaded.has(key)));
      for (const key of loaded) {
        const cell = parseWorldCellKey(key)!;
        const box = worldCellBounds(config, cell.x, cell.z);
        assert.ok(box.minX < bounds.maxX && box.maxX > bounds.minX && box.minZ < bounds.maxZ && box.maxZ > bounds.minZ);
      }
    }
  });

  check("streaming policy: budget takes an ordered prefix and defers all excess work", () => {
    const candidates = Object.freeze(["a", "b", "c", "d"]);
    for (const { budget, count } of [
      { budget: {}, count: 4 },
      { budget: { maxCount: 2 }, count: 2 },
      { budget: { maxCount: 2.9 }, count: 2 },
      { budget: { maxMs: 4, estimateMsPerItem: 2 }, count: 2 },
      { budget: { maxMs: 3.9, estimateMsPerItem: 2 }, count: 1 },
      { budget: { maxMs: 1, estimateMsPerItem: 2 }, count: 0 },
      { budget: { maxCount: 1, maxMs: 4, estimateMsPerItem: 2 }, count: 1 },
      { budget: { maxCount: 3, maxMs: 4, estimateMsPerItem: 2 }, count: 2 },
      { budget: { maxCount: 0 }, count: 0 },
      { budget: { maxMs: 0 }, count: 0 },
      { budget: { maxMs: 0, estimateMsPerItem: 0 }, count: 4 },
    ]) {
      const result = budgetStreamingWork(candidates, budget);
      assert.deepEqual(result.selected, candidates.slice(0, count));
      assert.deepEqual(result.deferred, candidates.slice(count));
      assert.deepEqual([...result.selected, ...result.deferred], candidates);
    }
    assert.deepEqual(budgetStreamingWork([], { maxCount: 1 }), { selected: [], deferred: [] });
  });

  check("streaming policy: invalid unbounded-loop inputs and negative budgets are rejected", () => {
    for (const config of [
      { ...settings, cellSize: 0 }, { ...settings, cellSize: Infinity },
      { ...settings, loadRange: -1 }, { ...settings, activateRange: NaN },
      { ...settings, viewDistanceMultiplier: Infinity }, { ...settings, unloadHysteresisFactor: 0.9 },
    ]) assert.throws(() => computeStreamingTargets(empty(), [source], config, bounds), RangeError);
    assert.throws(() => computeStreamingTargets(empty(), [source], settings, { ...bounds, maxX: Infinity }), RangeError);
    assert.throws(() => computeStreamingTargets(empty(), [{ position: [NaN, 0] }], settings, bounds), RangeError);
    for (const budget of [{ maxCount: -1 }, { maxMs: NaN }, { estimateMsPerItem: -1 }, { estimateMsPerItem: Infinity }]) {
      assert.throws(() => budgetStreamingWork([1], budget), RangeError);
    }
  });
}
