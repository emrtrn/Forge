/**
 * F1 of the `?debug` performance-instrument plan: frame regions and the full
 * accounting built on them.
 *
 * The rules under test are the ones that make the account trustworthy — the
 * residual rows, the frame kept out of the region list, group time never
 * double-counted into the total, and diagnostic cost held apart from the number
 * the bottleneck classifier draws a verdict from.
 */
import assert from "node:assert/strict";

import { EngineApp } from "../../engine/core/EngineApp";
import { ENGINE_REGION_ID } from "../../engine/core/SubsystemRegistry";
import type { Subsystem } from "../../engine/core/Subsystem";
import { SubsystemProfiler } from "../../engine/core/subsystemProfiler";
import {
  buildFrameRegionRows,
  FrameRegionRegistry,
  FRAME_REGION_ID,
  UNMEASURED_REGION_ID,
} from "../../engine/perf/frameRegions";
import { debugTableToText } from "../../engine/perf/debugTableView";
import { classifyBottleneck } from "../../engine/perf/bottleneckClassifier";
import type { FrameMetrics } from "../../engine/perf/frameMetrics";

type Check = (label: string, fn: () => void) => void;

/** A frame-time window that is steadily over a 16.7 ms budget, with no hitching. */
function sustainedMetrics(averageFrameTimeMs: number): FrameMetrics {
  return {
    frameTimeMs: averageFrameTimeMs,
    averageFrameTimeMs,
    p95FrameTimeMs: averageFrameTimeMs * 1.05,
    spikeCount: 0,
    sampleWindowSeconds: 5,
    sampleCount: 300,
    estimatedRefreshIntervalMs: 16.7,
  };
}

export function registerFrameRegionTests(check: Check): void {
  check("frame region registry refuses to let the denominator become a row", () => {
    const registry = new FrameRegionRegistry();
    // The one mistake the whole module exists to prevent: a "frame" row inside
    // the frame, which would double every total it appears in.
    assert.throws(() => registry.declare({ id: FRAME_REGION_ID }), /denominator/);
  });

  check("frame region registry re-declares idempotently and inherits debugOnly", () => {
    const registry = new FrameRegionRegistry();
    registry.declare({ id: "overlay", debugOnly: true });
    registry.declare({ id: "wires", parent: "overlay" });
    registry.declare({ id: "render" });
    // A module that re-registers on level reload must not accumulate copies.
    registry.declare({ id: "render" });
    assert.equal(registry.all().length, 3);

    assert.equal(registry.parentOf("wires"), "overlay");
    assert.equal(registry.parentOf("render"), null);
    // Diagnostic cost is inherited: a child of a debug-only group is debug-only.
    assert.equal(registry.isDebugOnly("wires"), true);
    assert.equal(registry.isDebugOnly("render"), false);
    // An undeclared id is not an error — it simply reads as a top-level region.
    assert.equal(registry.parentOf("nothing-declared"), null);
    assert.equal(registry.isDebugOnly("nothing-declared"), false);
  });

  check("frame region rows account for every millisecond of the frame", () => {
    const profiler = new SubsystemProfiler(4);
    profiler.declareRegion({ id: "engine" });
    profiler.declareRegion({ id: "physics", parent: "engine" });
    profiler.declareRegion({ id: "ai", parent: "engine" });
    profiler.declareRegion({ id: "render" });
    profiler.record("engine", 6);
    profiler.record("physics", 3);
    profiler.record("ai", 2);
    profiler.record("render", 4);
    profiler.recordFrame(16);
    profiler.endFrame();

    const rows = buildFrameRegionRows(profiler.snapshot());
    assert.deepEqual(
      rows.map((row) => [row.id, row.depth, row.averageMs, row.residual]),
      [
        ["engine", 0, 6, false],
        ["physics", 1, 3, false],
        ["ai", 1, 2, false],
        // The group cost 1 ms more than the children it was measured around.
        ["engine (other)", 1, 1, true],
        ["render", 0, 4, false],
        // And 6 of the frame's 16 ms were never measured by anything.
        [UNMEASURED_REGION_ID, 0, 6, true],
      ],
    );
    // The top-level rows plus the frame residual are exactly the frame. That
    // equality is the whole promise of the table.
    const topLevel = rows.filter((row) => row.depth === 0);
    assert.equal(
      topLevel.reduce((sum, row) => sum + row.averageMs, 0),
      16,
    );
    // Shares are of the frame, not of the measured part.
    assert.equal(rows[0]!.shareOfFrame, 6 / 16);
  });

  check("frame region rows never print a negative residual or invent a peak", () => {
    const profiler = new SubsystemProfiler(4);
    profiler.declareRegion({ id: "group" });
    profiler.declareRegion({ id: "child", parent: "group" });
    // A rolling window can leave a child sampled in frames its parent was not,
    // so the subtraction can go the wrong way. "Nothing left over" is the honest
    // answer there; "-0.30 ms" is not a cost anything spent.
    profiler.record("group", 1);
    profiler.record("child", 1.3);
    profiler.recordFrame(2);
    profiler.endFrame();
    const rows = buildFrameRegionRows(profiler.snapshot());
    assert.deepEqual(
      rows.map((row) => row.id),
      ["group", "child", UNMEASURED_REGION_ID],
    );
    assert.ok(rows.every((row) => row.averageMs >= 0));
    // A residual has no peak of its own: the group's worst frame and the
    // children's worst frame need not be the same frame, so subtracting them
    // would report a number nothing ever measured.
    assert.equal(rows.find((row) => row.id === UNMEASURED_REGION_ID)!.maxMs, 0);
  });

  check("frame region rows read a snapshot with no declarations as a flat list", () => {
    // The listing the overlay had before regions existed, unchanged.
    const profiler = new SubsystemProfiler(4);
    profiler.record("physics", 2);
    profiler.record("behavior", 1);
    profiler.endFrame();
    const rows = buildFrameRegionRows(profiler.snapshot());
    assert.deepEqual(
      rows.map((row) => [row.id, row.depth]),
      [
        ["physics", 0],
        ["behavior", 0],
      ],
    );
    // No frame was measured, so there is no residual row: without a denominator
    // there is no "rest of the frame" to report, and a zero row there would
    // claim a coverage the snapshot cannot support.
    assert.equal(rows.some((row) => row.residual), false);
  });

  check("orphan regions surface as top-level rather than hiding under a phantom group", () => {
    const profiler = new SubsystemProfiler(4);
    // Declared as a child, but the parent was never recorded — an unmeasured
    // group is a gap in the account, not a place to file rows.
    profiler.declareRegion({ id: "child", parent: "never-recorded" });
    profiler.record("child", 2);
    profiler.recordFrame(5);
    profiler.endFrame();
    const rows = buildFrameRegionRows(profiler.snapshot());
    assert.deepEqual(
      rows.map((row) => [row.id, row.depth]),
      [
        ["child", 0],
        [UNMEASURED_REGION_ID, 0],
      ],
    );
  });

  check("a group's time is counted once, and diagnostic cost is counted apart", () => {
    const profiler = new SubsystemProfiler(4);
    profiler.declareRegion({ id: "engine" });
    profiler.declareRegion({ id: "physics", parent: "engine" });
    profiler.declareRegion({ id: "render" });
    profiler.declareRegion({ id: "debugWires", debugOnly: true });
    profiler.record("engine", 6);
    profiler.record("physics", 5);
    profiler.record("render", 4);
    profiler.record("debugWires", 3);
    profiler.recordFrame(20);
    profiler.endFrame();

    const snapshot = profiler.snapshot();
    // engine + render — the physics 5 ms is already inside engine's 6, and the
    // debug wires are not cost the shipped build pays.
    assert.equal(snapshot.totalAverageMs, 10);
    assert.equal(snapshot.debugOnlyAverageMs, 3);
    // Still a row, though: hidden cost is worse than marked cost.
    const wires = snapshot.subsystems.find((timing) => timing.id === "debugWires");
    assert.equal(wires?.debugOnly, true);
    assert.equal(
      buildFrameRegionRows(snapshot).some((row) => row.id === "debugWires" && row.debugOnly),
      true,
    );
  });

  check("the overlay's own cost cannot tip the bottleneck verdict to cpu", () => {
    const profiler = new SubsystemProfiler(4);
    profiler.declareRegion({ id: "render" });
    profiler.declareRegion({ id: "debugWires", debugOnly: true });
    // A 25 ms frame: 8 ms of real CPU (32%, off-CPU territory) and 9 ms of
    // diagnostic work that only exists because somebody opened the overlay.
    profiler.record("render", 8);
    profiler.record("debugWires", 9);
    profiler.recordFrame(25);
    profiler.endFrame();

    const verdict = classifyBottleneck({
      metrics: sustainedMetrics(25),
      subsystems: profiler.snapshot(),
      budget: null,
      targetFrameTimeMs: 16.7,
    });
    // Counting the wires would put the share at 68% and diagnose the instrument
    // instead of the game.
    assert.equal(verdict.type, "gpu");
  });

  check("the subsystem block is a region whose residual is the registry's own cost", () => {
    const app = new EngineApp();
    const makeSubsystem = (id: string): Subsystem => ({ id, update: () => undefined });
    app.registerSubsystem(makeSubsystem("first"));
    app.registerSubsystem(makeSubsystem("second"));
    let clock = 0;
    app.enableProfiling(() => (clock += 1));

    app.update(0.016);
    app.recordFrame(20);
    app.endProfileFrame();

    const snapshot = app.getProfileSnapshot()!;
    const rows = buildFrameRegionRows(snapshot);
    assert.deepEqual(
      rows.map((row) => [row.id, row.depth]),
      [
        [ENGINE_REGION_ID, 0],
        ["first", 1],
        ["second", 1],
        [`${ENGINE_REGION_ID} (other)`, 1],
        [UNMEASURED_REGION_ID, 0],
      ],
    );
    // Five clock reads at 1 ms apiece bracket the block; the two subsystems
    // account for 2 of them, and the remaining 3 are the registry's own loop —
    // a cost that had nowhere at all to appear before regions existed.
    assert.equal(rows.find((row) => row.id === `${ENGINE_REGION_ID} (other)`)!.averageMs, 3);
  });

  check("a subsystem registered after profiling started still nests under engine", () => {
    // A capability module attaching mid-session used to read as a top-level
    // region and get counted twice against the frame.
    const app = new EngineApp();
    let clock = 0;
    app.enableProfiling(() => (clock += 1));
    app.registerSubsystem({ id: "late", update: () => undefined });
    app.update(0.016);
    app.endProfileFrame();
    const late = app.getProfileSnapshot()!.subsystems.find((timing) => timing.id === "late");
    assert.equal(late?.parent, ENGINE_REGION_ID);
  });

  check("debugTableToText aligns the grid so a pasted table is still readable", () => {
    const text = debugTableToText({
      title: "Frame cost (CPU)",
      meta: "frame 10.00 ms · measured 40%",
      columns: [
        { label: "region", align: "left" },
        { label: "avg ms", align: "right" },
      ],
      rows: [
        { cells: ["engine", "4.00"], share: 0.4, kind: "region" },
        { cells: ["  physics", "3.00"], share: 0.3, kind: "region" },
      ],
      notes: ["Rows are windowed averages."],
    });
    assert.deepEqual(text.split("\n"), [
      "Frame cost (CPU)",
      "frame 10.00 ms · measured 40%",
      "",
      "region     avg ms",
      "engine       4.00",
      "  physics    3.00",
      "",
      "- Rows are windowed averages.",
    ]);
  });
}

