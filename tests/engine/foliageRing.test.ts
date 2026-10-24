/** Procedural foliage ring planning (OPEN_WORLD_PLAN Faz 6 F3). */
import assert from "node:assert/strict";
import {
  FOLIAGE_RING_MAX_RADIUS,
  foliageRingRadius,
  planFoliageRing,
  type FoliageRingCell,
} from "../../engine/world/foliageRing";

type Check = (label: string, fn: () => void) => void;

const WIDE = { minX: -10_000, maxX: 10_000, minZ: -10_000, maxZ: 10_000 };

function built(cells: readonly FoliageRingCell[]): Map<string, number> {
  return new Map(cells.map((cell) => [cell.key, cell.keepFraction]));
}

export function registerFoliageRingTests(check: Check): void {
  check("foliage ring: radius follows the cull distance, or covers a small surface for a type that never culls", () => {
    assert.deepEqual(foliageRingRadius(90, 0.5, WIDE), { radius: 45, capped: false });
    assert.deepEqual(foliageRingRadius(90, 0, WIDE), { radius: 90, capped: false }, "non-positive scale falls back to 1");
    assert.deepEqual(foliageRingRadius(0, 1, { minX: 0, maxX: 128, minZ: 0, maxZ: 128 }), { radius: Infinity, capped: false });
    assert.deepEqual(foliageRingRadius(0, 1, WIDE), { radius: FOLIAGE_RING_MAX_RADIUS, capped: true });
  });

  check("foliage ring: cells in range build nearest first with banded keep fractions", () => {
    const plan = planFoliageRing({ center: [16, 16], radius: 96, density: 0.8, bounds: WIDE, built: new Map() });
    assert.deepEqual(plan.unload, []);
    assert.equal(plan.build[0]!.key, "0_0", "the camera's own cell first");
    assert.equal(plan.build[0]!.keepFraction, 0.8);
    const byKey = new Map(plan.build.map((cell) => [cell.key, cell.keepFraction]));
    assert.equal(byKey.get("1_0"), 0.8, "16 m away: first band");
    assert.equal(byKey.get("2_0"), 0.4, "48 m away: second band (32..64 m)");
    assert.equal(byKey.get("3_0"), 0.2, "80 m away: last band");
    assert.equal(byKey.has("4_0"), false, "112 m away is outside 96 m");
    for (let index = 1; index < plan.build.length; index += 1) {
      const distance = (cell: FoliageRingCell) => Math.hypot(
        Math.max(cell.cellX * 32 - 16, 0, 16 - (cell.cellX + 1) * 32),
        Math.max(cell.cellZ * 32 - 16, 0, 16 - (cell.cellZ + 1) * 32));
      assert.ok(distance(plan.build[index - 1]!) <= distance(plan.build[index]!), "sorted by distance");
    }
  });

  check("foliage ring: built cells stay until 1.25x the radius and a replan builds nothing new", () => {
    const first = planFoliageRing({ center: [16, 16], radius: 96, density: 1, bounds: WIDE, built: new Map() });
    const state = built(first.build);
    const same = planFoliageRing({ center: [16, 16], radius: 96, density: 1, bounds: WIDE, built: state });
    assert.deepEqual(same, { build: [], unload: [] });
    // 20 m along X: cell -3_0 (x -96..-64) is then 100 m away, inside 1.25 × 96 = 120 m.
    const moved = planFoliageRing({ center: [36, 16], radius: 96, density: 1, bounds: WIDE, built: state });
    assert.equal(moved.unload.includes("-3_0"), false, "inside the 1.25x ring");
    const far = planFoliageRing({ center: [80, 16], radius: 96, density: 1, bounds: WIDE, built: state });
    assert.ok(far.unload.includes("-3_0"), "176 m away: unloaded");
    assert.ok(far.build.some((cell) => cell.key === "5_0"), "new cells ahead");
  });

  check("foliage ring: a camera on a band edge does not rebuild the cell each frame", () => {
    // Cell 1_0 spans x 32..64: built at full density 22 m away, its band edge (R/3 = 32 m)
    // is at camera x 0; the quarter-cell margin keeps it until x -8.
    const start = planFoliageRing({ center: [10, 16], radius: 96, density: 1, bounds: WIDE, built: new Map() });
    const state = built(start.build);
    const keep = state.get("1_0");
    assert.equal(keep, 1);
    for (const x of [0, -1, -4, -7.9, 5]) {
      const plan = planFoliageRing({ center: [x, 16], radius: 96, density: 1, bounds: WIDE, built: state });
      assert.equal(plan.build.some((cell) => cell.key === "1_0"), false, `no rebuild at x ${x}`);
    }
    const past = planFoliageRing({ center: [-10, 16], radius: 96, density: 1, bounds: WIDE, built: state });
    const rebuilt = past.build.find((cell) => cell.key === "1_0");
    assert.ok(rebuilt && rebuilt.keepFraction < keep!, "a quarter cell past the edge thins it");
  });

  check("foliage ring: density changes rebuild every cell, zero density unloads all", () => {
    const first = planFoliageRing({ center: [0, 0], radius: 64, density: 1, bounds: WIDE, built: new Map() });
    const state = built(first.build);
    // 0.3 × (1, 0.5, 0.25) matches none of the built fractions, so every cell is stale.
    // (With 0.5, a cell built at 0.25 near a band edge would equal the next band's 0.25
    // and correctly stay, being inside the hysteresis margin.)
    const lower = planFoliageRing({ center: [0, 0], radius: 64, density: 0.3, bounds: WIDE, built: state });
    assert.deepEqual(lower.build.map((cell) => cell.key).sort(), [...state.keys()].sort());
    assert.ok(lower.build.every((cell) => cell.keepFraction === state.get(cell.key)! * 0.3));
    assert.deepEqual(planFoliageRing({ center: [0, 0], radius: 64, density: 0, bounds: WIDE, built: state }).unload.sort(), [...state.keys()].sort());
  });

  check("foliage ring: the plan stays on the surface and an unbounded radius covers it at full density", () => {
    const bounds = { minX: -64, maxX: 64, minZ: -64, maxZ: 64 };
    const plan = planFoliageRing({ center: [500, 500], radius: Infinity, density: 0.55, bounds, built: new Map() });
    assert.equal(plan.build.length, 16, "4×4 cells of 32 m");
    assert.ok(plan.build.every((cell) => cell.keepFraction === 0.55));
    const clipped = planFoliageRing({ center: [0, 0], radius: 96, density: 1, bounds, built: new Map([["9_9", 1]]) });
    assert.equal(clipped.build.length, 16);
    assert.deepEqual(clipped.unload, ["9_9"], "a cell off the surface is unloaded");
  });
}
