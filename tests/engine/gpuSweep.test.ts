/**
 * F5 of the `?debug` performance-instrument plan: the GPU A/B sweep.
 *
 * Everything here defends one claim — that a row is a real saving and not the
 * GPU changing its mind about clock speed halfway through a multi-second run.
 * The bracketed baseline, the noise floor, the `uncertain` verdict and the
 * scheduler's handling of late, missing and invalidated samples are exactly the
 * parts that decide whether the table can be believed.
 */
import assert from "node:assert/strict";

import {
  buildGpuSweep,
  formatGpuSweepText,
  gpuSweepTableView,
  gpuSweepUnavailableView,
  median,
  GPU_SWEEP_NOISE_FLOOR_MS,
} from "../../engine/perf/gpuSweep";
import { GpuSweepRunner, GPU_SWEEP_BASELINE_ID } from "../../engine/perf/gpuSweepRunner";

type Check = (label: string, fn: () => void) => void;

const CONTEXT = { drawCalls: 320, triangles: 1_200_000, sceneSeconds: 42 };

export function registerGpuSweepTests(check: Check): void {
  check("median resists the warm-up frame a mean would let through", () => {
    // The first frame of a configuration pays for pipeline warm-up the steady
    // state does not; one such frame drags a five-sample mean far enough to
    // invent a difference.
    assert.equal(median([4, 4.1, 4.2, 4.1, 22]), 4.1);
    assert.equal(median([4, 6]), 5);
    assert.equal(median([]), 0);
  });

  check("a row is compared with its own bracket, so a sliding baseline cancels", () => {
    // The GPU drops a power state across the run: the baseline slides 6 → 12 ms.
    // Against the *first* baseline alone, the last step would read as a 5 ms
    // cost — a saving with the wrong sign, which is how this measurement lies.
    const sweep = buildGpuSweep({
      baselines: [6, 8, 10, 12],
      baselineSamples: 20,
      steps: [
        // Genuinely 4 ms cheaper than its own bracket of (6+8)/2 = 7 — and the
        // saving has to clear the bracket drift (2 ms) to be published at all.
        { id: "foliage", gpuMs: 3, samples: 5, baselineBeforeMs: 6, baselineAfterMs: 8 },
        // Bracket (8+10)/2 = 9, and it drew in 9 — no saving, and the drift did
        // not turn that into one.
        { id: "landscape", gpuMs: 9, samples: 5, baselineBeforeMs: 8, baselineAfterMs: 10 },
        // Bracket (10+12)/2 = 11 against 11: still nothing, even though a naive
        // comparison with the run's first baseline would call it -5 ms.
        { id: "shadow map", gpuMs: 11, samples: 5, baselineBeforeMs: 10, baselineAfterMs: 12 },
      ],
      disjointEvents: 0,
      ...CONTEXT,
    });
    assert.deepEqual(
      sweep.rows.map((row) => [row.label, Number(row.savingMs.toFixed(2))]),
      [
        ["foliage", 4],
        ["landscape", 0],
        ["shadow map", 0],
      ],
    );
    // The run's own error bar is reported rather than hidden.
    assert.equal(sweep.baselineDriftMs, 6);
    assert.equal(sweep.baselineDrifted, true);
    const notes = gpuSweepTableView(sweep).notes.join(" ");
    assert.ok(notes.includes("changed power state"));
    assert.ok(notes.includes("not comparable"));
  });

  check("a row whose bracket moved as far as its saving is published as uncertain", () => {
    const sweep = buildGpuSweep({
      baselines: [10, 16],
      baselineSamples: 10,
      // Bracket (10+16)/2 = 13 against 11 → a 2 ms "saving", from a bracket that
      // itself moved 6 ms. That row measured the wander, not the content.
      steps: [{ id: "foliage", gpuMs: 11, samples: 5, baselineBeforeMs: 10, baselineAfterMs: 16 }],
      disjointEvents: 0,
      ...CONTEXT,
    });
    const row = sweep.rows[0]!;
    assert.equal(row.unstable, true);
    assert.equal(row.bracketDriftMs, 6);
    const view = gpuSweepTableView(sweep);
    // A number would be believed; the word is the honest cell.
    assert.equal(view.rows[0]!.cells[2], "uncertain");
    assert.equal(view.rows[0]!.cells[3], "—");
    // And an uncertain row draws no share bar, so it cannot look like a finding.
    assert.equal(view.rows[0]!.share, 0);
    assert.ok(view.notes.join(" ").includes("noise, not a finding"));
  });

  check("differences inside the timer's quantisation are reported as noise", () => {
    const sweep = buildGpuSweep({
      baselines: [8, 8],
      baselineSamples: 10,
      steps: [
        { id: "splines", gpuMs: 7.97, samples: 5, baselineBeforeMs: 8, baselineAfterMs: 8 },
        { id: "foliage", gpuMs: 5, samples: 5, baselineBeforeMs: 8, baselineAfterMs: 8 },
      ],
      disjointEvents: 0,
      ...CONTEXT,
    });
    const splines = sweep.rows.find((row) => row.label === "splines")!;
    assert.ok(Math.abs(splines.savingMs) < GPU_SWEEP_NOISE_FLOOR_MS);
    assert.equal(splines.negligible, true);
    // Reporting "0.03 ms" as a finding is how a table teaches people to stop
    // trusting it.
    assert.equal(gpuSweepTableView(sweep).rows[1]!.cells[2], "~0");
    // Real findings first; noise below them.
    assert.deepEqual(sweep.rows.map((row) => row.label), ["foliage", "splines"]);
  });

  check("unstable rows sort below every trustworthy one", () => {
    const sweep = buildGpuSweep({
      baselines: [10, 20, 10],
      baselineSamples: 15,
      steps: [
        // A big "saving" from a bracket that moved further than it.
        { id: "wobbly", gpuMs: 9, samples: 5, baselineBeforeMs: 10, baselineAfterMs: 20 },
        { id: "solid", gpuMs: 8, samples: 5, baselineBeforeMs: 10, baselineAfterMs: 10 },
      ],
      disjointEvents: 0,
      ...CONTEXT,
    });
    // Sorting the unstable row by a number just declared meaningless would put
    // it above a finding that is real.
    assert.deepEqual(sweep.rows.map((row) => row.label), ["solid", "wobbly"]);
  });

  check("the table says outright that its rows do not sum", () => {
    const sweep = buildGpuSweep({
      baselines: [10, 10],
      baselineSamples: 10,
      steps: [{ id: "foliage", gpuMs: 6, samples: 5, baselineBeforeMs: 10, baselineAfterMs: 10 }],
      disjointEvents: 2,
      ...CONTEXT,
    });
    const view = gpuSweepTableView(sweep);
    assert.equal(view.title, "GPU cost (sweep)");
    assert.ok(view.notes.some((note) => note.includes("Rows do not sum")));
    assert.ok(view.notes.some((note) => note.includes("saving (baseline − without)")));
    assert.ok(view.notes.some((note) => note.includes("excludes the wait for vsync")));
    // Discarded measurements are counted in the open, not swallowed.
    assert.ok(view.notes.some((note) => note.includes("invalidated 2 time(s)")));
    assert.ok(formatGpuSweepText(sweep).includes("Rows are savings and do not sum"));
  });

  check("no timer means an explanation, never a table of zeros", () => {
    const view = gpuSweepUnavailableView("This browser has no GPU timer queries.");
    assert.equal(view.rows.length, 1);
    assert.equal(view.rows[0]!.kind, "note");
    // Zeros here would read as "nothing costs anything" — a wrong answer wearing
    // the clothes of a right one.
    assert.ok(view.notes.some((note) => note.includes("EXT_disjoint_timer_query_webgl2")));
    assert.ok(view.notes.some((note) => note.includes("works in every browser")));
  });

  check("the runner brackets every step with an untouched frame", () => {
    const runner = new GpuSweepRunner([{ id: "foliage" }, { id: "shadow map" }]);
    const visited: string[] = [];
    // Five samples settle a step; the schedule must be baseline, step, baseline,
    // step, baseline — five measurements for two categories.
    for (let guard = 0; guard < 40; guard += 1) {
      const step = runner.currentStep();
      if (!step) break;
      visited.push(step.id);
      for (let sample = 0; sample < 5; sample += 1) {
        runner.noteFrame();
        runner.acceptSample(step.tag, 10);
      }
      runner.advance(CONTEXT);
    }
    assert.deepEqual(visited, [
      GPU_SWEEP_BASELINE_ID,
      "foliage",
      GPU_SWEEP_BASELINE_ID,
      "shadow map",
      GPU_SWEEP_BASELINE_ID,
    ]);
  });

  check("a late sample still counts toward the configuration it measured", () => {
    const runner = new GpuSweepRunner([{ id: "foliage" }]);
    const baselineTag = runner.currentStep()!.tag;
    // The baseline settles and the schedule moves on…
    for (let sample = 0; sample < 5; sample += 1) {
      runner.noteFrame();
      runner.acceptSample(baselineTag, 10);
    }
    runner.advance(CONTEXT);
    const stepTag = runner.currentStep()!.tag;
    // …and only now does a straggler arrive for it. GPU results lag by frames;
    // it still measured that configuration, so it still belongs to it.
    runner.acceptSample(baselineTag, 10);
    for (let sample = 0; sample < 5; sample += 1) {
      runner.noteFrame();
      runner.acceptSample(stepTag, 6);
    }
    runner.advance(CONTEXT);
    const tail = runner.currentStep()!.tag;
    for (let sample = 0; sample < 5; sample += 1) {
      runner.noteFrame();
      runner.acceptSample(tail, 10);
    }
    const outcome = runner.advance(CONTEXT);
    assert.equal(outcome.kind, "done");
    if (outcome.kind !== "done") return;
    assert.equal(outcome.sweep.rows[0]!.savingMs, 4);
    // The cap holds: a sixth sample for a settled step is dropped rather than
    // widening one bucket past the others.
    assert.equal(outcome.sweep.baselineSamples, 10);
  });

  check("a starved step is written off rather than holding the scene forever", () => {
    const runner = new GpuSweepRunner([{ id: "foliage" }]);
    // A driver that never resolves a query: 40 frames of nothing on the very
    // first baseline means every later step would be a difference against
    // nothing, so the run fails instead of producing a table of differences
    // from zero.
    for (let frame = 0; frame < 40; frame += 1) runner.noteFrame();
    const outcome = runner.advance(CONTEXT);
    assert.equal(outcome.kind, "failed");
    if (outcome.kind !== "failed") return;
    assert.ok(outcome.reason.includes("no results"));
    // Once finished it stays finished, and stops scheduling.
    assert.equal(runner.currentStep(), null);
  });

  check("a disjoint event re-measures the step; too many end the run", () => {
    const runner = new GpuSweepRunner([{ id: "foliage" }]);
    const tag = runner.currentStep()!.tag;
    for (let sample = 0; sample < 3; sample += 1) {
      runner.noteFrame();
      runner.acceptSample(tag, 10);
    }
    // Everything in flight was invalidated: those three samples are not
    // durations, and a table built partly from them is worse than a slower run.
    runner.noteDisjoint();
    for (let sample = 0; sample < 5; sample += 1) {
      runner.noteFrame();
      runner.acceptSample(tag, 12);
    }
    runner.advance(CONTEXT);
    assert.equal(runner.currentStep()!.id, "foliage");

    // Beyond the retry budget, the run gives up rather than looping forever.
    const doomed = new GpuSweepRunner([{ id: "foliage" }]);
    for (let attempt = 0; attempt < 4; attempt += 1) doomed.noteDisjoint();
    const outcome = doomed.advance(CONTEXT);
    assert.equal(outcome.kind, "failed");
    if (outcome.kind !== "failed") return;
    assert.ok(outcome.reason.includes("invalidated repeatedly"));
  });

  check("a baseline that produced nothing is filled in, not counted as zero", () => {
    const runner = new GpuSweepRunner([{ id: "foliage" }]);
    // First baseline measures; the step measures; the closing baseline starves.
    const first = runner.currentStep()!.tag;
    for (let sample = 0; sample < 5; sample += 1) {
      runner.noteFrame();
      runner.acceptSample(first, 10);
    }
    runner.advance(CONTEXT);
    const step = runner.currentStep()!.tag;
    for (let sample = 0; sample < 5; sample += 1) {
      runner.noteFrame();
      runner.acceptSample(step, 6);
    }
    runner.advance(CONTEXT);
    for (let frame = 0; frame < 40; frame += 1) runner.noteFrame();
    const outcome = runner.advance(CONTEXT);
    assert.equal(outcome.kind, "done");
    if (outcome.kind !== "done") return;
    // A missing side of the bracket takes the other's value. Counting it as a
    // zero would halve the bracket and double the reported saving.
    assert.equal(outcome.sweep.rows[0]!.savingMs, 4);
    assert.equal(outcome.sweep.baselineRuns, 1);
  });
}
