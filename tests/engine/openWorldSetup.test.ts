import assert from "node:assert/strict";
import {
  openWorldFogPatch,
  openWorldPartitionSettings,
  openWorldSetupFromLevel,
  openWorldSetupNotes,
  openWorldSetupProblems,
  suggestedViewDistance,
  type OpenWorldSetup,
} from "../../engine/world/openWorldSetup";
import { exponentialFogOpacityAt, VIEW_DISTANCE_FOG_OPACITY, VIEW_DISTANCE_MAX } from "../../engine/world/viewDistance";
import { DEFAULT_WORLD_PARTITION } from "../../engine/world/worldPartition";

type Check = (label: string, fn: () => void) => void;

const setup = (patch: Partial<OpenWorldSetup> = {}): OpenWorldSetup => ({
  partition: { enabled: true, cellSize: 128, loadRange: 384 },
  viewDistance: 2000,
  fitFog: true,
  ...patch,
});

/** OPEN_WORLD_PLAN Faz 8: the New Landscape dialog's Open World section. */
export function registerOpenWorldSetupTests(check: Check): void {
  check("open world setup: opens with the level's values and nothing new switched on", () => {
    assert.deepEqual(openWorldSetupFromLevel(undefined, undefined), {
      partition: { enabled: false, ...DEFAULT_WORLD_PARTITION.grids.main }, viewDistance: null, fitFog: false,
    });
    assert.deepEqual(openWorldSetupFromLevel({ enabled: true, grids: { main: { cellSize: 200, loadRange: 600 } } }, 3000), {
      partition: { enabled: true, cellSize: 200, loadRange: 600 }, viewDistance: 3000, fitFog: false,
    });
  });

  check("open world setup: the suggested view distance covers the longest side, rounded up and clamped", () => {
    assert.equal(suggestedViewDistance([1024, 512]), 1100);
    assert.equal(suggestedViewDistance([2048, 2048]), 2100);
    assert.equal(suggestedViewDistance([10, 20]), 100, "never below one 100 m step");
    assert.equal(suggestedViewDistance([90000, 10]), VIEW_DISTANCE_MAX);
  });

  check("open world setup: invalid cells, view distance or a fog without one block creation", () => {
    assert.deepEqual(openWorldSetupProblems(setup()), []);
    assert.deepEqual(openWorldSetupProblems(setup({ viewDistance: null, fitFog: false })), [], "empty view distance is allowed");
    assert.match(openWorldSetupProblems(setup({ partition: { enabled: true, cellSize: 0, loadRange: 384 } })).join(" "), /Cell size/);
    assert.match(openWorldSetupProblems(setup({ partition: { enabled: true, cellSize: 128, loadRange: Number.NaN } })).join(" "), /Loading range/);
    // Disabled partition ignores its fields, as World Settings does.
    assert.deepEqual(openWorldSetupProblems(setup({ partition: { enabled: false, cellSize: 0, loadRange: -1 } })), []);
    assert.match(openWorldSetupProblems(setup({ viewDistance: 10 })).join(" "), /View distance/);
    assert.match(openWorldSetupProblems(setup({ viewDistance: 50000 })).join(" "), /View distance/);
    assert.match(openWorldSetupProblems(setup({ viewDistance: null, fitFog: true })).join(" "), /fit the fog/);
  });

  check("open world setup: partition settings keep the foliage grid and stay absent when never enabled", () => {
    assert.equal(openWorldPartitionSettings(setup({ partition: { enabled: false, cellSize: 128, loadRange: 384 } }), undefined), undefined);
    const current = { enabled: false, grids: { main: { cellSize: 100, loadRange: 300 }, foliage: { cellSize: 32, loadRange: 96 } } };
    assert.deepEqual(openWorldPartitionSettings(setup({ partition: { enabled: true, cellSize: 256, loadRange: 768 } }), current), {
      enabled: true, grids: { main: { cellSize: 256, loadRange: 768 }, foliage: { cellSize: 32, loadRange: 96 } },
    });
    // Switching it off keeps the level's authored grid instead of the dialog's disabled fields.
    assert.deepEqual(openWorldPartitionSettings(setup({ partition: { enabled: false, cellSize: 1, loadRange: 1 } }), { ...current, enabled: true }), current);
  });

  check("open world setup: the fitted fog is exponential and 98% opaque at the view distance", () => {
    const patch = openWorldFogPatch(2000);
    assert.equal(patch.mode, "exp");
    assert.ok(Math.abs(exponentialFogOpacityAt(patch.density, 2000) - VIEW_DISTANCE_FOG_OPACITY) < 1e-4);
    assert.equal(patch.density, Number(patch.density.toFixed(6)), "same rounding as Details > Fit to View Distance");
  });

  check("open world setup: notes count cells and warn about far view without fog", () => {
    const notes = openWorldSetupNotes(setup({ fitFog: false }), [1024, 512]);
    assert.ok(notes.some((note) => note.includes("About 32 actor cells")));
    assert.ok(notes.some((note) => note.includes("far view mode")));
    assert.ok(notes.some((note) => note.includes("hard edge")));
    assert.ok(!openWorldSetupNotes(setup(), [1024, 512]).some((note) => note.includes("hard edge")));
    assert.ok(openWorldSetupNotes(setup({ viewDistance: 500, fitFog: false }), [1024, 512]).some((note) => note.includes("not drawn")));
    assert.deepEqual(openWorldSetupNotes(setup({ partition: { enabled: false, cellSize: 128, loadRange: 384 }, viewDistance: null, fitFog: false }), [256, 256]), []);
  });
}
